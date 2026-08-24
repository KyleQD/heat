import { describe, expect, it } from "vitest";
import { deriveTrend, lifecyclePhase, normalizeVelocity } from "../src/lib/trend.js";
import { computeMarkerPriority, confidenceLabel, heatBucket } from "../src/lib/scoring.js";
import { attendanceDisplayText, formatCompactCount } from "../src/lib/attendance.js";
import { EstimateRoutingProvider } from "../src/lib/routingProvider.js";

const NOW = new Date("2026-08-24T19:00:00Z");
const h = (n: number): Date => new Date(NOW.getTime() + n * 3_600_000);

describe("trend derivation (doc 02 §9)", () => {
  it("far future is upcoming", () => {
    expect(deriveTrend({ now: NOW, startsAt: h(30), endsAt: h(33), heatScore: 90, starsLastHour: 50 })).toBe("upcoming");
  });

  it("active high-heat high-velocity is hot", () => {
    expect(deriveTrend({ now: NOW, startsAt: h(-1), endsAt: h(3), heatScore: 82, starsLastHour: 12 })).toBe("hot");
  });

  it("active peak with surge velocity is peaking", () => {
    expect(deriveTrend({ now: NOW, startsAt: h(-2), endsAt: h(4), heatScore: 95, starsLastHour: 30 })).toBe("peaking");
  });

  it("ending phase cools or peaks by score", () => {
    expect(deriveTrend({ now: NOW, startsAt: h(-4), endsAt: h(0.25), heatScore: 80, starsLastHour: 5 })).toBe("peaking");
    expect(deriveTrend({ now: NOW, startsAt: h(-4), endsAt: h(0.25), heatScore: 30, starsLastHour: 0 })).toBe("cooling_down");
  });

  it("soon + mid score warms up", () => {
    expect(deriveTrend({ now: NOW, startsAt: h(3), endsAt: h(6), heatScore: 55, starsLastHour: 2 })).toBe("warming_up");
  });

  it("lifecycle phases are ordered and bounded", () => {
    expect(lifecyclePhase(NOW, h(48), h(52))).toBe("far_future");
    expect(lifecyclePhase(NOW, h(-1), null)).toBe("active"); // default 4h duration
    expect(lifecyclePhase(NOW, h(-9), h(-5))).toBe("ended");
  });

  it("velocity saturates", () => {
    expect(normalizeVelocity(0)).toBe(0);
    expect(normalizeVelocity(100)).toBeLessThanOrEqual(1);
  });
});

describe("marker priority + confidence (server-owned)", () => {
  it("canceled events get zero status weight", () => {
    const active = computeMarkerPriority({ heatScore: 80, attendanceHigh: 5000, starsLastHour: 10, isActive: true, canceled: false, verified: true });
    const canceled = computeMarkerPriority({ heatScore: 80, attendanceHigh: 5000, starsLastHour: 10, isActive: true, canceled: true, verified: true });
    expect(canceled).toBe(0);
    expect(active).toBeGreaterThan(40);
  });

  it("confidence labels never come from score color", () => {
    expect(confidenceLabel(null, "unknown")).toBe("estimated");
    expect(confidenceLabel(75, "pre_event_forecast")).toBe("high");
    expect(confidenceLabel(30, "pre_event_forecast")).toBe("estimated");
    expect(confidenceLabel(20, "verified_count")).toBe("verified_live");
  });

  it("heat buckets bound analytics payload precision", () => {
    expect(heatBucket(91)).toBe("80_100");
    expect(heatBucket(5)).toBe("0_39");
  });
});

describe("attendance copy rules (doc 45 §8) — no false precision", () => {
  it("pre-event forecast reads 'expected'", () => {
    expect(attendanceDisplayText(1200, 1600, "pre_event_forecast")).toBe("~1.2K–1.6K expected");
  });

  it("live estimate reads 'here now'", () => {
    expect(attendanceDisplayText(1100, 1400, "verified_count")).toBe("~1.1K–1.4K here now");
  });

  it("unknown type yields no copy — never invented numbers", () => {
    expect(attendanceDisplayText(1200, 1600, "unknown")).toBeNull();
    expect(attendanceDisplayText(null, 100, "pre_event_forecast")).toBeNull();
    expect(attendanceDisplayText(500, 400, "pre_event_forecast")).toBeNull();
  });

  it("compact formatting", () => {
    expect(formatCompactCount(12400)).toBe("12.4K");
    expect(formatCompactCount(999)).toBe("999");
  });
});

describe("estimate routing provider (P6-002)", () => {
  const provider = new EstimateRoutingProvider();

  it("returns one route per requested mode with circuity-adjusted distance", async () => {
    const routes = await provider.getRoutes({
      origin: { lat: 36.1147, lng: -115.1728 },
      destination: { lat: 36.1255, lng: -115.1688 },
      modes: ["drive", "walk"],
    });
    expect(routes).toHaveLength(2);
    expect(routes[0]!.distanceMeters).toBeGreaterThan(1200);
    expect(routes[0]!.durationSeconds!).toBeLessThan(routes[1]!.durationSeconds!);
    expect(routes.every((r) => r.polyline != null && r.provider === "estimate_v1")).toBe(true);
  });

  it("walk is slower per km than drive", async () => {
    const [drive, walk] = await provider.getRoutes({
      origin: { lat: 36.0, lng: -115.2 },
      destination: { lat: 36.2, lng: -115.0 },
      modes: ["drive", "walk"],
    });
    expect(drive!.durationSeconds).toBeLessThan(walk!.durationSeconds);
  });
});
