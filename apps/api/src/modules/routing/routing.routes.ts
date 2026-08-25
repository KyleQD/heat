/**
 * GO / routing surface (P6): preview + navigation handoff intent.
 * ADR-0007: exact origin is transient; only ~5km buckets persist.
 */
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { EstimateRoutingProvider } from "../../lib/routingProvider.js";
import { eventNotFound, invalidRequest, locationRequiredError } from "../../lib/errors.js";
import { RATE_LIMITS } from "../../lib/limits.js";
import type { PgPoolLike } from "../types.js";

export function registerRoutingRoutes(app: FastifyInstance, db: PgPoolLike): void {
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
      throw locationRequiredError();
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

  app.post("/v1/routes/navigation-start", { config: { rateLimit: RATE_LIMITS.routePreview } }, async (req) => {
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
    // R2-013 — correlate the handoff to BOTH the route request and the event;
    // a mismatched pair must not mark an unrelated request as started.
    if (body.routeRequestId && /^[0-9a-f-]{36}$/i.test(body.routeRequestId)) {
      await db.query(
        `UPDATE event_route_requests SET external_navigation_started_at = now()
         WHERE id = $1 AND event_id = $2`,
        [body.routeRequestId, eventId],
      );
    }
    await db.query(
      `INSERT INTO event_interactions (user_id, event_id, interaction_type, metadata)
       VALUES ($1,$2,'navigation_start', jsonb_build_object('mode', $3::text, 'provider', $4::text))`,
      [req.user?.userId ?? null, eventId, mode, provider],
    );
    return { accepted: true as const };
  });

}
