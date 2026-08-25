/**
 * Star surface (P5): idempotent writes with reconciled counts + starred sync.
 * Every mutation marks the event dirty for HEAT recalculation.
 */
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { starAggregates, starEvent, unstarEvent, velocityPhrase } from "./starRepository.js";
import { authRequired, eventNotFound } from "../../lib/errors.js";
import { RATE_LIMITS } from "../../lib/limits.js";
import type { PgPoolLike } from "../types.js";

export function registerStarRoutes(app: FastifyInstance, db: PgPoolLike): void {
  app.put("/v1/events/:id/star", { config: { rateLimit: RATE_LIMITS.starWrite } }, async (req) => {
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

  app.delete("/v1/events/:id/star", { config: { rateLimit: RATE_LIMITS.starWrite } }, async (req) => {
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
      eventId: string;
      title: string;
      venueName: string | null;
      startsAt: Date;
      lat: number;
      lng: number;
      heatScore: string | null;
      starredAt: Date;
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
    void crypto;
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

  // Velocity aggregates exposed for the expanded sheet's star-activity line.
  app.get("/v1/events/:id/star-metrics", async (req) => {
    const id = (req.params as { id: string }).id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw eventNotFound();
    const metrics_ = await starAggregates(db, id);
    return { ...metrics_, velocityPhrase: velocityPhrase(metrics_) };
  });
}
