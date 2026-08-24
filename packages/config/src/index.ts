/**
 * HEAT configuration — feature flags and city configuration.
 *
 * Rules (Phase 0):
 * - City logic is data, never hard-coded branches in domain code.
 * - Flags are server-configurable; these are compile-time defaults used when
 *   no override exists. Server /v1/config remains the source of truth.
 */
import type { TimeWindow } from "@heat/domain";

export interface FeatureFlagDefaults {
  map_heat_layer_enabled: boolean;
  native_event_creation_enabled: boolean;
  stars_enabled: boolean;
  routing_enabled: boolean;
  ticketmaster_enabled: boolean;
  seatgeek_enabled: boolean;
  predicthq_enabled: boolean;
  event_claims_enabled: boolean;
  community_reports_enabled: boolean;
  city_las_vegas_enabled: boolean;
}

/** Defaults chosen so the vertical slice works without external providers. */
export const DEFAULT_FEATURE_FLAGS: FeatureFlagDefaults = {
  map_heat_layer_enabled: true,
  native_event_creation_enabled: true,
  stars_enabled: true,
  routing_enabled: true,
  ticketmaster_enabled: false,
  seatgeek_enabled: false,
  predicthq_enabled: false,
  event_claims_enabled: false,
  community_reports_enabled: true,
  city_las_vegas_enabled: true,
};

export interface CityConfig {
  cityKey: string;
  displayName: string;
  timezone: string;
  center: { lat: number; lng: number };
  bounds: { north: number; south: number; east: number; west: number };
  enabled: boolean;
  /** Local hour the "Tonight" window opens (inclusive). */
  tonightStartHourLocal: number;
  /** Local hour the "Tonight" window closes on the following day (exclusive). */
  tonightEndHourLocal: number;
  defaultZoom: number;
}

export const LAS_VEGAS: CityConfig = {
  cityKey: "las_vegas_nv",
  displayName: "Las Vegas",
  timezone: "America/Los_Angeles",
  center: { lat: 36.1147, lng: -115.1728 },
  bounds: {
    north: 36.331,
    south: 35.982,
    east: -114.948,
    west: -115.375,
  },
  enabled: true,
  tonightStartHourLocal: 16,
  tonightEndHourLocal: 6,
  defaultZoom: 13,
};

export const CITIES: readonly CityConfig[] = [LAS_VEGAS];

export function findCity(cityKey: string): CityConfig | undefined {
  return CITIES.find((c) => c.cityKey === cityKey);
}

/**
 * Resolve the explicit UTC start/end for a V1 time window at a reference time.
 *
 * - `now`: a bounded near-term horizon around `at` (active + starting soon).
 * - `tonight`: configured local-night window 16:00 → 06:00 following day.
 *   DST-safe because it is derived through the city's IANA timezone rules.
 */
export function resolveTimeWindow(
  window: TimeWindow,
  city: CityConfig,
  at: Date = new Date(),
): { start: Date; end: Date } {
  if (window === "now") {
    const start = new Date(at.getTime() - 2 * 60 * 60 * 1000);
    const end = new Date(at.getTime() + 6 * 60 * 60 * 1000);
    return { start, end };
  }

  // Tonight: walk day-by-day in local time to stay DST-safe.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: city.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(at);

  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const localHour = Number(get("hour"));
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;

  // The night that is currently "live" opened yesterday evening if we are
  // before the end hour, otherwise it opens today.
  const anchorDay =
    localHour < city.tonightEndHourLocal
      ? shiftDay(ymd, -1)
      : ymd;

  const startUtc = zonedTimeToUtc(
    anchorDay,
    city.tonightStartHourLocal,
    0,
    city.timezone,
  );
  const closeDay = shiftDay(anchorDay, 1);
  const endUtc = zonedTimeToUtc(closeDay, city.tonightEndHourLocal, 0, city.timezone);
  return { start: startUtc, end: endUtc };
}

function shiftDay(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

/**
 * Convert a local wall-clock (Y-M-D h:m) in an IANA zone to a UTC instant
 * without external timezone libraries. Uses offset probing which handles DST.
 */
export function zonedTimeToUtc(
  ymd: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const guessUtc = Date.UTC(y, m - 1, d, hour, minute);
  const offset1 = tzOffsetMs(guessUtc, timeZone);
  let candidate = guessUtc - offset1;
  const offset2 = tzOffsetMs(candidate, timeZone);
  if (offset2 !== offset1) {
    candidate = guessUtc - offset2;
  }
  return new Date(candidate);
}

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string): number =>
    Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - utcMs;
}
