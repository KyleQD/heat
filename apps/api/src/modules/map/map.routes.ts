/**
 * GET /v1/map/events — viewport query with cache-aside single-flight,
 * world-size bbox rejection, and zoom-aware density budgets (doc 48).
 */
import type { FastifyInstance } from "fastify";
import { LAS_VEGAS, resolveTimeWindow } from "@heat/config";
import { mapEventsQuerySchema, type MapEventsResponse } from "@heat/api-contracts";
import { DEFAULT_FEATURE_FLAGS } from "@heat/config";
import { queryViewport } from "./mapRepository.js";
import { buildClusters, buildHeatPoints, toMapEvents } from "./mapPresenter.js";
import { ttlForWindow } from "./mapCache.js";
import { eventBudgetForZoom, RATE_LIMITS, validateViewportBounds } from "../../lib/limits.js";
import { invalidRequest } from "../../lib/errors.js";
import { metrics } from "../../plugins/metrics.js";
import type { PgPoolLike } from "../types.js";

export function registerMapRoutes(app: FastifyInstance, db: PgPoolLike): void {
  app.get("/v1/map/events", { config: { rateLimit: RATE_LIMITS.mapRead } }, async (req) => {
    const parsed = mapEventsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw invalidRequest(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const q = parsed.data;

    // World-size / zoom-inconsistent viewports are rejected outright.
    const boundsError = validateViewportBounds(q);
    if (boundsError) throw invalidRequest(boundsError);

    const budget = eventBudgetForZoom(q.zoom);
    // R2-002 — personalized requests are NEVER served from the shared cache:
    // starredOnly results are actor-dependent even without includeStarredState.
    const personalized =
      req.user != null &&
      (q.includeStarredState === true || q.starredOnly === true);
    const window_ = resolveTimeWindow(q.window, LAS_VEGAS);

    const load = async (): Promise<MapEventsResponse> => {
      const now = new Date();
      const rows = await queryViewport(db, {
        north: q.north,
        south: q.south,
        east: q.east,
        west: q.west,
        windowStart: window_.start,
        windowEnd: window_.end,
        category: q.category,
        starredOnly: q.starredOnly === true,
        viewerUserId: req.user?.userId ?? null,
        limit: budget,
      });

      const events = toMapEvents(rows, now, q.includeStarredState === true && req.user != null);
      const clusters = buildClusters(events, q.zoom);
      const heatPoints =
        DEFAULT_FEATURE_FLAGS.map_heat_layer_enabled && q.zoom >= 9 ? buildHeatPoints(events) : [];

      return {
        generatedAt: now.toISOString() as MapEventsResponse["generatedAt"],
        window: {
          label: q.window,
          start: window_.start.toISOString() as MapEventsResponse["window"]["start"],
          end: window_.end.toISOString() as MapEventsResponse["window"]["end"],
        },
        viewport: { north: q.north, south: q.south, east: q.east, west: q.west, zoom: q.zoom },
        events,
        clusters,
        heatPoints,
      };
    };

    if (personalized) {
      return load();
    }

    const key = app.mapCache.key({
      north: q.north, south: q.south, east: q.east, west: q.west,
      zoom: q.zoom, window: q.window,
      category: q.category ?? null,
      starredOnly: q.starredOnly === true && req.user == null,
    });
    const { body, hit } = await app.mapCache.getOrLoad(key, ttlForWindow(q.window), load);
    metrics.inc(hit ? "heat_map_cache_hits_total" : "heat_map_cache_misses_total");
    return body;
  });
}
