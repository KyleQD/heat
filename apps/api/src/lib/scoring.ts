/**
 * Marker priority + confidence label + attendance copy (server-owned, P4).
 * marker_priority = weighted(heat_score, expected_attendance, star_velocity,
 * current_status, verification) — editorial override is NOT part of HEAT and
 * never changes the score.
 */
import type { ConfidenceLabel } from "@heat/domain";
import { normalizeVelocity } from "./trend.js";

export interface PriorityInputs {
  heatScore: number;
  attendanceHigh: number | null;
  starsLastHour: number;
  isActive: boolean;
  canceled: boolean;
  verified: boolean;
}

export function computeMarkerPriority(i: PriorityInputs): number {
  const heat = clamp01(i.heatScore / 100);
  const scale = clamp01(
    i.attendanceHigh != null ? Math.log1p(i.attendanceHigh) / Math.log1p(50_000) : 0,
  );
  const velocity = normalizeVelocity(i.starsLastHour);
  const status = i.canceled ? 0 : i.isActive ? 1 : 0.6;
  const trust = i.verified ? 1 : 0.7;

  const raw =
    0.5 * heat * status +
    0.15 * scale * status +
    0.2 * velocity * status +
    0.15 * trust * status;
  return Math.round(raw * 1000) / 10; // 0..100, one decimal
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Numeric internal confidence (0-100) -> consumer label.
 * Never infer confidence from score color; never expose raw percentage in V1.
 */
export function confidenceLabel(
  numeric: number | null,
  estimateType: string,
): ConfidenceLabel {
  if (estimateType === "verified_count") return "verified_live";
  if (numeric == null) return "estimated";
  if (numeric >= 70) return "high";
  if (numeric >= 45) return "medium";
  return "estimated";
}

/** Heat bucket for analytics payloads (no exact score needed client-side). */
export function heatBucket(score: number): string {
  if (score >= 80) return "80_100";
  if (score >= 60) return "60_79";
  if (score >= 40) return "40_59";
  return "0_39";
}
