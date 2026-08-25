/**
 * Minimal Redis surface used by the shared cache. Declared here so the cache
 * layer has no hard runtime dependency in local/single-node deployments.
 */
export interface SharedCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
  incr(key: string): Promise<number>;
}

/** Create a SharedCacheClient when REDIS_URL is configured, else null. */
export async function connectSharedCache(
  redisUrl: string | undefined,
  log?: { warn: (msg: string) => void },
): Promise<SharedCacheClient | null> {
  if (!redisUrl) return null;
  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    client.on("error", () => {
      /* logged once below via status transitions; keep process alive */
    });
    return client as unknown as SharedCacheClient;
  } catch (e) {
    log?.warn(`shared cache disabled: ${(e as Error).message}`);
    return null;
  }
}
