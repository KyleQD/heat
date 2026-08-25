/**
 * GET /v1/search — canonical events then venues; the accessibility fallback
 * surface and the create-flow venue picker source.
 */
import type { FastifyInstance } from "fastify";
import { searchEventsAndVenues } from "./searchRepository.js";
import { invalidRequest } from "../../lib/errors.js";
import { RATE_LIMITS } from "../../lib/limits.js";
import type { PgPoolLike } from "../types.js";

export function registerSearchRoutes(app: FastifyInstance, db: PgPoolLike): void {
  app.get("/v1/search", { config: { rateLimit: RATE_LIMITS.search } }, async (req) => {
    const qs = req.query as { q?: string; limit?: string };
    const q = (qs.q ?? "").trim();
    if (q.length < 1 || q.length > 120) throw invalidRequest("q required");
    const limitRaw = Number(qs.limit ?? "10");
    const limit =
      Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 20 ? limitRaw : 10;
    const results = await searchEventsAndVenues(db, q, limit);
    return { events: results };
  });
}
