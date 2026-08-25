import pg from "pg";
import type { Env } from "../env.js";

export type Queryable = Pick<pg.Pool, "query">;

let pool: pg.Pool | null = null;
const clientHooks: Array<(client: pg.PoolClient) => void> = [];

/** Register a hook applied to every new pooled client (e.g. SET timeouts). */
export function onNewClient(fn: (client: pg.PoolClient) => void): void {
  clientHooks.push(fn);
}

export function getPool(env: Env): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      // Hard bound on any single query — protects p99 latency (doc 76).
      statement_timeout: 8000,
      idle_in_transaction_session_timeout: 15_000,
    });
    pool.on("connect", (client) => {
      for (const fn of clientHooks) {
        try { fn(client); } catch { /* hooks must not break connections */ }
      }
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
