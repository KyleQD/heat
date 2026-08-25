/**
 * System surface: health, config, anonymous sessions, analytics ingestion,
 * city lookup, metrics scrape.
 */
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { CITIES, DEFAULT_FEATURE_FLAGS, findCity } from "@heat/config";
import { SCORING_MODEL_VERSION as ENGINE_VERSION } from "../heat/engine.js";
import { createAnonymousSession } from "../../plugins/auth.js";
import { metrics } from "../../plugins/metrics.js";
import { RATE_LIMITS } from "../../lib/limits.js";
import { invalidRequest } from "../../lib/errors.js";
import type { PgPoolLike } from "../types.js";

const FORBIDDEN_ANALYTICS_KEYS = new Set([
  "lat", "lng", "latitude", "longitude", "originlat", "originlng", "coord",
]);

const INTERACTION_MAP: Record<string, string> = {
  event_selected: "select",
  event_sheet_expanded: "expand",
  ticket_clicked: "ticket_click",
  route_preview_requested: "route_preview",
  navigation_started: "navigation_start",
};

export function registerSystemRoutes(app: FastifyInstance, db: PgPoolLike): void {
  app.get("/v1/health", async () => {
    const { rows } = await db.query<{ ok: boolean }>("SELECT TRUE AS ok");
    return {
      status: rows[0]?.ok === true ? "ok" : "degraded",
      time: new Date().toISOString(),
    };
  });

  // Phase C — effective flags = compiled defaults overridden by DB rows.
  async function effectiveFlags() {
    const merged = { ...DEFAULT_FEATURE_FLAGS };
    try {
      const { rows } = await db.query<{ key: string; enabled: boolean }>(
        "SELECT key, enabled FROM feature_flag_overrides",
      );
      for (const row of rows) {
        if (row.key in merged) {
          (merged as Record<string, boolean>)[row.key] = row.enabled;
        }
      }
    } catch {
      // Table missing pre-migration → defaults remain authoritative.
    }
    return merged;
  }

  function requireAdmin(headers: Record<string, unknown>): void {
    const token = process.env.ADMIN_TOKEN;
    if (!token) {
      // Admin surface is entirely absent without an explicit admin token.
      throw Object.assign(new Error("Not found"), { statusCode: 404, code: "FORBIDDEN" });
    }
    if (headers.authorization !== `Bearer ${token}`) {
      throw Object.assign(new Error("Forbidden"), { statusCode: 403, code: "FORBIDDEN" });
    }
  }

  app.get("/v1/config", async () => ({
    flags: await effectiveFlags(),
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
  }));

  app.put("/v1/admin/flags", async (req, reply) => {
    requireAdmin(req.headers);
    const b = req.body as { key?: string; enabled?: boolean; reason?: string };
    if (!b.key || typeof b.enabled !== "boolean") throw invalidRequest("key and enabled required");
    reply.code(200);
    await db.query(
      `INSERT INTO feature_flag_overrides (key, enabled, reason, updated_by)
       VALUES ($1,$2,$3,'admin')
       ON CONFLICT (key) DO UPDATE SET enabled=EXCLUDED.enabled,
         reason=EXCLUDED.reason, updated_at=now()`,
      [b.key, b.enabled, b.reason ?? null],
    );
    return { key: b.key, enabled: b.enabled };
  });

  // Phase D — provider ingestion (flag-gated; dry-run supported).
  app.post("/v1/admin/ingest/ticketmaster", async (req, reply) => {
    requireAdmin(req.headers);
    const { orchestrateTicketmasterIngestion } = await import("../ingestion/orchestrator.js");
    const b = req.body as { dryRun?: boolean } | null;
    const flags = await effectiveFlags();
    if (!flags.ticketmaster_enabled && !b?.dryRun) {
      return reply.status(409).send({
        error: { code: "PROVIDER_UNAVAILABLE", message: "ticketmaster_enabled flag is off", requestId: null },
      });
    }
    const outcome = await orchestrateTicketmasterIngestion(db, {
      apiKey: process.env.TICKETMASTER_API_KEY,
      dryRun: b?.dryRun === true,
    });
    return outcome;
  });

  app.post("/v1/auth/session", { config: { rateLimit: RATE_LIMITS.sessionCreate } }, async (_req, reply) => {
    const session = await createAnonymousSession(db);
    reply.code(201);
    return { token: session.token };
  });

  app.post("/v1/analytics/batch", { config: { rateLimit: RATE_LIMITS.analyticsBatch } }, async (req) => {
    const body = req.body as {
      events?: Array<{ name?: string; payload?: Record<string, unknown> }>;
    };
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length === 0 || events.length > 100) throw invalidRequest("events batch size 1..100");

    const sessionHash = req.user
      ? crypto.createHash("sha256").update(req.user.sessionId).digest("hex").slice(0, 24)
      : null;

    let stored = 0;
    for (const item of events) {
      const name = typeof item.name === "string" ? item.name : "";
      if (!name) continue;
      const payload = (item.payload ?? {}) as Record<string, unknown>;
      // Privacy boundary: raw coordinates may never ride analytics payloads.
      for (const key of Object.keys(payload)) {
        if (FORBIDDEN_ANALYTICS_KEYS.has(key.toLowerCase())) {
          throw invalidRequest(`payload contains forbidden coordinate key: ${key}`);
        }
      }
      const eventId = typeof payload["event_id"] === "string" ? payload["event_id"] : null;
      const interaction = INTERACTION_MAP[name];
      if (interaction && eventId && /^[0-9a-f-]{36}$/i.test(eventId)) {
        await db.query(
          `INSERT INTO event_interactions (user_id, anonymous_session_id, event_id, interaction_type, metadata)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            req.user?.userId ?? null,
            sessionHash,
            eventId,
            interaction,
            JSON.stringify(Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v)]))),
          ],
        );
        if (interaction === "route_preview" || interaction === "navigation_start") {
          app.heat.markDirty(eventId);
        }
        stored += 1;
      }
    }
    metrics.inc("heat_analytics_events_stored_total", {}, stored);
    return { accepted: events.length, stored };
  });

  app.get("/v1/cities/:cityKey", { config: { rateLimit: RATE_LIMITS.cities } }, async (req) => {
    const key = (req.params as { cityKey: string }).cityKey;
    const city = findCity(key);
    if (!city) {
      throw Object.assign(new Error("City not found"), { statusCode: 404, code: "VENUE_NOT_FOUND" });
    }
    return city;
  });

  app.get("/v1/metrics", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (_req, reply) => {
    reply.header("content-type", "text/plain; version=0.0.4");
    return metrics.render();
  });
}
