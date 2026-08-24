/**
 * P11 groundwork — HEAT scoring engine v0.1.
 *
 * Principles enforced (docs 07/43/45):
 * - Score consumes TYPED SIGNALS only; never provider-specific fields.
 * - Presence is UNKNOWN in V1 — explicitly not zero; weights renormalize.
 * - Confidence is computed independently of score (evidence classes).
 * - Attendance estimates preserve uncertainty and never claim live counts
 *   without verified evidence.
 * - Config is versioned server-side; changing weights never requires a
 *   mobile release. Every calculation writes an inspectable snapshot row.
 */
import type { Queryable } from "../../db/pool.js";
import { attendanceDisplayText } from "../../lib/attendance.js";
import type { AttendanceEstimateType } from "@heat/domain";

export const SCORING_MODEL_VERSION = "heat-v0.1-engine";

interface LifecycleWeight {
  expected: number;
  intent: number;
  presence: number;
  momentum: number;
}

/** Seed hypotheses from doc 43 — configurable via config rows later. */
export const LIFECYCLE_WEIGHTS: Record<string, LifecycleWeight> = {
  far_future: { expected: 0.5, intent: 0.4, presence: 0.0, momentum: 0.1 },
  today_pre_event: { expected: 0.5, intent: 0.4, presence: 0.0, momentum: 0.1 },
  soon: { expected: 0.4, intent: 0.35, presence: 0.1, momentum: 0.15 },
  starting: { expected: 0.3, intent: 0.3, presence: 0.25, momentum: 0.15 },
  active: { expected: 0.15, intent: 0.15, presence: 0.5, momentum: 0.2 },
  ending: { expected: 0.1, intent: 0.1, presence: 0.55, momentum: 0.25 },
  ended: { expected: 0.2, intent: 0.2, presence: 0.3, momentum: 0.3 },
};

export interface HeatSignals {
  now: Date;
  startsAt: Date;
  endsAt: Date | null;
  canceled: boolean;
  verificationLevel: string;
  sourceCount: number;
  capacity: number | null;
  /** Forecast/predicted attendance high bound (provider or prior). */
  predictedAttendance: number | null;
  starsActive: number;
  stars15m: number;
  stars1h: number;
  stars6h: number;
  selects1h: number;
  ticketClicks1h: number;
  routePreviews1h: number;
  navigationStarts1h: number;
}

export interface HeatResult {
  score: number;
  confidence: number;
  components: { expected: number; intent: number; presence: number | null; momentum: number };
  phase: string;
  attendanceLow: number | null;
  attendanceHigh: number | null;
  attendanceType: AttendanceEstimateType;
}

const clamp = (x: number, lo = 0, hi = 100): number => Math.min(hi, Math.max(lo, x));
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Saturating transform: value saturates at `sat`, log-shaped before it. */
function saturate(value: number, sat: number): number {
  if (value <= 0) return 0;
  return clamp((Math.log1p(value) / Math.log1p(sat)) * 100);
}

/** Log-normalized scale so stadiums don't auto-consume 100 (doc 43). */
function scaleScore(attendance: number): number {
  return clamp((Math.log1p(attendance) / Math.log1p(50_000)) * 100);
}

export function lifecyclePhaseOf(now: Date, startsAt: Date, endsAt: Date | null): string {
  const h = (startsAt.getTime() - now.getTime()) / 3_600_000;
  if (h > 24) return "far_future";
  if (h > 6) return "today_pre_event";
  if (h > 2) return "soon";
  if (h > 0.5) return "starting";
  const end = endsAt ?? new Date(startsAt.getTime() + 4 * 3_600_000);
  const remaining = end.getTime() - now.getTime();
  if (remaining <= 0) return "ended";
  const total = Math.max(end.getTime() - startsAt.getTime(), 60_000);
  if (remaining / total < 0.2 || remaining < 3_600_000) return "ending";
  return "active";
}

export function computeHeat(s: HeatSignals): HeatResult {
  // ---- Expected: how significant should this event be? -------------------
  let expected: number;
  if (s.predictedAttendance != null && s.predictedAttendance > 0) {
    expected = scaleScore(s.predictedAttendance);
    // Capacity agreement nudges toward the prior's confidence band.
    if (s.capacity != null && s.capacity > 0) {
      const ratio = s.predictedAttendance / s.capacity;
      if (ratio >= 0.55 && ratio <= 1.05) expected = clamp(expected + 6);
      else if (ratio > 3) expected = clamp(expected - 12); // anomaly dampening
    }
  } else {
    expected = s.capacity != null ? scaleScore(s.capacity * 0.35) : 22; // neutral prior
  }

  // ---- Intent: weighted behavioral ladder (doc 08). ----------------------
  // view < select < star < ticket/route < navigation
  const intentRaw =
    s.starsActive * 0.8 +
    s.stars1h * 6 +
    s.selects1h * 2 +
    s.ticketClicks1h * 10 +
    s.routePreviews1h * 12 +
    s.navigationStarts1h * 20;
  const intent = saturate(intentRaw, 400);

  // ---- Presence: unknown in V1 — NOT zero (HEAT-AC-003). -----------------
  const presence: number | null = null;

  // ---- Momentum: acceleration vs the 6h baseline. ------------------------
  const baselinePer15m = s.stars6h / 24;
  const delta = s.stars15m - baselinePer15m;
  const routeDelta = s.routePreviews1h > 0 ? Math.log1p(s.routePreviews1h) : 0;
  const momentumRaw = 50 + delta * 18 + routeDelta * 9;
  const momentum = clamp(momentumRaw);

  // ---- Phase weighting with unknown-presence renormalization. ------------
  const phase =
    s.canceled ? "ended" : lifecyclePhaseOf(s.now, s.startsAt, s.endsAt);
  const w = LIFECYCLE_WEIGHTS[phase] ?? LIFECYCLE_WEIGHTS.today_pre_event!;
  const known: Array<[number, number]> = [
    [expected, w.expected],
    [intent, w.intent],
    [momentum, w.momentum],
    ...(presence != null ? [[presence, w.presence] as [number, number]] : []),
  ];
  const weightSum = known.reduce((acc, [, weight]) => acc + weight, 0);
  const score = known.reduce((acc, [v, weight]) => acc + v * weight, 0) / weightSum;

  // ---- Confidence: evidence classes, independent of score. ---------------
  let confidence = 30;
  if (s.verificationLevel === "staff_verified") confidence = 95;
  else if (s.verificationLevel === "verified_organizer" || s.verificationLevel === "verified_venue") confidence = 88;
  else if (s.verificationLevel === "multi_source_verified") confidence = 74;
  else if (s.verificationLevel === "source_verified") confidence = 62;
  else if (s.verificationLevel === "claimed") confidence = 50;
  // Source count bonus (multiple agreeing providers).
  confidence += Math.min(10, Math.max(0, s.sourceCount - 1) * 5);
  // Direct-evidence class bump when forecast exists.
  if (s.predictedAttendance != null) confidence += 6;
  // Sample-size nudge from real user signals.
  confidence += Math.min(8, Math.log1p(s.starsActive + s.routePreviews1h) * 4);
  // Anomaly penalty: prediction wildly over capacity.
  if (s.capacity != null && s.predictedAttendance != null &&
      s.capacity > 0 && s.predictedAttendance > s.capacity * 3) {
    confidence -= 25;
  }
  if (s.canceled) confidence = Math.min(confidence, 90);

  // ---- Attendance estimate with preserved uncertainty. --------------------
  let attendanceLow: number | null = null;
  let attendanceHigh: number | null = null;
  let attendanceType: AttendanceEstimateType = "unknown";
  if (s.canceled) {
    attendanceLow = null;
    attendanceHigh = null;
  } else if (s.predictedAttendance != null && s.predictedAttendance > 0) {
    const boost = 1 + Math.min(0.15, intent / 1000); // intent-adjusted nudge
    const mid = s.predictedAttendance * boost;
    attendanceLow = Math.round(mid * 0.75);
    attendanceHigh = Math.round(mid * 1.25);
    attendanceType = "pre_event_forecast";
  }

  return {
    score: round2(clamp(score)),
    confidence: round2(clamp(confidence)),
    components: {
      expected: round2(expected),
      intent: round2(intent),
      presence,
      momentum: round2(momentum),
    },
    phase,
    attendanceLow,
    attendanceHigh,
    attendanceType,
  };
}

// ---------------------------------------------------------------------------
// Signal collection + snapshot persistence
// ---------------------------------------------------------------------------

interface EventSignalRow {
  id: string;
  starts_at: Date;
  ends_at: Date | null;
  status: string;
  verificationLevel: string;
  sourceCount: number;
  capacity: number | null;
  venueCapacity: number | null;
  attendanceHigh: number | null;
}

async function loadSignals(db: Queryable, eventId: string): Promise<HeatSignals | null> {
  const ev = await db.query<EventSignalRow>(
    `SELECT e.id, e.starts_at, e.ends_at, e.status,
            e.verification_level AS "verificationLevel",
            e.source_count AS "sourceCount",
            e.capacity,
            v.capacity AS "venueCapacity",
            e.attendance_high AS "attendanceHigh"
     FROM events e LEFT JOIN venues v ON v.id = e.venue_id
     WHERE e.id = $1 AND e.deleted_at IS NULL`,
    [eventId],
  );
  const row = ev.rows[0];
  if (!row) return null;

  const starAgg = await db.query<{
    total: string; w15: string; w1: string; w6: string;
  }>(
    `SELECT COUNT(*) FILTER (WHERE removed_at IS NULL)::text AS total,
            COUNT(*) FILTER (WHERE removed_at IS NULL AND created_at > now() - interval '15 minutes')::text AS w15,
            COUNT(*) FILTER (WHERE removed_at IS NULL AND created_at > now() - interval '1 hour')::text AS w1,
            COUNT(*) FILTER (WHERE created_at > now() - interval '6 hours')::text AS w6
     FROM event_stars WHERE event_id = $1`,
    [eventId],
  );
  const interactions = await db.query<{ kind: string; c: string }>(
    `SELECT interaction_type AS kind, COUNT(*)::text AS c
     FROM event_interactions
     WHERE event_id = $1 AND occurred_at > now() - interval '1 hour'
       AND interaction_type IN ('select','ticket_click','route_preview','navigation_start')
     GROUP BY interaction_type`,
    [eventId],
  );
  const byKind = new Map(interactions.rows.map((r) => [r.kind, Number(r.c)]));
  const a = starAgg.rows[0];

  return {
    now: new Date(),
    startsAt: new Date(row.starts_at),
    endsAt: row.ends_at ? new Date(row.ends_at) : null,
    canceled: row.status === "canceled",
    verificationLevel: row.verificationLevel,
    sourceCount: Number(row.sourceCount ?? 0),
    capacity: row.venueCapacity ?? row.capacity ?? null,
    predictedAttendance:
      row.attendanceHigh != null ? Number(row.attendanceHigh) :
      row.venueCapacity != null ? Math.round(Number(row.venueCapacity) * 0.7) :
      null,
    starsActive: Number(a?.total ?? 0),
    stars15m: Number(a?.w15 ?? 0),
    stars1h: Number(a?.w1 ?? 0),
    stars6h: Number(a?.w6 ?? 0),
    selects1h: byKind.get("select") ?? 0,
    ticketClicks1h: byKind.get("ticket_click") ?? 0,
    routePreviews1h: byKind.get("route_preview") ?? 0,
    navigationStarts1h: byKind.get("navigation_start") ?? 0,
  };
}

/** Recalculates one event: writes a snapshot + updates canonical columns. */
export async function recalculateEventHeat(db: Queryable, eventId: string): Promise<HeatResult | null> {
  const signals = await loadSignals(db, eventId);
  if (!signals) return null;
  const result = computeHeat(signals);

  await db.query(
    `UPDATE events SET
       heat_score = $2, heat_confidence = $3,
       attendance_low = $4, attendance_high = $5, attendance_estimate_type = $6,
       updated_at = now()
     WHERE id = $1`,
    [eventId, result.score, result.confidence,
     result.attendanceLow, result.attendanceHigh, result.attendanceType],
  );
  await db.query(
    `INSERT INTO event_heat_snapshots (
       event_id, calculated_at, heat_score, heat_confidence,
       expected_score, intent_score, presence_score, momentum_score,
       attendance_low, attendance_high, trend, scoring_model_version, input_version, diagnostic
     ) VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, 'signals-1', $11)`,
    [
      eventId, result.score, result.confidence,
      result.components.expected, result.components.intent,
      result.components.presence, result.components.momentum,
      result.attendanceLow, result.attendanceHigh,
      SCORING_MODEL_VERSION,
      JSON.stringify({ phase: result.phase }),
    ],
  );
  return result;
}

/**
 * Recalculation scheduler: star mutations mark events dirty; a single sweeper
 * coalesces them (no global recompute per star — doc 07 cadence rule).
 */
export class HeatRecalculator {
  private dirty = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly getDb: () => Queryable, private readonly intervalMs = 20_000) {}

  markDirty(eventId: string): void {
    this.dirty.add(eventId);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async flush(): Promise<number> {
    if (this.dirty.size === 0) return 0;
    const ids = [...this.dirty];
    this.dirty.clear();
    for (const id of ids) {
      try {
        await recalculateEventHeat(this.getDb(), id);
      } catch {
        // Re-arm for the next sweep; scoring must never break mutations.
        this.dirty.add(id);
      }
    }
    return ids.length;
  }
}
