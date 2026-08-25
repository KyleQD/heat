/**
 * Event surface: canonical detail + creator edit.
 */
import type { FastifyInstance } from "fastify";
import { fetchEventDetail, presentEventDetail } from "./eventRepository.js";
import { attendanceDisplayText } from "../../lib/attendance.js";
import { confidenceLabel } from "../../lib/scoring.js";
import { deriveTrend } from "../../lib/trend.js";
import { normalizeTitle } from "../../lib/normalize.js";
import { recalculateEventHeat } from "../heat/engine.js";
import { authRequired, eventNotFound, invalidRequest, type AppError } from "../../lib/errors.js";
import { RATE_LIMITS } from "../../lib/limits.js";
import type { PgPoolLike } from "../types.js";

export function registerEventRoutes(app: FastifyInstance, db: PgPoolLike): void {
  app.get("/v1/events/:id", { config: { rateLimit: RATE_LIMITS.detailRead } }, async (req) => {
    const id = (req.params as { id: string }).id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw eventNotFound();
    const row = await fetchEventDetail(db, id, req.user?.userId ?? null);
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
    const aggregates = await import("../stars/starRepository.js").then((m) =>
      m.starAggregates(db, id),
    );
    return presentEventDetail(row, {
      now,
      confidenceLabelText: label,
      trendText: trend,
      velocityPhrase: (await import("../stars/starRepository.js")).velocityPhrase(aggregates),
      attendanceText: attendanceDisplayText(
        row.attendanceLow,
        row.attendanceHigh,
        row.attendanceEstimateType as Parameters<typeof attendanceDisplayText>[2],
      ),
      canEdit: row.createdBy != null && row.createdBy === req.user?.userId,
      canReport: true,
      canClaim: true,
    });
  });

  // Creator edit (P3-014) — ownership enforced server-side; never trust UI.
  app.patch("/v1/events/:id", { config: { rateLimit: RATE_LIMITS.eventCreate } }, async (req) => {
    if (!req.user) throw authRequired();
    const id = (req.params as { id: string }).id;
    const b = req.body as Record<string, unknown>;

    const ev = await db.query<{
      created_by: string | null;
      starts_at: Date;
      ends_at: Date | null;
    }>(
      "SELECT created_by, starts_at, ends_at FROM events WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    const row = ev.rows[0];
    if (!row) throw eventNotFound();
    if (row.created_by !== req.user.userId) {
      throw Object.assign(new Error("Only the creator can edit this event"), {
        statusCode: 403,
        code: "FORBIDDEN",
      }) as AppError;
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, value: unknown): void => {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };

    let startsAt = new Date(row.starts_at);
    let endsAt = row.ends_at ? new Date(row.ends_at) : null;
    if (typeof b.title === "string") {
      const title = b.title.trim();
      if (title.length < 3 || title.length > 140) throw invalidRequest("title length");
      push("title", title);
      push("normalized_title", normalizeTitle(title));
    }
    if (typeof b.description === "string" || b.description === null) {
      push("description", b.description ?? null);
    }
    if (typeof b.startsAt === "string") startsAt = new Date(b.startsAt);
    if (typeof b.endsAt === "string") endsAt = new Date(b.endsAt);
    if (b.startsAt != null || b.endsAt != null) {
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt?.getTime() ?? 0)) {
        throw invalidRequest("times");
      }
      if (endsAt && endsAt < startsAt) throw invalidRequest("endsAt must be >= startsAt");
      push("starts_at", startsAt);
      push("ends_at", endsAt);
    }
    if (typeof b.ticketUrl === "string" || b.ticketUrl === null) {
      const url = b.ticketUrl as string | null;
      if (url != null && !/^https:\/\/.+/.test(url)) throw invalidRequest("ticketUrl must be https");
      push("canonical_ticket_url", url);
    }
    if (sets.length === 0) throw invalidRequest("no editable fields supplied");

    params.push(id);
    await db.query(
      `UPDATE events SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length}`,
      params,
    );
    await recalculateEventHeat(db, id).catch(() => undefined);
    // R2-012 — title/time edits never move HEAT; invalidate directly instead
    // of waiting for a score change to eventually bust the epoch.
    await app.mapCache.invalidateAll();

    const detail = await fetchEventDetail(db, id, req.user.userId);
    if (!detail) throw eventNotFound();
    const nowD = new Date();
    const label = confidenceLabel(detail.heatConfidence, detail.attendanceEstimateType);
    const trend = deriveTrend({
      now: nowD,
      startsAt: detail.startsAt,
      endsAt: detail.endsAt,
      heatScore: Number(detail.heatScore),
      starsLastHour: Number(detail.starsLastHour),
    });
    const { starAggregates, velocityPhrase } = await import("../stars/starRepository.js");
    const aggregates = await starAggregates(db, id);
    return presentEventDetail(detail, {
      now: nowD,
      confidenceLabelText: label,
      trendText: trend,
      velocityPhrase: velocityPhrase(aggregates),
      attendanceText: attendanceDisplayText(
        detail.attendanceLow,
        detail.attendanceHigh,
        detail.attendanceEstimateType as Parameters<typeof attendanceDisplayText>[2],
      ),
      canEdit: true,
      canReport: true,
      canClaim: true,
    });
  });
}
