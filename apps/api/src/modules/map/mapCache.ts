/**
 * P12/P2-010 perf — short-TTL map response cache (doc 48).
 *
 * Key = quantized viewport cell + zoom band + time window + filters.
 * User-specific responses (starred state) are NEVER cached — star state must
 * not leak across cache keys. Invalidation: native event create/cancel bumps
 * the epoch; epoch is part of the key so stale entries age out naturally.
 */
import type { MapEventsResponse } from "@heat/api-contracts";

interface Entry {
  body: MapEventsResponse;
  expiresAt: number;
}

const MAX_ENTRIES = 500;

export class MapResponseCache {
  private store = new Map<string, Entry>();
  private epoch = 0;

  constructor(private readonly clock: () => number = Date.now) {}

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

  get(key: string): MapEventsResponse | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.clock() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    // LRU touch.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.body;
  }

  set(key: string, body: MapEventsResponse, ttlMs: number): void {
    if (this.store.size >= MAX_ENTRIES) {
      // Drop oldest insertion.
      const oldest = this.store.keys().next().value;
      if (oldest != null) this.store.delete(oldest);
    }
    this.store.set(key, { body, expiresAt: this.clock() + ttlMs });
  }

  /** Called on canonical writes (create/merge/cancel). */
  invalidateAll(): void {
    this.epoch += 1;
    if (this.store.size > MAX_ENTRIES * 2) this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** Active windows churn faster than future windows (doc 48 TTL semantics). */
export function ttlForWindow(windowLabel: string): number {
  return windowLabel === "now" ? 15_000 : 60_000;
}
