/**
 * P12/P2-010 perf — short-TTL map response cache (doc 48).
 *
 * Key = quantized viewport cell + zoom band + time window + filters.
 * User-specific responses (starred state) are NEVER cached — star state must
 * not leak across cache keys. Invalidation: native event create/cancel bumps
 * the epoch; epoch is part of the key so stale entries age out naturally.
 */
import type { MapEventsResponse } from "@heat/api-contracts";
import type { SharedCacheClient } from "../../lib/sharedCache.js";

interface Entry {
  body: MapEventsResponse;
  expiresAt: number;
}

const MAX_ENTRIES = 500;
const EPOCH_KEY = "heat:mapcache:epoch";

export class MapResponseCache {
  private store = new Map<string, Entry>();
  private epoch = 0;
  /** Single-flight: concurrent misses for one key share one computation. */
  private inflight = new Map<string, Promise<MapEventsResponse>>();

  /**
   * HEAT-C003 — pass a SharedCacheClient (Redis) to make invalidation and
   * payload reuse correct across replicas. Without one the instance behaves
   * exactly like the original single-process cache.
   */
  constructor(
    private readonly clock: () => number = Date.now,
    private readonly redis?: SharedCacheClient | null,
  ) {}

  /**
   * Cache-aside with request coalescing: N concurrent misses on the same key
   * produce exactly one DB query (stampede protection under burst load).
   */
  async getOrLoad(
    key: string,
    ttlMs: number,
    load: () => Promise<MapEventsResponse>,
  ): Promise<{ body: MapEventsResponse; hit: boolean }> {
    const cached = await this.get(key);
    if (cached) return { body: cached, hit: true };

    const existing = this.inflight.get(key);
    if (existing) return { body: await existing, hit: false };

    const flight = load().finally(() => this.inflight.delete(key));
    this.inflight.set(key, flight);
    const body = await flight;
    await this.set(key, body, ttlMs);
    return { body, hit: false };
  }

  /** Quantize coordinates to ~1.1km cells so near-duplicate pan queries hit. */
  private quantize(v: number): number {
    return Math.round(v * 100) / 100;
  }

  private zoomBand(zoom: number): number {
    return Math.floor(zoom / 2);
  }

  key(p: {
    north: number; south: number; east: number; west: number;
    zoom: number; window: string; category?: string | null; starredOnly: boolean;
  }): string {
    return [
      this.epoch,
      this.quantize(p.north), this.quantize(p.south),
      this.quantize(p.east), this.quantize(p.west),
      `z${this.zoomBand(p.zoom)}`,
      p.window,
      p.category ?? "-",
      p.starredOnly ? "s" : "a",
    ].join("|");
  }

  /**
   * Adopt the SHARED epoch before any read/write so another replica's
   * canonical-write bump takes effect immediately (doc 48 / R2-006: a new or
   * edited event must appear without waiting out a TTL). One small GET per
   * cache operation — negligible next to the spatial query it guards.
   */
  private async adoptSharedEpoch(): Promise<void> {
    if (!this.redis) return;
    try {
      this.epoch = Number((await this.redis.get(EPOCH_KEY)) ?? "0");
    } catch {
      /* unreachable bus: keep the locally adopted epoch */
    }
  }

  async get(key: string): Promise<MapEventsResponse | null> {
    await this.adoptSharedEpoch();
    const fullKey = `${this.epoch}|${key}`;

    // L1: process-local touch (zero extra cost beyond the epoch probe).
    const entry = this.store.get(fullKey);
    if (entry) {
      if (this.clock() >= entry.expiresAt) {
        this.store.delete(fullKey);
      } else {
        this.store.delete(fullKey);
        this.store.set(fullKey, entry);
        return entry.body;
      }
    }
    if (!this.redis) return null;

    // L2: shared payload written by ANY replica.
    try {
      const raw = await this.redis.get(`heat:mapcache:v1:${fullKey}`);
      if (!raw) return null;
      const body = JSON.parse(raw) as MapEventsResponse;
      // Re-seed L1; correctness comes from the epoch prefix, not the clock.
      this.store.set(fullKey, { body, expiresAt: this.clock() + 60_000 });
      return body;
    } catch {
      return null;
    }
  }

  async set(key: string, body: MapEventsResponse, ttlMs: number): Promise<void> {
    await this.adoptSharedEpoch();
    const fullKey = `${this.epoch}|${key}`;

    if (this.store.size >= MAX_ENTRIES) {
      // Drop oldest insertion.
      const oldest = this.store.keys().next().value;
      if (oldest != null) this.store.delete(oldest);
    }
    this.store.set(fullKey, { body, expiresAt: this.clock() + ttlMs });

    if (!this.redis) return;
    try {
      await this.redis.set(
        `heat:mapcache:v1:${fullKey}`,
        JSON.stringify(body),
        "PX",
        ttlMs,
      );
    } catch {
      /* shared-cache write failures degrade to L1 silently */
    }
  }

  /** Called on canonical writes (create/merge/cancel). */
  async invalidateAll(): Promise<void> {
    // L1 is dropped outright: every replica must forget pre-bump payloads.
    this.store.clear();
    if (this.redis) {
      try {
        this.epoch = await this.redis.incr(EPOCH_KEY);
      } catch {
        this.epoch += 1;
      }
    } else {
      this.epoch += 1;
    }
  }

  get size(): number {
    return this.store.size;
  }
}

function ttlForWindowFallback(defaultTtlMs: number): number {
  return Math.min(defaultTtlMs, 60_000);
}

/** Active windows churn faster than future windows (doc 48 TTL semantics). */
export function ttlForWindow(windowLabel: string): number {
  return windowLabel === "now" ? 15_000 : 60_000;
}
