/**
 * Native event creation surface (P3): duplicate preview + idempotent publish.
 * Order matters: auth -> validate -> idempotent replay/conflict -> duplicate
 * guard -> transactional create -> cache invalidation -> initial HEAT recalc.
 */
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PgPoolLike } from "../types.js";
import { createEventRequestSchema } from "@heat/api-contracts";
import { findDuplicateCandidates } from "./duplicateCheck.js";
import { createNativeEvent } from "./createEvent.js";
import {
  fetchEventDetail,
  presentEventDetail,
} from "../events/eventRepository.js";
import { attendanceDisplayText } from "../../lib/attendance.js";
import { confidenceLabel } from "../../lib/scoring.js";
import { deriveTrend } from "../../lib/trend.js";
import { starAggregates, velocityPhrase } from "../stars/starRepository.js";
import { recalculateEventHeat } from "../heat/engine.js";
import { authRequired, eventNotFound, invalidRequest, type AppError } from "../../lib/errors.js";
import { RATE_LIMITS } from "../../lib/limits.js";

export function registerNativeEventRoutes(app: FastifyInstance, db: PgPoolLike): void {
  app.post("/v1/events/duplicate-check", { config: { rateLimit: RATE_LIMITS.duplicateProbe } }, async (req) => {
    const b = req.body as Record<string, unknown>;
    const title = typeof b.title === "string" ? b.title.trim() : "";
    const category = typeof b.category === "string" ? b.category : "";
    const loc = (b.location ?? {}) as { lat?: unknown; lng?: unknown; venueId?: unknown };
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    const startsAt = typeof b.startsAt === "string" ? Date.parse(b.startsAt) : NaN;
    const endsAt = typeof b.endsAt === "string" ? Date.parse(b.endsAt) : NaN;
    if (title.length < 3 || title.length > 140) throw invalidRequest("title length");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw invalidRequest("location");
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt < startsAt) {
      throw invalidRequest("times");
    }
    const candidates = await findDuplicateCandidates(db, {
      title,
      category,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      location: {
        lat,
        lng,
        venueId: typeof loc.venueId === "string" ? loc.venueId : null,
      },
    });
    await db
      .query(
        `INSERT INTO event_interactions (user_id, anonymous_session_id, event_id, interaction_type, metadata)
         SELECT NULL, NULL, c.event_id, 'create_duplicate_view', jsonb_build_object('candidate_count', $2::int)
         FROM unnest($1::uuid[]) AS c(event_id)`,
        [candidates.map((c) => c.eventId), candidates.length],
      )
      .catch(() => undefined);
    return { candidates };
  });

  app.post(
    "/v1/events",
    { config: { rateLimit: RATE_LIMITS.eventCreate } },
    async (req, reply) => {
      if (!req.user) throw authRequired();
      const parsed = createEventRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw invalidRequest(parsed.error.issues.map((i) => i.message).join("; "));
      }

      const idemKeyHeader = req.headers["idempotency-key"];
      const idempotencyKey = typeof idemKeyHeader === "string" ? idemKeyHeader : null;
      const requestHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(parsed.data))
        .digest("hex");

      // Retry-safe replay; same key + different payload is always a client bug.
      if (idempotencyKey) {
        const existing = await db.query<{
          event_id: string;
          request_hash: string | null;
        }>(
          `SELECT event_id, request_hash FROM native_event_submissions
           WHERE creator_user_id = $1 AND idempotency_key = $2`,
          [req.user.userId, idempotencyKey],
        );
        const prior = existing.rows[0];
        if (prior) {
          if (prior.request_hash && prior.request_hash !== requestHash) {
            return reply.status(409).send({
              error: {
                code: "IDEMPOTENCY_CONFLICT",
                message: "Idempotency key reused with different payload",
                requestId: req.id,
              },
            });
          }
          reply.code(200);
          return {
            event: await presentFresh(db, prior.event_id, req.user.userId),
            trustLevel: "community" as const,
          };
        }
      }

      // Duplicate guard before publish (CRT-AC-003).
      const dupes = await findDuplicateCandidates(db, {
        title: parsed.data.title,
        category: parsed.data.category,
        startsAt: new Date(parsed.data.startsAt),
        endsAt: new Date(parsed.data.endsAt),
        location: {
          lat: parsed.data.location.lat,
          lng: parsed.data.location.lng,
          venueId: parsed.data.location.venueId ?? null,
        },
      });
      const strong = dupes.filter((c) => c.matchConfidence >= 0.9);
      if (strong.length > 0 && req.headers["x-allow-duplicate"] !== "true") {
        return reply.status(409).send({
          error: {
            code: "DUPLICATE_EVENT_LIKELY",
            message: "Duplicate event likely",
            requestId: req.id,
          },
          candidates: strong,
        });
      }

      const result = await createNativeEvent(
        db,
        parsed.data,
        req.user.userId,
        idempotencyKey,
        requestHash,
      );
      await app.mapCache.invalidateAll();
      await recalculateEventHeat(db, result.eventId).catch(() => undefined);
      reply.code(result.reusedIdempotencyKey ? 200 : 201);
      return {
        event: await presentFresh(db, result.eventId, req.user.userId),
        trustLevel: "community" as const,
      };
    },
  );

  app.post(
    "/v1/events/:id/reports",
    { config: { rateLimit: RATE_LIMITS.reports } },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const b = req.body as { reason?: string; details?: string };
      const REASONS = [
        "duplicate", "fake_event", "canceled", "postponed", "wrong_location",
        "wrong_time", "wrong_venue", "scam_ticket_link", "unsafe_location",
        "inappropriate_content", "impersonation", "other",
      ];
      if (!REASONS.includes(b.reason ?? "")) throw invalidRequest("invalid reason");
      const exists = await db.query(
        "SELECT 1 FROM events WHERE id = $1 AND deleted_at IS NULL",
        [id],
      );
      if (!exists.rows[0]) throw eventNotFound();
      await db.query(
        `INSERT INTO event_reports (id, event_id, reporter_user_id, reason, details)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          crypto.randomUUID(),
          id,
          req.user?.userId ?? null,
          b.reason,
          b.details?.slice(0, 1000) ?? null,
        ],
      );
      reply.code(201);
      return { accepted: true };
    },
  );
}

/** Fresh canonical presentation incl. engine heat + star aggregates. */
export async function presentFresh(
  db: PgPoolLike,
  eventId: string,
  viewerUserId: string,
) {
  const row = await fetchEventDetail(db, eventId, viewerUserId);
  if (!row) throw eventNotFound();
  const now = new Date();
  const label = confidenceLabel(row.heatConfidence, row.attendanceEstimateType);
  const trend = deriveTrend({
    now,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    heatScore: Number(row.heatScore),
    starsLastHour: Number(row.starsLastHour),
  });
  const aggregates = await starAggregates(db, eventId);
  return presentEventDetail(row, {
    now,
    confidenceLabelText: label,
    trendText: trend,
    velocityPhrase: velocityPhrase(aggregates),
    attendanceText: attendanceDisplayText(
      row.attendanceLow,
      row.attendanceHigh,
      row.attendanceEstimateType as Parameters<typeof attendanceDisplayText>[2],
    ),
    canEdit: true,
    canReport: true,
    canClaim: true,
  });
}
