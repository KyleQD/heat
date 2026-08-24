import pg from "pg";
import type { Env } from "../env.js";

export type Queryable = Pick<pg.Pool, "query">;

let pool: pg.Pool | null = null;

export function getPool(env: Env): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
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
