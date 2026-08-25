/**
 * HEAT API — application factory. Composition only: plugins, hooks, error
 * mapping, module registration. Route logic lives in src/modules/*.
 *
 * Every response is canonical; every error uses stable codes; structured logs
 * carry request IDs and never contain tokens/secrets/exact coordinates.
 */
import crypto from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { loadEnv, type Env } from "./env.js";
import { getPool, closePool } from "./db/pool.js";
import { resolveUser } from "./plugins/auth.js";
import { metrics } from "./plugins/metrics.js";
import { MapResponseCache } from "./modules/map/mapCache.js";
import { HeatRecalculator } from "./modules/heat/engine.js";
import { AppError } from "./lib/errors.js";
import { registerSystemRoutes } from "./modules/system/system.routes.js";
import { registerMapRoutes } from "./modules/map/map.routes.js";
import { registerEventRoutes } from "./modules/events/events.routes.js";
import { registerStarRoutes } from "./modules/stars/stars.routes.js";
import { registerRoutingRoutes } from "./modules/routing/routing.routes.js";
import { registerNativeEventRoutes } from "./modules/native-events/nativeEvents.routes.js";
import { registerSearchRoutes } from "./modules/search/search.routes.js";

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

/** Routes that never need session resolution. */
const PUBLIC_PATH_PREFIXES = ["/v1/health", "/v1/config", "/v1/metrics"];

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

  await app.register(rateLimit, { global: false });

  // statement_timeout bounds any runaway spatial query (SLO protection);
  // idle_in_transaction prevents leaked transactions from holding locks.
  const db = getPool({
    ...env,
    DATABASE_URL: env.DATABASE_URL,
  });
  await db.query("SET statement_timeout = '8s'");
  void import("./db/pool.js").then(({ onNewClient }) => {
    onNewClient((client) => {
      void client.query("SET statement_timeout = '8s'");
    });
  });

  const mapCache = new MapResponseCache();
  const heat = new HeatRecalculator(() => db);
  // Doc 48 invalidation trigger: HEAT changes above threshold bust the epoch.
  heat.onMaterialChange = () => mapCache.invalidateAll();
  heat.start();
  app.decorate("heat", heat);
  app.decorate("mapCache", mapCache);

  metrics.registerGauge("heat_map_cache_entries", () => mapCache.size);
  metrics.registerGauge("heat_recalc_dirty_events", () => heat.dirtyCount);

  // -- Session resolution (skipped for public system routes) ---------------
  app.addHook("onRequest", async (req) => {
    req.user = null;
    const url = req.routeOptions?.url;
    if (!url || PUBLIC_PATH_PREFIXES.some((p) => url.startsWith(p))) return;
    try {
      await resolveUser(db, req);
    } catch {
      req.user = null;
    }
  });

  // -- Structured logs + SLO metrics ---------------------------------------
  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions?.url ?? "unmatched";
    const latencyMs = reply.elapsedTime;
    req.log.info(
      {
        route,
        status: reply.statusCode,
        latencyMs: latencyMs.toFixed(1),
        authState: req.user ? "authenticated" : "anonymous",
      },
      "request_complete",
    );
    if (route.startsWith("/v1")) {
      metrics.inc("http_requests_total", {
        route,
        status: String(reply.statusCode),
      });
      metrics.observeLatency(route, latencyMs);
    }
  });

  // -- Stable error contract -----------------------------------------------
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      metrics.inc("http_errors_total", { code: err.code });
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

  // -- Modules --------------------------------------------------------------
  registerSystemRoutes(app, db);
  registerMapRoutes(app, db);
  registerEventRoutes(app, db);
  registerStarRoutes(app, db);
  registerRoutingRoutes(app, db);
  registerNativeEventRoutes(app, db);
  registerSearchRoutes(app, db);

  // -- Housekeeping ----------------------------------------------------------
  // Expired/revoked sessions otherwise accumulate forever.
  const sessionCleanup = setInterval(
    () => {
      void db
        .query(
          `DELETE FROM sessions WHERE expires_at < now() - interval '7 days'
             OR revoked_at < now() - interval '30 days'`,
        )
        .catch(() => undefined);
    },
    60 * 60 * 1000,
  );
  sessionCleanup.unref?.();

  app.addHook("onClose", async () => {
    heat.stop();
    clearInterval(sessionCleanup);
    await closePool();
  });

  return app;
}
