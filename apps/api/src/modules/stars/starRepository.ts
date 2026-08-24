/**
 * P5 — Star repository. Idempotent star/unstar; one active star per
 * (user,event) enforced by partial unique index; history preserved; aggregates
 * derived from indexed rows (no synchronous big scans).
 */
import crypto from "node:crypto";
import type { Queryable } from "../../db/pool.js";

export interface StarMutationResult {
  starred: boolean;
  starCount: number;
}

export async function starEvent(
  db: Queryable,
  eventId: string,
  userId: string,
  context: { eventStartAt: Date | null; heatScore: number | null; sourceSurface: string | null },
): Promise<StarMutationResult> {
  const client = await (db as unknown as { connect: () => Promise<import("pg").PoolClient> }).connect();
  try {
    await client.query("BEGIN");
    // Idempotent insert: on conflict (active row exists) do nothing.
    // A re-star after unstar inserts a NEW row; history rows stay removed.
    await client.query(
      `
      INSERT INTO event_stars (id, event_id, user_id, event_start_at_snapshot, heat_score_snapshot, source_surface)
      SELECT $1, $2, $3, $4, $5, $6
      WHERE EXISTS (SELECT 1 FROM events WHERE id = $2 AND deleted_at IS NULL)
      ON CONFLICT (user_id, event_id) WHERE removed_at IS NULL DO NOTHING
      `,
      [
        crypto.randomUUID(),
        eventId,
        userId,
        context.eventStartAt,
        context.heatScore,
        context.sourceSurface,
      ],
    );
    const count = await refreshStarCount(client, eventId);
    await recordInteraction(client, userId, eventId, "star");
    await client.query("COMMIT");
    return { starred: true, starCount: count };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function unstarEvent(
  db: Queryable,
  eventId: string,
  userId: string,
): Promise<StarMutationResult> {
  const client = await (db as unknown as { connect: () => Promise<import("pg").PoolClient> }).connect();
  try {
    await client.query("BEGIN");
    // Idempotent soft removal; history preserved (TC-P5-003).
    await client.query(
      `UPDATE event_stars SET removed_at = now()
       WHERE user_id = $1 AND event_id = $2 AND removed_at IS NULL`,
      [userId, eventId],
    );
    const count = await refreshStarCount(client, eventId);
    await recordInteraction(client, userId, eventId, "unstar");
    await client.query("COMMIT");
    return { starred: false, starCount: count };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function refreshStarCount(client: import("pg").PoolClient, eventId: string): Promise<number> {
  const { rows } = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM event_stars
     WHERE event_id = $1 AND removed_at IS NULL`,
    [eventId],
  );
  const count = Number(rows[0]?.c ?? "0");
  await client.query(
    "UPDATE events SET stars_count = $2, updated_at = now() WHERE id = $1",
    [eventId, count],
  );
  return count;
}

async function recordInteraction(
  client: import("pg").PoolClient,
  userId: string,
  eventId: string,
  type: "star" | "unstar",
): Promise<void> {
  await client.query(
    `INSERT INTO event_interactions (user_id, event_id, interaction_type)
     VALUES ($1, $2, $3)`,
    [userId, eventId, type],
  );
}

export interface StarAggregateMetrics {
  totalActive: number;
  new15m: number;
  new1h: number;
  new6h: number;
  new24h: number;
  velocityPerHour: number;
}

/** P5-009 — derived metrics from indexed access paths. */
export async function starAggregates(
  db: Queryable,
  eventId: string,
): Promise<StarAggregateMetrics> {
  const { rows } = await db.query<{
    total: string; w15: string; w1: string; w6: string; w24: string;
  }>(
    `
    SELECT
      COUNT(*) FILTER (WHERE removed_at IS NULL)::text AS total,
      COUNT(*) FILTER (WHERE created_at > now() - interval '15 minutes' AND removed_at IS NULL)::text AS w15,
      COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour')::text AS w1,
      COUNT(*) FILTER (WHERE created_at > now() - interval '6 hours')::text AS w6,
      COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::text AS w24
    FROM event_stars WHERE event_id = $1
    `,
    [eventId],
  );
  const r = rows[0];
  const n = (s: string | undefined): number => Number(s ?? "0");
  return {
    totalActive: n(r?.total),
    new15m: n(r?.w15),
    new1h: n(r?.w1),
    new6h: n(r?.w6),
    new24h: n(r?.w24),
    velocityPerHour: n(r?.w1),
  };
}

export function velocityPhrase(metrics: StarAggregateMetrics): string | null {
  if (metrics.new1h <= 0) return null;
  return `+${metrics.new1h} in the last hour`;
}
