/**
 * Auth (P0/ADR-0005): anonymous browsing; sessions required at first
 * state-changing action. A session token maps 1:1 to an internal user row.
 * Tokens arrive as `Authorization: Bearer <token>` or `X-HEAT-Session`.
 */
import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Queryable } from "../db/pool.js";

export interface RequestUser {
  userId: string;
  sessionId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: RequestUser | null;
  }
}

export async function createAnonymousSession(
  db: Queryable,
): Promise<{ token: string; userId: string }> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO users (id, auth_provider) VALUES ($1, 'anonymous') RETURNING id",
    [crypto.randomUUID()],
  );
  const userId = rows[0]!.id;
  const token = `heat_${crypto.randomBytes(24).toString("base64url")}`;
  await db.query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + interval '180 days')`,
    [token, userId],
  );
  return { token, userId };
}

export function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const alt = req.headers["x-heat-session"];
  if (typeof alt === "string" && alt.length > 0) return alt.trim();
  return null;
}

/** last_seen_at write throttle: at most one UPDATE per token per minute. */
const lastSeenWrites = new Map<string, number>();
const LAST_SEEN_INTERVAL_MS = 60_000;

function shouldTouchSession(token: string, now: number): boolean {
  const last = lastSeenWrites.get(token) ?? 0;
  if (now - last < LAST_SEEN_INTERVAL_MS) return false;
  lastSeenWrites.set(token, now);
  // Bounded memory: prune occasionally.
  if (lastSeenWrites.size > 5000) {
    const cutoff = now - LAST_SEEN_INTERVAL_MS * 2;
    for (const [t, ts] of lastSeenWrites) {
      if (ts < cutoff) lastSeenWrites.delete(t);
    }
  }
  return true;
}

export async function resolveUser(
  db: Queryable,
  req: FastifyRequest,
): Promise<RequestUser | null> {
  const token = extractToken(req);
  if (!token) {
    req.user = null;
    return null;
  }
  const { rows } = await db.query<{ user_id: string; revoked_at: Date | null }>(
    `SELECT s.user_id, s.revoked_at FROM sessions s
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  const row = rows[0];
  if (!row || row.revoked_at != null) {
    req.user = null;
    return null;
  }
  if (shouldTouchSession(token, Date.now())) {
    await db
      .query("UPDATE sessions SET last_seen_at = now() WHERE token = $1", [token])
      .catch(() => undefined); // freshness is best-effort; never block reads
  }
  req.user = { userId: row.user_id, sessionId: token };
  return req.user;
}

export function requireUser(req: FastifyRequest): RequestUser {
  if (!req.user) {
    throw Object.assign(new Error("Authentication required"), {
      statusCode: 401,
      code: "AUTH_REQUIRED",
    });
  }
  return req.user;
}

/** Reply helper for auth errors with the stable contract shape. */
export function authRequiredError(): Error & { statusCode: number; code: string } {
  return Object.assign(new Error("Authentication required"), {
    statusCode: 401,
    code: "AUTH_REQUIRED",
  }) as Error & { statusCode: number; code: string };
}
