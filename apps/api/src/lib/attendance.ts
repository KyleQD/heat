/**
 * Attendance copy rules (P4-007, docs 45 §8). Server owns the language so
 * mobile can never accidentally present a forecast as a live count.
 */
import type { AttendanceEstimateType } from "@heat/domain";

export function formatCompactCount(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}K`;
  return String(n);
}

function trim(x: number): string {
  const s = x.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/**
 * Rules:
 * - pre-event forecast -> "~1.2K–1.6K expected"
 * - during event without live evidence -> still "Expected crowd ~1.2K–1.6K"
 * - verified live count -> "~1.1K–1.4K here now"
 * - unknown -> null (UI omits the row; never invent numbers)
 */
export function attendanceDisplayText(
  low: number | null,
  high: number | null,
  type: AttendanceEstimateType,
): string | null {
  if (low == null || high == null || high < low) return null;
  switch (type) {
    case "verified_count":
      return `~${formatCompactCount(low)}–${formatCompactCount(high)} here now`;
    case "live_estimate":
      return `~${formatCompactCount(low)}–${formatCompactCount(high)} here now`;
    case "organizer_reported":
      return `${formatCompactCount(low)}–${formatCompactCount(high)} expected (organizer)`;
    case "pre_event_forecast":
    case "intent_adjusted_forecast":
      return `~${formatCompactCount(low)}–${formatCompactCount(high)} expected`;
    case "unknown":
      return null;
  }
}
