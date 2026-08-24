/**
 * Trend derivation (P4/P11). Trend is derived separately from the raw HEAT
 * score and is explainable + testable. Inputs: lifecycle phase, heat score,
 * and a momentum proxy (1h star velocity normalized 0..1).
 */
import type { LifecyclePhase, TrendLabel } from "@heat/domain";

export interface TrendInputs {
  now: Date;
  startsAt: Date;
  endsAt: Date | null;
  heatScore: number;
  /** New stars in last hour (or route velocity proxy). */
  starsLastHour: number;
}

export function lifecyclePhase(
  now: Date,
  startsAt: Date,
  endsAt: Date | null,
): LifecyclePhase {
  const ms = startsAt.getTime() - now.getTime();
  const h = ms / 3_600_000;
  if (h > 24) return "far_future";
  if (h > 6) return "today_pre_event";
  if (h > 2) return "soon";
  if (h > 0.5) return "starting";
  const end = endsAt ?? new Date(startsAt.getTime() + 4 * 3_600_000);
  const remaining = end.getTime() - now.getTime();
  if (remaining <= 0) return "ended";
  const total = Math.max(end.getTime() - startsAt.getTime(), 1);
  if (remaining / total < 0.2 || remaining < 60 * 60_000) return "ending";
  return "active";
}

/**
 * Explainable mapping:
 * - explicit time states win (upcoming/ending),
 * - high score + high velocity => surging/hot/peaking,
 * - mid score or moderate velocity => heating_up/warming_up/steady.
 */
export function deriveTrend(inputs: TrendInputs): TrendLabel {
  const phase = lifecyclePhase(inputs.now, inputs.startsAt, inputs.endsAt);

  if (phase === "far_future" || phase === "today_pre_event") return "upcoming";
  if (phase === "ended") return "steady";
  if (phase === "ending") {
    return inputs.heatScore >= 70 ? "peaking" : "cooling_down";
  }

  const v = normalizeVelocity(inputs.starsLastHour);
  if (phase === "starting" || phase === "soon") {
    if (inputs.heatScore >= 85 && v >= 0.6) return "surging";
    if (inputs.heatScore >= 70 && v >= 0.3) return "heating_up";
    if (inputs.heatScore >= 40) return "warming_up";
    return "upcoming";
  }
  // active
  if (inputs.heatScore >= 90 && v >= 0.6) return "peaking";
  if (inputs.heatScore >= 75) return "hot";
  if (v >= 0.3) return "heating_up";
  return "steady";
}

/** Saturating normalization: 0 stars -> 0; >=20/h -> ~1. */
export function normalizeVelocity(starsLastHour: number): number {
  if (starsLastHour <= 0) return 0;
  return Math.min(1, Math.log1p(starsLastHour) / Math.log1p(20));
}
