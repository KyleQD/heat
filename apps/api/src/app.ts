/**
 * HEAT API — Fastify application factory (P0/P2/P3/P4/P5/P6 endpoints).
 * Every response is canonical; every error uses stable codes; structured logs
 * carry request IDs and never contain tokens/secrets/exact coordinates.
 */
import crypto from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { loadEnv, type Env } from "./env.js";
import { getPool, closePool } from "./db/pool.js";
import { resolveUser } from "./plugins/auth.js";
import { CITIES, DEFAULT_FEATURE_FLAGS, LAS_VEGAS, findCity, resolveTimeWindow } from "@heat/config";
import { SCORING_MODEL_VERSION } from "@heat/domain";
import { mapEventsQuerySchema, type MapEventsResponse } from "@heat/api-contracts";
import { queryViewport } from "./modules/map/mapRepository.js";
import { buildClusters, buildHeatPoints, toMapEvents } from "./modules/map/mapPresenter.js";
import {
  fetchEventDetail,
  presentEventDetail,
} from "./modules/events/eventRepository.js";
import { attendanceDisplayText } from "./lib/attendance.js";
import { confidenceLabel } from "./lib/scoring.js";
import { deriveTrend } from "./lib/trend.js";
import { starAggregates, starEvent, unstarEvent, velocityPhrase } from "./modules/stars/starRepository.js";
import { EstimateRoutingProvider } from "./lib/routingProvider.js";
import { findDuplicateCandidates } from "./modules/native-events/duplicateCheck.js";
import { createNativeEvent } from "./modules/native-events/createEvent.js";
import { searchEventsAndVenues } from "./modules/search/searchRepository.js";
import { MapResponseCache, ttlForWindow } from "./modules/map/mapCache.js";
import { HeatRecalculator, recalculateEventHeat, SCORING_MODEL_VERSION as ENGINE_VERSION } from "./modules/heat/engine.js";
import {
  AppError,
  authRequired,
  eventNotFound,
  invalidRequest,
} from "./lib/errors.js";
import { normalizeTitle } from "./lib/normalize.js";

export interface HttpErrorShape {
  statusCode?: number;
  code?: string;
}

declare module "fastify" {
  interface FastifyInstance {
    heat: HeatRecalculator;
    mapCache: MapResponseCache;
  }
}

export async function buildApp(envOverride?: Partial<Env>): Promise<FastifyInstance> {
  const env = { ...loadEnv(), ...envOverride };
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers['x-heat-session']",
          "req.headers.cookie",
        ],
        censor: "[REDACTED]",
      },
    },
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(rateLimit, {
    global: false,
    max: 120,
    timeWindow: "1 minute",
  });

  const db = getPool(env);
  const mapCache = new MapResponseCache();
  const heat = new HeatRecalculator(() => db);
  heat.start();
  app.decorate("heat", heat);
  app.decorate("mapCache", mapCache);

  app.addHook("onRequest", async (req) => {
    req.user = null;
    if (req.routeOptions?.url && !req.routeOptions.url.startsWith("/v1/config")) {
      try {
        await resolveUser(db, req);
      } catch {
        req.user = null;
      }
    }
  });

  app.addHook("onResponse", async (req, reply) => {
    req.log.info(
      {
        route: req.routeOptions?.url ?? req.url,
        status: reply.statusCode,
        latencyMs: reply.elapsedTime.toFixed(1),
        authState: req.user ? "authenticated" : "anonymous",
      },
      "request_complete",
    );
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, requestId: req.id },
      });
    }
    const shaped = err as HttpErrorShape;
    if (shaped.statusCode != null && shaped.code != null) {
      return reply.status(shaped.statusCode).send({
        error: { code: shaped.code, message: err.message, requestId: req.id },
      });
    }
    // zod validation errors -> INVALID_REQUEST
    if (err.validation != null || Array.isArray((err as { issues?: unknown[] }).issues)) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: err.message, requestId: req.id },
      });
    }
    req.log.error({ err }, "unhandled_error");
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal error", requestId: req.id },
    });
  });

  // -------------------------------------------------------------------------
  // Health + config (P0)
  // -------------------------------------------------------------------------
  app.get("/v1/health", async () => {
    const { rows } = await db.query<{ ok: boolean }>("SELECT TRUE AS ok");
    return { status: rows[0]?.ok === true ? "ok" : "degraded", time: new Date().toISOString() };
  });

  app.get("/v1/config", async () => {
    return {
      flags: DEFAULT_FEATURE_FLAGS,
      cities: CITIES.map((c) => ({
        cityKey: c.cityKey,
        displayName: c.displayName,
        timezone: c.timezone,
        center: c.center,
        bounds: c.bounds,
        enabled: c.enabled,
        tonightStartHourLocal: c.tonightStartHourLocal,
        tonightEndHourLocal: c.tonightEndHourLocal,
        defaultZoom: c.defaultZoom,
      })),
      scoringModelVersion: ENGINE_VERSION,
    };
  });

  app.post("/v1/auth/session", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (_req, reply) => {
    const { createAnonymousSession } = await import("./plugins/auth.js");
    const session = await createAnonymousSession(db);
    reply.code(201);
    return { token: session.token };
  });

  // -------------------------------------------------------------------------
  // Map query (P2-010)
  // -------------------------------------------------------------------------
  app.get<{ Querystring: Record<string, string> }>("/v1/map/events", async (req) => {
    const parsed = mapEventsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw invalidRequest(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const q = parsed.data;
    // Cache only user-independent responses (star state must not leak keys).
    const userSpecific = q.includeStarredState === true && req.user != null;
    if (!userSpecific) {
      const key = app.mapCache.key({
        north: q.north, south: q.south, east: q.east, west: q.west,
        zoom: q.zoom, window: q.window,
        category: q.category ?? null,
        starredOnly: q.starredOnly === true && req.user == null,
      });
      const hit = app.mapCache.get(key);
      if (hit) return hit;
    }
    const city = LAS_VEGAS;
    const { start, end } = resolveTimeWindow(q.window, city);
    const now = new Date();

    const rows = await queryViewport(db, {
      north: q.north,
      south: q.south,
      east: q.east,
      west: q.west,
      windowStart: start,
      windowEnd: end,
      category: q.category,
      starredOnly: q.starredOnly === true,
      viewerUserId: req.user?.userId ?? null,
      limit: 400,
    });

    const events = toMapEvents(rows, now, q.includeStarredState === true && req.user != null);
    const clusters = buildClusters(events, q.zoom);
    const heatPoints = DEFAULT_FEATURE_FLAGS.map_heat_layer_enabled ? buildHeatPoints(events) : [];

    const body: MapEventsResponse = {
      generatedAt: now.toISOString() as MapEventsResponse["generatedAt"],
      window: {
        label: q.window,
        start: start.toISOString() as MapEventsResponse["window"]["start"],
        end: end.toISOString() as MapEventsResponse["window"]["end"],
      },
      viewport: { north: q.north, south: q.south, east: q.east, west: q.west, zoom: q.zoom },
      events,
      clusters,
      heatPoints,
    };
    if (!userSpecific) {
      const key = app.mapCache.key({
        north: q.north, south: q.south, east: q.east, west: q.west,
        zoom: q.zoom, window: q.window,
        category: q.category ?? null,
        starredOnly: q.starredOnly === true && req.user == null,
      });
      app.mapCache.set(key, body, ttlForWindow(q.window));
    }
    return body;
  });

  // -------------------------------------------------------------------------
  // Event detail (P2-011)
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/v1/events/:id", async (req, reply) => {
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
    const aggregates = await starAggregates(db, id);
    const detail = presentEventDetail(row, {
      now,
      confidenceLabelText: label,
      trendText: trend,
      velocityPhrase: velocityPhrase(aggregates),
      attendanceText: attendanceDisplayText(
        row.attendanceLow,
        row.attendanceHigh,
        row.attendanceEstimateType as Parameters<typeof attendanceDisplayText>[2],
      ),
      canEdit: row.createdBy != null && row.createdBy === req.user?.userId,
      canReport: true,
      canClaim: true,
    });
    // Canceled events remain fetchable but are explicitly status-marked.
    void reply;
    return detail;
  });

  // -------------------------------------------------------------------------
  // Stars (P5-004/005) — auth required; idempotent.
  // -------------------------------------------------------------------------
  app.put("/v1/events/:id/star", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    if (!req.user) throw authRequired();
    const id = (req.params as { id: string }).id;
    const ev = await db.query<{ starts_at: Date | null; heat_score: string | null }>(
      "SELECT starts_at, heat_score FROM events WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    if (!ev.rows[0]) throw eventNotFound();
    const result = await starEvent(db, id, req.user.userId, {
      eventStartAt: ev.rows[0].starts_at,
      heatScore: ev.rows[0].heat_score != null ? Number(ev.rows[0].heat_score) : null,
      sourceSurface: "map",
    });
    app.heat.markDirty(id);
    return { eventId: id, starred: result.starred, starCount: result.starCount };
  });

  app.delete("/v1/events/:id/star", async (req) => {
    if (!req.user) throw authRequired();
    const id = (req.params as { id: string }).id;
    const exists = await db.query("SELECT 1 FROM events WHERE id = $1", [id]);
    if (!exists.rows[0]) throw eventNotFound();
    const result = await unstarEvent(db, id, req.user.userId);
    app.heat.markDirty(id);
    return { eventId: id, starred: result.starred, starCount: result.starCount };
  });

  app.get("/v1/me/starred-events", async (req) => {
    if (!req.user) throw authRequired();
    const { rows } = await db.query<{
      eventId: string; title: string; venueName: string | null;
      startsAt: Date; lat: number; lng: number; heatScore: string | null; starredAt: Date;
    }>(
      `SELECT s.event_id AS "eventId", e.title, v.name AS "venueName",
              e.starts_at AS "startsAt",
              ST_Y(e.location::geometry) AS lat, ST_X(e.location::geometry) AS lng,
              e.heat_score AS "heatScore", s.created_at AS "starredAt"
       FROM event_stars s
       JOIN events e ON e.id = s.event_id
       LEFT JOIN venues v ON v.id = e.venue_id
       WHERE s.user_id = $1 AND s.removed_at IS NULL
       ORDER BY s.created_at DESC
       LIMIT 200`,
      [req.user.userId],
    );
    return {
      items: rows.map((r) => ({
        eventId: r.eventId,
        title: r.title,
        venueName: r.venueName,
        startsAt: new Date(r.startsAt).toISOString(),
        lat: Number(r.lat),
        lng: Number(r.lng),
        heatScore: Number(r.heatScore ?? 0),
        starredAt: new Date(r.starredAt).toISOString(),
      })),
    };
  });

  // -------------------------------------------------------------------------
  // Routing (P6-003/004) — origin transient; only bucket persisted (ADR-0007).
  // -------------------------------------------------------------------------
  const routingProvider = new EstimateRoutingProvider();

  app.post("/v1/routes/preview", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const body = req.body as {
      eventId?: unknown; origin?: { lat?: unknown; lng?: unknown }; modes?: unknown;
    };
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    const originLat = Number(body.origin?.lat);
    const originLng = Number(body.origin?.lng);
    const modes = Array.isArray(body.modes) ? body.modes.filter((m): m is "drive" | "walk" | "transit" | "bike" =>
      typeof m === "string" && ["drive", "walk", "transit", "bike"].includes(m)) : [];
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw eventNotFound();
    if (!Number.isFinite(originLat) || !Number.isFinite(originLng) ||
        Math.abs(originLat) > 90 || Math.abs(originLng) > 180) {
      throw Object.assign(new Error("A valid origin location is required"), { statusCode: 400, code: "LOCATION_REQUIRED" });
    }
    if (modes.length === 0) throw invalidRequest("modes required");

    const dest = await db.query<{ lat: number; lng: number; heat_score: string | null }>(
      `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, heat_score
       FROM events WHERE id = $1 AND deleted_at IS NULL`,
      [eventId],
    );
    const d = dest.rows[0];
    if (!d) throw eventNotFound();

    let routes: Awaited<ReturnType<typeof EstimateRoutingProvider.prototype.getRoutes>>;
    try {
      routes = await routingProvider.getRoutes({
        origin: { lat: originLat, lng: originLng },
        destination: { lat: Number(d.lat), lng: Number(d.lng) },
        modes,
      });
    } catch {
      routes = [];
    }

    // Privacy: bucket the origin to a ~5 km grid cell for analytics only.
    const geoBucket = `g${Math.round(originLat * 20)}_${Math.round(originLng * 20)}`;
    const routeRequestId = crypto.randomUUID();
    await db.query(
      `INSERT INTO event_route_requests (id, user_id, session_id, event_id, mode, origin_geo_bucket, distance_meters, duration_seconds, provider, heat_score_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        routeRequestId,
        req.user?.userId ?? null,
        null,
        eventId,
        routes[0]?.mode ?? modes[0]!,
        geoBucket,
        routes[0]?.distanceMeters ?? null,
        routes[0]?.durationSeconds ?? null,
        routingProvider.name,
        d.heat_score != null ? Number(d.heat_score) : null,
      ],
    );

    return {
      routeRequestId,
      routes,
      destination: { lat: Number(d.lat), lng: Number(d.lng) },
      partial: routes.length < modes.length,
    };
  });

  app.post("/v1/routes/navigation-start", async (req) => {
    const body = req.body as { eventId?: string; mode?: string; provider?: string; routeRequestId?: string | null };
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    const mode = body.mode;
    const provider = body.provider;
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw eventNotFound();
    if (!mode || !["drive", "walk", "transit", "bike"].includes(mode)) throw invalidRequest("invalid mode");
    if (provider !== "apple_maps" && provider !== "google_maps") throw invalidRequest("invalid provider");
    await db.query(
      `INSERT INTO navigation_starts (id, route_request_id, user_id, event_id, mode, provider)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [crypto.randomUUID(), body.routeRequestId ?? null, req.user?.userId ?? null, eventId, mode, provider],
    );
    if (body.routeRequestId && /^[0-9a-f-]{36}$/i.test(body.routeRequestId)) {
      await db.query(
        `UPDATE event_route_requests SET external_navigation_started_at = now()
         WHERE id = $1`,
        [body.routeRequestId],
      );
    }
    await db.query(
      `INSERT INTO event_interactions (user_id, event_id, interaction_type, metadata)
       VALUES ($1,$2,'navigation_start', jsonb_build_object('mode', $3::text, 'provider', $4::text))`,
      [req.user?.userId ?? null, eventId, mode, provider],
    );
    return { accepted: true as const };
  });

  // -------------------------------------------------------------------------
  // Native creation (P3)
  // -------------------------------------------------------------------------
  app.post("/v1/events/duplicate-check", async (req) => {
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
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt < startsAt) throw invalidRequest("times");
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
    await db.query(
      `INSERT INTO event_interactions (user_id, anonymous_session_id, event_id, interaction_type, metadata)
       SELECT NULL, NULL, c.event_id, 'create_duplicate_view', jsonb_build_object('candidate_count', $2::int)
       FROM unnest($1::uuid[]) AS c(event_id)`,
      [candidates.map((c) => c.eventId), candidates.length],
    ).catch(() => undefined);
    return { candidates };
  });

  app.post("/v1/events", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    if (!req.user) throw authRequired();
    const { createEventRequestSchema } = await import("@heat/api-contracts");
    const parsed = createEventRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw invalidRequest(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const idemKeyHeader = req.headers["idempotency-key"];
    const idempotencyKey = typeof idemKeyHeader === "string" ? idemKeyHeader : null;

    // Retry-safe: same Idempotency-Key returns the original canonical event
    // without re-running the duplicate guard (TC-P3-004).
    if (idempotencyKey) {
      const requestHashEarly = crypto.createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
      const existing = await db.query<{ event_id: string; request_hash: string | null }>(
        "SELECT event_id, request_hash FROM native_event_submissions WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      const prior = existing.rows[0];
      if (prior) {
        if (prior.request_hash && prior.request_hash !== requestHashEarly) {
          // Same retry key + different logical submission is always a client bug.
          return reply.status(409).send({
            error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency key reused with different payload", requestId: req.id },
          });
        }
        const priorEvent = await this_presentEvent(db, prior.event_id, req.user!.userId);
        reply.code(200);
        return { event: priorEvent, trustLevel: "community" as const };
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
        error: { code: "DUPLICATE_EVENT_LIKELY", message: "Duplicate event likely", requestId: req.id },
        candidates: strong,
      });
    }


    const requestHash = crypto.createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
    const result = await createNativeEvent(db, parsed.data, req.user!.userId, idempotencyKey, requestHash);
    app.mapCache.invalidateAll();
    await recalculateEventHeat(db, result.eventId).catch(() => undefined);
    const row = await fetchEventDetail(db, result.eventId, req.user!.userId);
    if (!row) throw eventNotFound();
    const now = new Date();
    const label = confidenceLabel(row.heatConfidence, row.attendanceEstimateType);
    const trend = deriveTrend({ now, startsAt: row.startsAt, endsAt: row.endsAt, heatScore: Number(row.heatScore), starsLastHour: Number(row.starsLastHour) });
    const aggregates = await starAggregates(db, result.eventId);
    reply.code(result.reusedIdempotencyKey ? 200 : 201);
    return {
      event: presentEventDetail(row, {
        now,
        confidenceLabelText: label,
        trendText: trend,
        velocityPhrase: velocityPhrase(aggregates),
        attendanceText: attendanceDisplayText(row.attendanceLow, row.attendanceHigh, row.attendanceEstimateType as Parameters<typeof attendanceDisplayText>[2]),
        canEdit: true,
        canReport: true,
        canClaim: true,
      }),
      trustLevel: "community" as const,
    };
  });

async function this_presentEvent(
  db: ReturnType<typeof getPool>,
  eventId: string,
  viewerUserId: string,
) {
  const { deriveTrend: dt } = await import("./lib/trend.js");
  const row = await fetchEventDetail(db, eventId, viewerUserId);
  if (!row) throw eventNotFound();
  const now = new Date();
  const label = confidenceLabel(row.heatConfidence, row.attendanceEstimateType);
  const trend = dt({ now, startsAt: row.startsAt, endsAt: row.endsAt, heatScore: Number(row.heatScore), starsLastHour: Number(row.starsLastHour) });
  const aggregates = await starAggregates(db, eventId);
  return presentEventDetail(row, {
    now,
    confidenceLabelText: label,
    trendText: trend,
    velocityPhrase: velocityPhrase(aggregates),
    attendanceText: attendanceDisplayText(row.attendanceLow, row.attendanceHigh, row.attendanceEstimateType as Parameters<typeof attendanceDisplayText>[2]),
    canEdit: true,
    canReport: true,
    canClaim: true,
  });
}

  // -------------------------------------------------------------------------
  // Creator edit (P3-014) — native events only; ownership enforced server-side.
  // -------------------------------------------------------------------------
  app.patch("/v1/events/:id", async (req) => {
    if (!req.user) throw authRequired();
    const id = (req.params as { id: string }).id;
    const b = req.body as Record<string, unknown>;

    const ev = await db.query<{ created_by: string | null; source_count: number; starts_at: Date; ends_at: Date | null }>(
      "SELECT created_by, source_count, starts_at, ends_at FROM events WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    const row = ev.rows[0];
    if (!row) throw eventNotFound();
    if (row.created_by !== req.user.userId) {
      throw Object.assign(new Error("Only the creator can edit this event"), { statusCode: 403, code: "FORBIDDEN" });
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
    if (typeof b.description === "string" || b.description === null) push("description", b.description ?? null);
    if (typeof b.startsAt === "string") startsAt = new Date(b.startsAt);
    if (typeof b.endsAt === "string") endsAt = new Date(b.endsAt);
    if (b.startsAt != null || b.endsAt != null) {
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt?.getTime() ?? 0)) throw invalidRequest("times");
      if (endsAt && endsAt < startsAt) throw invalidRequest("endsAt must be >= startsAt");
      push("starts_at", startsAt);
      push("ends_at", endsAt);
    }
    if (typeof b.ticketUrl === "string" || b.ticketUrl === null) {
      const url = b.ticketUrl;
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
    const detail = await fetchEventDetail(db, id, req.user.userId);
    if (!detail) throw eventNotFound();
    const nowD = new Date();
    const label2 = confidenceLabel(detail.heatConfidence, detail.attendanceEstimateType);
    const trend2 = deriveTrend({ now: nowD, startsAt: detail.startsAt, endsAt: detail.endsAt, heatScore: Number(detail.heatScore), starsLastHour: Number(detail.starsLastHour) });
    return presentEventDetail(detail, {
      now: nowD,
      confidenceLabelText: label2,
      trendText: trend2,
      velocityPhrase: null,
      attendanceText: attendanceDisplayText(detail.attendanceLow, detail.attendanceHigh, detail.attendanceEstimateType as Parameters<typeof attendanceDisplayText>[2]),
      canEdit: true,
      canReport: true,
      canClaim: true,
    });
  });

  // -------------------------------------------------------------------------
  // Reports (P13 baseline) — confirmation only, no decision details.
  // -------------------------------------------------------------------------
  app.post("/v1/events/:id/reports", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const b = req.body as { reason?: string; details?: string };
    const REASONS = ["duplicate","fake_event","canceled","postponed","wrong_location","wrong_time","wrong_venue","scam_ticket_link","unsafe_location","inappropriate_content","impersonation","other"];
    if (!REASONS.includes(b.reason ?? "")) throw invalidRequest("invalid reason");
    const exists = await db.query("SELECT 1 FROM events WHERE id = $1 AND deleted_at IS NULL", [id]);
    if (!exists.rows[0]) throw eventNotFound();
    await db.query(
      `INSERT INTO event_reports (id, event_id, reporter_user_id, reason, details)
       VALUES ($1,$2,$3,$4,$5)`,
      [crypto.randomUUID(), id, req.user?.userId ?? null, b.reason, b.details?.slice(0, 1000) ?? null],
    );
    reply.code(201);
    return { accepted: true };
  });

  // -------------------------------------------------------------------------
  // Analytics batch (P0-011 ingestion). Privacy boundary: payloads containing
  // raw coordinates are rejected outright — buckets only.
  // -------------------------------------------------------------------------
  app.post("/v1/analytics/batch", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const body = req.body as {
      events?: Array<{ name?: string; payload?: Record<string, unknown> }>;
    };
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length === 0 || events.length > 100) throw invalidRequest("events batch size 1..100");

    const FORBIDDEN_KEYS = new Set(["lat","lng","latitude","longitude","originlat","originlng","coord"]);
    const sessionHash = req.user
      ? crypto.createHash("sha256").update(req.user.sessionId).digest("hex").slice(0, 24)
      : null;

    let stored = 0;
    for (const item of events) {
      const name = typeof item.name === "string" ? item.name : "";
      if (!name) continue;
      const payload = (item.payload ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(payload)) {
        if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
          throw invalidRequest(`payload contains forbidden coordinate key: ${key}`);
        }
      }
      const eventId = typeof payload["event_id"] === "string" ? payload["event_id"] : null;
      const INTERACTION_MAP: Record<string, string> = {
        event_selected: "select",
        event_sheet_expanded: "expand",
        ticket_clicked: "ticket_click",
        route_preview_requested: "route_preview",
        navigation_started: "navigation_start",
      };
      const interaction = INTERACTION_MAP[name];
      if (interaction && eventId && /^[0-9a-f-]{36}$/i.test(eventId)) {
        await db.query(
          `INSERT INTO event_interactions (user_id, anonymous_session_id, event_id, interaction_type, metadata)
           VALUES ($1,$2,$3,$4,$5)`,
          [req.user?.userId ?? null, sessionHash, eventId, interaction,
           JSON.stringify(Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v)])))],
        );
        if (interaction === "route_preview" || interaction === "navigation_start") {
          app.heat.markDirty(eventId);
        }
        stored += 1;
      }
    }
    return { accepted: events.length, stored };
  });

  // -------------------------------------------------------------------------
  // Search (P1 accessibility fallback / P3 venue search)
  // -------------------------------------------------------------------------
  app.get("/v1/search", async (req) => {
    const qs = req.query as { q?: string; limit?: string };
    const q = (qs.q ?? "").trim();
    if (q.length < 1 || q.length > 120) throw invalidRequest("q required");
    const limitRaw = Number(qs.limit ?? "10");
    const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 20 ? limitRaw : 10;
    const results = await searchEventsAndVenues(db, q, limit);
    return { events: results };
  });

  app.get("/v1/cities/:cityKey", async (req) => {
    const key = (req.params as { cityKey: string }).cityKey;
    const city = findCity(key);
    if (!city) {
      throw Object.assign(new Error("City not found"), { statusCode: 404, code: "VENUE_NOT_FOUND" });
    }
    return city;
  });

  app.addHook("onClose", async () => {
    heat.stop();
    await closePool();
  });

  return app;
}
