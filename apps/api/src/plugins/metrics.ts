/**
 * Dependency-free metrics for SLO monitoring (doc 76): request counters,
 * latency buckets, cache efficiency, HEAT recalc throughput. Rendered in
 * Prometheus text format at GET /v1/metrics.
 */

const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];

class MetricsRegistry {
  private counters = new Map<string, number>();
  private histograms = new Map<string, Map<number, number>>();
  private gauges = new Map<string, () => number>();
  private readonly startedAt = Date.now();

  inc(name: string, labels: Record<string, string> = {}, v = 1): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + v);
  }

  observeLatency(route: string, ms: number): void {
    let buckets = this.histograms.get(route);
    if (!buckets) {
      buckets = new Map(LATENCY_BUCKETS_MS.map((b) => [b, 0]));
      this.histograms.set(route, buckets);
    }
    let totalKey = this.key("http_request_duration_seconds_count", { route });
    this.counters.set(totalKey, (this.counters.get(totalKey) ?? 0) + 1);
    let sumKey = this.key("http_request_duration_seconds_sum", { route });
    this.counters.set(sumKey, (this.counters.get(sumKey) ?? 0) + ms / 1000);
    for (const bound of LATENCY_BUCKETS_MS) {
      if (ms <= bound) buckets.set(bound, (buckets.get(bound) ?? 0) + 1);
    }
  }

  registerGauge(name: string, fn: () => number): void {
    this.gauges.set(name, fn);
  }

  private key(name: string, labels: Record<string, string>): string {
    const parts = Object.entries(labels)
      .map(([k, val]) => `${k}="${String(val).replace(/"/g, "")}"`)
      .sort()
      .join(",");
    return parts ? `${name}{${parts}}` : name;
  }

  render(): string {
    const lines: string[] = [];
    lines.push(`# TYPE heat_uptime_seconds gauge`);
    lines.push(`heat_uptime_seconds ${(Date.now() - this.startedAt) / 1000}`);
    for (const [key, value] of this.counters) {
      const [name] = key.split("{");
      if (name?.startsWith("http_request_duration")) {
        lines.push(`# TYPE ${name} ${name.endsWith("_count") ? "counter" : "counter"}`);
      } else {
        lines.push(`# TYPE ${name} counter`);
      }
      lines.push(`${key} ${value}`);
    }
    for (const [route, buckets] of this.histograms) {
      let cumulative = 0;
      for (const [bound, count] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
        cumulative += count;
        lines.push(`http_request_duration_seconds_bucket{route="${route}",le="${bound / 1000}"} ${cumulative}`);
      }
      lines.push(`http_request_duration_seconds_bucket{route="${route}",le="+Inf"} ${cumulative}`);
    }
    for (const [name, fn] of this.gauges) {
      try {
        lines.push(`# TYPE ${name} gauge`);
        lines.push(`${name} ${fn()}`);
      } catch {
        // gauge providers must never break the scrape
      }
    }
    return lines.join("\n") + "\n";
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }
}

export const metrics = new MetricsRegistry();
