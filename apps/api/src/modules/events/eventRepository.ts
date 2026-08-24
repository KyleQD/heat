/**
 * Event detail (P2-011 / P4). Canonical identity only; never raw payloads.
 */
import type { Queryable } from "../../db/pool.js";
import type { EventDetailResponse } from "@heat/api-contracts";
import type { ConfidenceLabel, TrendLabel, AttendanceEstimateType } from "@heat/domain";

export interface EventDetailRow {
  id: string;
  title: string;
  description: string | null;
  categoryKey: string;
  status: string;
  visibilityStatus: string;
  verificationLevel: string;
  venueId: string | null;
  venueName: string | null;
  venueAddress: string | null;
  locality: string | null;
  capacity: number | null;
  lat: number;
  lng: number;
  timezone: string;
  startsAt: Date;
  endsAt: Date | null;
  startsAtPrecision: string;
  priceMin: string | null;
  priceMax: string | null;
  currency: string | null;
  ticketUrl: string | null;
  coverImageUrl: string | null;
  ageRestriction: string | null;
  heatScore: number;
  heatConfidence: number | null;
  attendanceLow: number | null;
  attendanceHigh: number | null;
  attendanceEstimateType: string;
  starsCount: number;
  sourceCount: number;
  createdBy: string | null;
  viewerStarred: boolean;
  starsLastHour: number;
}

export async function fetchEventDetail(
  db: Queryable,
  eventId: string,
  viewerUserId: string | null,
): Promise<EventDetailRow | null> {
  const { rows } = await db.query<EventDetailRow>(
    `
    SELECT
      e.id, e.title, e.description,
      cat.key AS "categoryKey",
      e.status, e.visibility_status AS "visibilityStatus",
      e.verification_level AS "verificationLevel",
      v.id AS "venueId", v.name AS "venueName",
      NULLIF(TRIM(CONCAT_WS(', ', v.street_address, v.locality)), '') AS "venueAddress",
      v.locality, v.capacity,
      ST_Y(e.location::geometry) AS "lat",
      ST_X(e.location::geometry) AS "lng",
      e.timezone,
      e.starts_at AS "startsAt", e.ends_at AS "endsAt",
      COALESCE(e.starts_at_precision, 'exact') AS "startsAtPrecision",
      e.price_min::text AS "priceMin", e.price_max::text AS "priceMax",
      e.currency, e.canonical_ticket_url AS "ticketUrl",
      e.cover_image_url AS "coverImageUrl", e.age_restriction AS "ageRestriction",
      COALESCE(e.heat_score, 0) AS "heatScore",
      e.heat_confidence AS "heatConfidence",
      e.attendance_low AS "attendanceLow",
      e.attendance_high AS "attendanceHigh",
      e.attendance_estimate_type AS "attendanceEstimateType",
      e.stars_count AS "starsCount",
      e.source_count AS "sourceCount",
      e.created_by AS "createdBy",
      EXISTS (
        SELECT 1 FROM event_stars s
        WHERE s.event_id = e.id AND s.user_id = $2 AND s.removed_at IS NULL
      ) AS "viewerStarred",
      (
        SELECT COUNT(*)::int FROM event_stars s2
        WHERE s2.event_id = e.id AND s2.removed_at IS NULL
          AND s2.created_at > now() - interval '1 hour'
      ) AS "starsLastHour"
    FROM events e
    JOIN event_categories cat ON cat.id = e.category_id
    LEFT JOIN venues v ON v.id = e.venue_id
    WHERE e.id = $1 AND e.deleted_at IS NULL
      AND e.visibility_status IN ('published')
    `,
    [eventId, viewerUserId],
  );
  return rows[0] ?? null;
}

export function presentEventDetail(
  row: EventDetailRow,
  opts: { now: Date; confidenceLabelText: string; trendText: string; velocityPhrase: string | null; attendanceText: string | null; canEdit: boolean; canReport: boolean; canClaim: boolean },
): EventDetailResponse {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.categoryKey,
    status: row.status,
    verificationLevel: row.verificationLevel as EventDetailResponse["verificationLevel"],
    venue:
      row.venueId != null || row.venueName != null
        ? {
            id: row.venueId,
            name: row.venueName,
            address: row.venueAddress,
            locality: row.locality,
            capacity: row.capacity,
          }
        : null,
    location: { lat: Number(row.lat), lng: Number(row.lng) },
    timezone: row.timezone,
    startsAt: row.startsAt.toISOString() as EventDetailResponse["startsAt"],
    endsAt: row.endsAt ? (row.endsAt.toISOString() as EventDetailResponse["endsAt"]) : null,
    startsAtPrecision: row.startsAtPrecision as "exact" | "time_tbd" | "date_tbd" | "date_only",
    priceMin: row.priceMin != null ? Number(row.priceMin) : null,
    priceMax: row.priceMax != null ? Number(row.priceMax) : null,
    currency: row.currency,
    ticketUrl: row.ticketUrl,
    coverImageUrl: row.coverImageUrl,
    ageRestriction: row.ageRestriction,
    heat: {
      score: Number(row.heatScore),
      confidenceLabel: opts.confidenceLabelText as ConfidenceLabel,
      trend: opts.trendText as TrendLabel,
      attendanceEstimate:
        row.attendanceLow != null && row.attendanceHigh != null
          ? {
              low: row.attendanceLow,
              high: row.attendanceHigh,
              type: row.attendanceEstimateType as AttendanceEstimateType,
              displayText: opts.attendanceText,
            }
          : null,
    },
    stars: {
      count: Number(row.starsCount),
      starredByViewer: Boolean(row.viewerStarred),
      velocityPhrase: opts.velocityPhrase,
    },
    routeDestination: { lat: Number(row.lat), lng: Number(row.lng) },
    canEdit: opts.canEdit,
    canReport: opts.canReport,
    canClaim: opts.canClaim,
    sourceCount: Number(row.sourceCount),
  };
}
