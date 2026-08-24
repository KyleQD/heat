/**
 * P6-001/P6-002 — Routing provider abstraction. HEAT owns preview/ETA/telemetry;
 * external navigation owns turn-by-turn. Exact origin is used transiently and
 * NEVER persisted (ADR-0007).
 */
import type { TravelMode } from "@heat/domain";
import type { RouteOption } from "@heat/api-contracts";

export interface RouteRequest {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  modes: TravelMode[];
}

export interface RoutingProvider {
  readonly name: string;
  getRoutes(req: RouteRequest): Promise<RouteOption[]>;
}

/** Average urban speeds (m/s) per mode for the deterministic estimate provider. */
const SPEED_MPS: Record<TravelMode, number> = {
  drive: 11.5,
  walk: 1.35,
  transit: 7.0,
  bike: 4.2,
};

/**
 * V1 default provider: haversine distance × circuity factor (real road paths
 * are longer than straight lines) with per-mode speed priors. Deterministic,
 * key-free, replaceable by a commercial provider without contract changes.
 */
export class EstimateRoutingProvider implements RoutingProvider {
  readonly name = "estimate_v1";

  async getRoutes(req: RouteRequest): Promise<RouteOption[]> {
    const straight = haversineMeters(req.origin, req.destination);
    if (!Number.isFinite(straight)) return [];
    return req.modes.map((mode) => {
      const circuity = mode === "drive" || mode === "transit" ? 1.3 : 1.15;
      const distance = Math.round(straight * circuity);
      const duration = Math.round(distance / SPEED_MPS[mode]);
      return {
        mode,
        durationSeconds: duration,
        distanceMeters: distance,
        polyline: encodeSimplePolyline(req.origin, req.destination),
        provider: this.name,
      } satisfies RouteOption;
    });
  }
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Minimal two-point polyline so clients can draw a fallback preview line. */
function encodeSimplePolyline(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): string {
  const pts: Array<[number, number]> = [
    [a.lat, a.lng],
    [b.lat, b.lng],
  ];
  let lastLat = 0;
  let lastLng = 0;
  let out = "";
  for (const [lat, lng] of pts) {
    const iLat = Math.round(lat * 1e5);
    const iLng = Math.round(lng * 1e5);
    out += encodeVar(iLat - lastLat) + encodeVar(iLng - lastLng);
    lastLat = iLat;
    lastLng = iLng;
  }
  return out;
}

function encodeVar(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let chunk = "";
  while (v >= 0x20) {
    chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  chunk += String.fromCharCode(v + 63);
  return chunk;
}
