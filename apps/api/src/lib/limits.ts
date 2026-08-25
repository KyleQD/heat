/**
 * Shared API limits: rate-limit presets, viewport guards, response budgets.
 * Centralized so SLO tuning never requires touching route handlers.
 */
import type { MapEventsQuery } from "@heat/api-contracts";

/** Rate-limit presets (per IP). */
export const RATE_LIMITS = {
  /** Read-heavy public surface — protects the spatial query path. */
  mapRead: { max: 240, timeWindow: "1 minute" },
  detailRead: { max: 180, timeWindow: "1 minute" },
  search: { max: 60, timeWindow: "1 minute" },
  sessionCreate: { max: 20, timeWindow: "1 minute" },
  starWrite: { max: 60, timeWindow: "1 minute" },
  routePreview: { max: 30, timeWindow: "1 minute" },
  eventCreate: { max: 10, timeWindow: "1 hour" },
  reports: { max: 5, timeWindow: "1 hour" },
  analyticsBatch: { max: 30, timeWindow: "1 minute" },
} as const;

/** Absolute coordinate sanity (degrees). */
const MAX_LAT_SPAN = 15;
const MAX_LNG_SPAN = 45;

/** Slack between the zoom a client claims and the zoom its bbox implies. */
const ZOOM_CONSISTENCY_TOLERANCE = 4.5;

/**
 * World-size bbox rejection (doc 48 acceptance) plus zoom-consistency:
 * a bbox spanning S degrees of longitude implies zoom ≈ log2(360/S). Real
 * map clients always send matching pairs; mismatched pairs indicate abuse or
 * bugs and are rejected before touching PostGIS.
 */
export function validateViewportBounds(q: {
  north: number; south: number; east: number; west: number; zoom: number;
}): string | null {
  const latSpan = q.north - q.south;
  const lngSpan = q.east - q.west;

  if (latSpan > MAX_LAT_SPAN || lngSpan > MAX_LNG_SPAN) {
    return "viewport too large";
  }
  const impliedZoom = Math.log2(360 / Math.max(lngSpan, 1e-6));
  if (Math.abs(impliedZoom - q.zoom) > ZOOM_CONSISTENCY_TOLERANCE) {
    return "bbox inconsistent with zoom level";
  }
  return null;
}

/**
 * Density budgets shrink as zoom decreases — at metro scale the client renders
 * clusters, so individual marker rows are capped lower (doc 48 "server
 * simplifies rather than returning huge payloads").
 */
export function eventBudgetForZoom(zoom: number): number {
  if (zoom >= 14) return 400;
  if (zoom >= 12) return 220;
  return 140;
}
