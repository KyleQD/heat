/**
 * P2-010 / P12 groundwork — map response assembly: marker records, clusters
 * (grid-based at low zoom), heat points with confidence-damped visual weight.
 */
import type { Cluster, HeatPoint, MapEvent } from "@heat/api-contracts";
import type { ConfidenceLabel, TrendLabel } from "@heat/domain";
import { computeMarkerPriority, confidenceLabel } from "../../lib/scoring.js";
import { deriveTrend } from "../../lib/trend.js";
import type { ViewportRow } from "./mapRepository.js";

export function toMapEvents(
  rows: ViewportRow[],
  now: Date,
  viewerAuthenticated: boolean,
): MapEvent[] {
  return rows.map((r) => {
    const label = confidenceLabel(r.heatConfidence, r.attendanceEstimateType);
    const trend = deriveTrend({
      now,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      heatScore: Number(r.heatScore),
      starsLastHour: Number(r.starsLastHour),
    });
    const priority = computeMarkerPriority({
      heatScore: Number(r.heatScore),
      attendanceHigh: r.attendanceHigh,
      starsLastHour: Number(r.starsLastHour),
      isActive:
        r.startsAt <= now &&
        (r.endsAt == null || r.endsAt >= now) &&
        r.status !== "canceled",
      canceled: r.status === "canceled",
      verified: r.verificationLevel !== "community",
    });
    return {
      id: r.id,
      title: r.title,
      lat: Number(r.lat),
      lng: Number(r.lng),
      startsAt: r.startsAt.toISOString() as MapEvent["startsAt"],
      endsAt: r.endsAt ? (r.endsAt.toISOString() as MapEvent["endsAt"]) : null,
      status: r.status,
      category: r.category,
      venueName: r.venueName,
      heatScore: Number(r.heatScore),
      confidence: label,
      trend,
      starCount: Number(r.starCount),
      starred: viewerAuthenticated ? Boolean(r.starred) : null,
      markerPriority: priority,
      verificationLevel: r.verificationLevel as MapEvent["verificationLevel"],
    };
  });
}

/**
 * Grid clustering for low zoom. Deterministic; cluster tap zooms in and never
 * selects an arbitrary event.
 */
export function buildClusters(events: MapEvent[], zoom: number): Cluster[] {
  if (zoom >= 13 || events.length < 4) return [];
  // Cell size grows as zoom decreases (~world width 360deg * 2^(13 - zoom)/64).
  const cellDeg = Math.max(0.02, (360 / Math.pow(2, zoom)) * 0.75);
  const buckets = new Map<string, MapEvent[]>();
  for (const e of events) {
    const key = `${Math.floor(e.lat / cellDeg)}:${Math.floor(e.lng / cellDeg)}`;
    const list = buckets.get(key);
    if (list) list.push(e);
    else buckets.set(key, [e]);
  }
  const clusters: Cluster[] = [];
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    let maxHeat = 0;
    let latSum = 0;
    let lngSum = 0;
    for (const e of list) {
      maxHeat = Math.max(maxHeat, e.heatScore);
      latSum += e.lat;
      lngSum += e.lng;
    }
    clusters.push({
      lat: latSum / list.length,
      lng: lngSum / list.length,
      count: list.length,
      maxHeatScore: maxHeat,
    });
  }
  return clusters.slice(0, 200);
}

/**
 * visual_weight = f(HEAT) x g(significance), bounded, damped for low
 * confidence so weak evidence never looks authoritative (P12).
 */
export function buildHeatPoints(events: MapEvent[]): HeatPoint[] {
  return events
    .filter((e) => e.status !== "canceled")
    .map((e) => {
      const heat = Math.pow(clamp01(e.heatScore / 100), 1.15);
      const significanceProxy = 400; // neutral prior until attendance data lands
      const scale = clamp01(Math.log1p(significanceProxy) / Math.log1p(50_000));
      const confidenceFactor =
        e.confidence === "verified_live" ? 1 : e.confidence === "high" ? 0.95 : e.confidence === "medium" ? 0.85 : 0.7;
      const weight = clamp01((0.8 * heat + 0.2 * scale) * confidenceFactor);
      return { lat: e.lat, lng: e.lng, weight: Math.round(weight * 100) / 100 };
    });
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
