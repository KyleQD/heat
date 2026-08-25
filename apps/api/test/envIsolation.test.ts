/**
 * HEAT-C011 — environment isolation. Production must never inherit local
 * conveniences, and the shared-cache contract must hold across replicas.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";
import { MapResponseCache } from "../src/modules/map/mapCache.js";
import type { SharedCacheClient } from "../src/lib/sharedCache.js";

describe("production config isolation (C011)", () => {
  it("production WITHOUT DATABASE_URL fails fast — no silent dev fallback", () => {
    expect(() =>
      loadEnv({ NODE_ENV: "production" } as never),
    ).toThrow(/SAFE_CONFIG_ERROR.*DATABASE_URL/);
  });

  it("non-production still gets the documented local dev fallback", () => {
    const env = loadEnv({ NODE_ENV: "development" } as never);
    expect(env.DATABASE_URL).toContain("localhost:5433");
  });

  it("production REJECTS localhost database URLs", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://heat:heat@localhost:5433/heat",
      } as never),
    ).toThrow(/SAFE_CONFIG_ERROR.*localhost/);
  });

  it("production REJECTS loopback-IP database URLs", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://heat:heat@127.0.0.1:5433/heat",
      } as never),
    ).toThrow(/SAFE_CONFIG_ERROR.*localhost/);
  });

  it("REDIS_URL is optional and passes through when present", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      REDIS_URL: "redis://cache.internal:6379",
    } as never);
    expect(env.REDIS_URL).toBe("redis://cache.internal:6379");
  });
});

// ---------------------------------------------------------------------------
// Shared cache contract (C003): with a SharedCacheClient, one replica's write
// is another's hit, and either replica's invalidation invalidates both.

/** In-memory stand-in for Redis shared between "replicas". */
function makeSharedBus(): SharedCacheClient & { bumpEpochExternal(): void } {
  const kv = new Map<string, string>();
  let epoch = 5;
  return {
    async get(key) {
      if (key === "heat:mapcache:epoch") return String(epoch);
      return kv.get(key) ?? null;
    },
    async set(key, value) {
      kv.set(key, value);
    },
    async incr(key) {
      if (key === "heat:mapcache:epoch") epoch += 1;
      return epoch;
    },
    bumpEpochExternal() {
      // Another replica bumped without telling us directly.
      epoch += 1;
    },
  };
}

const body = (n: number) =>
  ({ events: [{ id: `e${n}` }], heatPoints: [], clusters: [] }) as never;

describe("MapResponseCache multi-replica semantics (C003)", () => {
  it("a payload written by replica A is served by replica B", async () => {
    const bus = makeSharedBus();
    const a = new MapResponseCache(Date.now, bus);
    const b = new MapResponseCache(Date.now, bus);

    await a.set("k1", body(1), 60_000);
    const got = await b.get("k1");
    expect(got).not.toBeNull();
  });

  it("invalidation on EITHER replica makes the entry unreachable on BOTH", async () => {
    const bus = makeSharedBus();
    const a = new MapResponseCache(Date.now, bus);
    const b = new MapResponseCache(Date.now, bus);

    await a.set("k2", body(2), 60_000);
    await b.invalidateAll(); // replica B bumps the SHARED epoch
    expect(await a.get("k2")).toBeNull();
    expect(await b.get("k2")).toBeNull();

    // And an external bump (third replica) also bites locally.
    await a.set("k3", body(3), 60_000);
    bus.bumpEpochExternal();
    expect(await a.get("k3")).toBeNull();
  });

  it("without a client, behavior is unchanged single-process caching", async () => {
    const solo = new MapResponseCache(Date.now, null);
    const r1 = await solo.getOrLoad("k", 1000, async () => body(4));
    expect(r1.hit).toBe(false);
    const r2 = await solo.getOrLoad("k", 1000, async () => body(5));
    expect(r2.hit).toBe(true);
    expect((r2.body as unknown as { events: unknown[] }).events[0]).toEqual({ id: "e4" });
    await solo.invalidateAll();
    const r3 = await solo.getOrLoad("k", 1000, async () => body(6));
    expect(r3.hit).toBe(false);
  });

  it("expired entries are never served (TTL honored through L2 re-seed)", async () => {
    let nowMs = 1_000_000;
    const clock = () => nowMs;
    const solo = new MapResponseCache(clock, null);
    await solo.set("t", body(7), 500);
    nowMs += 600;
    expect(await solo.get("t")).toBeNull();
  });
});
