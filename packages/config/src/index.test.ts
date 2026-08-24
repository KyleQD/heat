import { describe, expect, it } from "vitest";
import { LAS_VEGAS, resolveTimeWindow, zonedTimeToUtc } from "./index.js";

describe("resolveTimeWindow tonight", () => {
  it("evening 20:00 local opens tonight window at 16:00 same day", () => {
    // 2026-08-24T20:00:00-07:00 == 2026-08-25T03:00:00Z
    const at = new Date("2026-08-25T03:00:00Z");
    const { start, end } = resolveTimeWindow("tonight", LAS_VEGAS, at);
    expect(start.toISOString()).toBe("2026-08-24T23:00:00.000Z"); // 16:00 PDT
    expect(end.toISOString()).toBe("2026-08-25T13:00:00.000Z"); // 06:00 next day
  });

  it("2 AM local belongs to the previous evening's window", () => {
    // 2026-08-25T02:00:00-07:00 == 09:00Z
    const at = new Date("2026-08-25T09:00:00Z");
    const { start, end } = resolveTimeWindow("tonight", LAS_VEGAS, at);
    expect(start.toISOString()).toBe("2026-08-24T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-25T13:00:00.000Z");
  });

  it("handles DST spring-forward without off-by-one (PST winter)", () => {
    const at = zonedTimeToUtc("2026-01-15", 21, 0, LAS_VEGAS.timezone);
    const { start, end } = resolveTimeWindow("tonight", LAS_VEGAS, at);
    expect(start.toISOString()).toBe("2026-01-16T00:00:00.000Z"); // 16:00 PST
    expect(end.toISOString()).toBe("2026-01-16T14:00:00.000Z");
  });

  it("now window is bounded around the reference time", () => {
    const at = new Date("2026-08-25T03:00:00Z");
    const { start, end } = resolveTimeWindow("now", LAS_VEGAS, at);
    expect(start.getTime()).toBeLessThan(at.getTime());
    expect(end.getTime()).toBeGreaterThan(at.getTime());
  });
});
