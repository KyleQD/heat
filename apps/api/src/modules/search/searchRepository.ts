/**
 * P1-011 accessibility fallback + P3 venue search. Order: canonical events →
 * canonical venues. Never strands the user off-map: results carry IDs.
 */
import type { Queryable } from "../../db/pool.js";
import type { IsoDateTime, SearchResultItem } from "@heat/api-contracts";

export async function searchEventsAndVenues(
  db: Queryable,
  q: string,
  limit: number,
): Promise<SearchResultItem[]> {
  const like = `%${q.trim().toLowerCase()}%`;
  const { rows } = await db.query<{
    kind: "event" | "venue";
    id: string;
    title: string;
    subtitle: string | null;
    lat: number;
    lng: number;
    heatScore: number | null;
    startsAt: Date | null;
  }>(
    `
    (
      SELECT 'event' AS kind,
             e.id, e.title AS title,
             v.name AS subtitle,
             ST_Y(e.location::geometry) AS lat,
             ST_X(e.location::geometry) AS lng,
             e.heat_score AS "heatScore",
             e.starts_at AS "startsAt"
      FROM events e
      LEFT JOIN venues v ON v.id = e.venue_id
      WHERE e.deleted_at IS NULL AND e.visibility_status = 'published'
        AND (e.normalized_title LIKE $1 OR LOWER(e.title) LIKE $1)
      ORDER BY COALESCE(e.heat_score, 0) DESC, e.starts_at ASC
      LIMIT $2
    )
    UNION ALL
    (
      SELECT 'venue' AS kind,
             v.id, v.name AS title,
             v.locality AS subtitle,
             ST_Y(v.location::geometry) AS lat,
             ST_X(v.location::geometry) AS lng,
             NULL AS "heatScore",
             NULL AS "startsAt"
      FROM venues v
      WHERE normalized_name LIKE $1 OR LOWER(name) LIKE $1
      LIMIT $2
    )
    `,
    [like, limit],
  );

  return rows.map((r) =>
    r.kind === "event"
      ? {
          type: "event" as const,
          eventId: r.id,
          title: r.title,
          subtitle: r.subtitle,
          lat: Number(r.lat),
          lng: Number(r.lng),
          heatScore: Number(r.heatScore ?? 0),
          startsAt: r.startsAt ? (new Date(r.startsAt).toISOString() as IsoDateTime) : null,
        }
      : {
          type: "venue" as const,
          venueId: r.id,
          name: r.title,
          locality: r.subtitle,
          lat: Number(r.lat),
          lng: Number(r.lng),
        },
  );
}
