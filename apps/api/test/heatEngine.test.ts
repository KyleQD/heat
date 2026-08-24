/**
 * P11 engine v0.1 — deterministic scoring scenarios.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { computeHeat, lifecyclePhaseOf } from "../src/modules/heat/engine.js";

const NOW = new Date("2026-08-24T19:00:00Z");
const h = (n: number): Date => new Date(NOW.getTime() + n * 3_600_000);

const base = {
  now: NOW,
  startsAt: h(-1),
  endsAt: h(3),
  canceled: false,
  verificationLevel: "source_verified",
  sourceCount: 2,
  capacity: 20_000,
  predictedAttendance: 15_000,
  starsActive: 120,
  stars15m: 6,
  stars1h: 18,
  stars6h: 60,
  selects1h: 30,
  ticketClicks1h: 8,
  routePreviews1h: 10,
  navigationStarts1h: 3,
};

describe("HEAT engine", () => {
  it("active high-intent stadium show scores hot and confident", () => {
    const r = computeHeat(base);
    expect(r.score).toBeGreaterThan(70);
    expect(r.confidence).toBeGreaterThan(60);
    expect(r.phase).toBe("active");
    expect(r.components.presence).toBeNull(); // unknown ≠ zero
    expect(r.attendanceLow).toBeGreaterThan(0);
    expect(r.attendanceHigh).toBeGreaterThan(r.attendanceLow!);
    expect(r.attendanceType).toBe("pre_event_forecast");
  });

  it("far-future event leans on Expected and stays cooler", () => {
    const r = computeHeat({ ...base, startsAt: h(72), endsAt: h(78) });
    expect(r.phase).toBe("far_future");
    expect(r.score).toBeLessThan(computeHeat(base).score);
  });

  it("small venue with strong intent still surfaces (log scale)", () => {
    const small = computeHeat({
      ...base,
      capacity: 250,
      predictedAttendance: null,
      starsActive: 45,
      stars1h: 9,
    });
    expect(small.score).toBeGreaterThan(25);
  });

  it("no signals yields a low but non-catastrophic prior", () => {
    const r = computeHeat({
      ...base,
      starsActive: 0, stars15m: 0, stars1h: 0, stars6h: 0,
      selects1h: 0, ticketClicks1h: 0, routePreviews1h: 0, navigationStarts1h: 0,
      predictedAttendance: null, capacity: null,
      verificationLevel: "community", sourceCount: 1,
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThan(35);
    expect(r.confidence).toBeLessThan(50);
  });

  it("attendance anomaly vs capacity drops confidence sharply", () => {
    const sane = computeHeat({ ...base });
    const anomalous = computeHeat({ ...base, predictedAttendance: 90_000 });
    expect(anomalous.confidence).toBeLessThan(sane.confidence - 15);
  });

  it("canceled events collapse attendance and cap phase", () => {
    const r = computeHeat({ ...base, canceled: true });
    expect(r.attendanceLow).toBeNull();
    expect(r.attendanceHigh).toBeNull();
    expect(r.phase).toBe("ended");
  });

  it("intent ladder dominates weak views (navigation >> select)", () => {
    // Low-signal regime so the saturating transform hasn't clipped.
    const quiet = {
      ...base,
      capacity: null,
      predictedAttendance: null,
      verificationLevel: "community",
      sourceCount: 1,
      starsActive: 4, stars15m: 1, stars1h: 4, stars6h: 8,
    };
    const nav = computeHeat({ ...quiet, navigationStarts1h: 3, selects1h: 0, ticketClicks1h: 0 });
    const selects = computeHeat({ ...quiet, navigationStarts1h: 0, selects1h: 3, ticketClicks1h: 0 });
    expect(nav.score).toBeGreaterThan(selects.score);
  });

  it("momentum responds to star acceleration vs 6h baseline", () => {
    const surging = computeHeat({ ...base, stars15m: 20, stars6h: 24 });
    const stalling = computeHeat({ ...base, stars15m: 0, stars6h: 240 });
    expect(surging.components.momentum).toBeGreaterThan(stalling.components.momentum);
  });

  it("lifecycle phases are ordered", () => {
    expect(lifecyclePhaseOf(NOW, h(48), h(52))).toBe("far_future");
    expect(lifecyclePhaseOf(NOW, h(3), h(6))).toBe("soon");
    expect(lifecyclePhaseOf(NOW, h(-1), h(3))).toBe("active");
    expect(lifecyclePhaseOf(NOW, h(-5), h(-1))).toBe("ended");
  });

  it("is deterministic for identical inputs", () => {
    expect(computeHeat(base)).toEqual(computeHeat(base));
  });
});
