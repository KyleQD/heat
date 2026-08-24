/**
 * P2-009 — Viewport repository. Returns ONLY what markers need (no
 * descriptions/images/raw payloads). Query must hit GIST(events.location).
 */
import type { Queryable } from "../../db/pool.js";
import type { MapEvent } from "@heat/api-contracts";

export interface ViewportParams {
  north: number;
  south: number;
  east: number;
  west: number;
  windowStart: Date;
  windowEnd: Date;
  category?: string | undefined;
  starredOnly: boolean;
  viewerUserId: string | null;
  /** Server-side density cap; server simplifies rather than oversizing. */
  limit: number;
}

export interface ViewportRow {
  id: string;
  title: string;
  lat: number;
  lng: number;
  startsAt: Date;
  endsAt: Date | null;
  status: string;
  category: string;
  venueName: string | null;
  heatScore: number;
  heatConfidence: number | null;
  attendanceLow: number | null;
  attendanceHigh: number | null;
  attendanceEstimateType: string;
  starCount: number;
  starred: boolean;
  verificationLevel: string;
  starsLastHour: number;
}

const DEFAULT_DURATION = "interval '4 hours'";

export async function queryViewport(
  db: Queryable,
  p: ViewportParams,
): Promise<ViewportRow[]> {
  const { rows } = await db.query<ViewportRow>(
    `
    WITH env AS (
      SELECT ST_SetSRID(ST_MakeEnvelope($1, $2, $3, $4), 4326)::geography AS g
    )
    SELECT
      e.id,
      e.title,
      ST_Y(e.location::geometry) AS "lat",
      ST_X(e.location::geometry) AS "lng",
      e.starts_at      AS "startsAt",
      e.ends_at        AS "endsAt",
      e.status,
      cat.key          AS category,
      v.name           AS "venueName",
      COALESCE(e.heat_score, 0)                AS "heatScore",
      e.heat_confidence                        AS "heatConfidence",
      e.attendance_low                         AS "attendanceLow",
      e.attendance_high                        AS "attendanceHigh",
      e.attendance_estimate_type               AS "attendanceEstimateType",
      e.stars_count                            AS "starCount",
      e.verification_level                     AS "verificationLevel",
      EXISTS (
        SELECT 1 FROM event_stars s
        WHERE s.event_id = e.id AND s.user_id = $6 AND s.removed_at IS NULL
      )                                        AS "starred",
      COALESCE(sv.stars_1h, 0)                 AS "starsLastHour"
    FROM events e
    JOIN event_categories cat ON cat.id = e.category_id
    LEFT JOIN venues v ON v.id = e.venue_id
    CROSS JOIN env
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS stars_1h
      FROM event_stars s2
      WHERE s2.event_id = e.id AND s2.removed_at IS NULL
        AND s2.created_at > now() - interval '1 hour'
    ) sv ON TRUE
    WHERE e.visibility_status = 'published'
      AND e.deleted_at IS NULL
      AND e.starts_at <= $5
      AND COALESCE(e.ends_at, e.starts_at + ${DEFAULT_DURATION}) >= $7::timestamptz - ${DEFAULT_DURATION}
      AND ST_Intersects(e.location, env.g)
      AND ($8::text IS NULL OR cat.key = $8)
    ORDER BY
      CASE WHEN e.status = 'canceled' THEN 1 ELSE 0 END,
      COALESCE(e.heat_score, 0) DESC,
      e.stars_count DESC,
      e.starts_at ASC
    LIMIT $9
    `,
    [
      p.west,
      p.south,
      p.east,
      p.north,
      p.windowEnd,
      p.viewerUserId ?? null,
      p.windowStart,
      p.category ?? null,
      p.limit,
    ],
  );

  const filtered = p.starredOnly ? rows.filter((r) => r.starred) : rows;
  return filtered.map((r) => ({
    ...r,
    startsAt: new Date(r.startsAt),
    endsAt: r.endsAt ? new Date(r.endsAt) : null,
  }));
}
