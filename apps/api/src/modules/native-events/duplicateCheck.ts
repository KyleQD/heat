/**
 * P3 — Duplicate detection before publish. Candidate generation is bounded
 * (same venue OR nearby within radius AND overlapping time window), never a
 * full scan. Match scoring mirrors resolution weights: venue 30 / time 30 /
 * title 20 / category 20 (performer absent at creation).
 */
import type { Queryable } from "../../db/pool.js";
import type { DuplicateCandidate } from "@heat/api-contracts";
import { titleSimilarity } from "../../lib/normalize.js";

export interface DuplicateProbe {
  title: string;
  category: string;
  startsAt: Date;
  endsAt: Date;
  location: { lat: number; lng: number; venueId?: string | null };
}

const RADIUS_METERS = 400;
const TIME_WINDOW_MS = 6 * 3_600_000;

export async function findDuplicateCandidates(
  db: Queryable,
  probe: DuplicateProbe,
): Promise<DuplicateCandidate[]> {
  const halfWindowMs = TIME_WINDOW_MS / 2;
  const { rows } = await db.query<{
    id: string;
    title: string;
    venueName: string | null;
    startsAt: Date;
    distanceMeters: number | null;
    normalizedTitle: string;
    categoryKey: string;
  }>(
    `
    SELECT e.id, e.title,
           v.name AS "venueName",
           e.starts_at AS "startsAt",
           ST_Distance(e.location, ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography)::int AS "distanceMeters",
           e.normalized_title AS "normalizedTitle",
           cat.key AS "categoryKey"
    FROM events e
    JOIN event_categories cat ON cat.id = e.category_id
    LEFT JOIN venues v ON v.id = e.venue_id
    WHERE e.deleted_at IS NULL
      AND e.visibility_status = 'published'
      AND (ST_DWithin(e.location, ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography, 400)
           OR ($3::uuid IS NOT NULL AND e.venue_id = $3::uuid))
      AND e.starts_at BETWEEN $4 AND $5
      AND e.status <> 'canceled'
    ORDER BY e.starts_at
    LIMIT 25
    `,
    [
      probe.location.lat,
      probe.location.lng,
      probe.location.venueId ?? null,
      new Date(probe.startsAt.getTime() - halfWindowMs),
      new Date(probe.endsAt.getTime() + halfWindowMs),
    ],
  );

  const candidates: Array<DuplicateCandidate & { _score: number }> = [];
  for (const r of rows) {
    const titleScore = titleSimilarity(probe.title, r.title);
    const startDeltaMs = Math.abs(r.startsAt.getTime() - probe.startsAt.getTime());
    const timeScore = Math.max(0, 1 - startDeltaMs / TIME_WINDOW_MS);
    const sameVenue = probe.location.venueId != null && r.venueName != null;
    const proximity = r.distanceMeters == null ? 0 : Math.max(0, 1 - r.distanceMeters / RADIUS_METERS);
    const venueScore = sameVenue ? 1 : proximity * 0.8;
    const categoryScore = probe.category === r.categoryKey ? 1 : 0;

    // Weights per doc 06 (illustrative seed config): venue .30 time .30 title .20 other .20
    const score = 0.3 * venueScore + 0.3 * timeScore + 0.2 * titleScore + 0.2 * categoryScore;
    if (score < 0.45) continue;
    const reasons: string[] = [];
    if (titleScore >= 0.7) reasons.push("similar_title");
    if (sameVenue || proximity > 0.6) reasons.push("same_venue_or_location");
    if (timeScore >= 0.75) reasons.push("overlapping_time");
    if (categoryScore === 1 && score >= 0.6) reasons.push("same_category");
    candidates.push({
      eventId: r.id,
      title: r.title,
      venueName: r.venueName,
      startsAt: r.startsAt.toISOString() as DuplicateCandidate["startsAt"],
      distanceMeters: r.distanceMeters,
      matchConfidence: Math.round(score * 100) / 100,
      reasons,
      _score: score,
    });
  }
  return candidates
    .sort((a, b) => b._score - a._score)
    .slice(0, 5)
    .map(({ _score: _s, ...c }) => c);
}
