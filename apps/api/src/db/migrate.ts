/**
 * Minimal, auditable migration runner. Each migration is applied once inside a
 * transaction and recorded in schema_migrations. Every destructive change
 * ships with a documented rollback (see file footers).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = join(import.meta.dirname, "../../migrations");

export async function runMigrations(
  pool: pg.Pool,
  direction: "up" | "down" = "up",
): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (direction === "up") {
      const { rows } = await client.query<{ name: string }>(
        "SELECT name FROM schema_migrations",
      );
      const applied = new Set(rows.map((r) => r.name));
      const appliedNow: string[] = [];
      for (const file of files) {
        if (applied.has(file)) continue;
        const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query(
            "INSERT INTO schema_migrations (name) VALUES ($1)",
            [file],
          );
          await client.query("COMMIT");
          appliedNow.push(file);
        } catch (err) {
          await client.query("ROLLBACK");
          throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
        }
      }
      return appliedNow;
    }

    // down: reverse last migration only (explicit, never cascading drops).
    const { rows } = await client.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY applied_at DESC LIMIT 1",
    );
    const last = rows[0]?.name;
    if (!last) return [];
    const sql = await readFile(join(MIGRATIONS_DIR, last), "utf8");
    const rollback = extractRollback(sql);
    if (!rollback) {
      throw new Error(`Migration ${last} has no documented rollback`);
    }
    await client.query("BEGIN");
    try {
      await client.query(rollback);
      await client.query("DELETE FROM schema_migrations WHERE name = $1", [last]);
      await client.query("COMMIT");
      return [last];
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Rollback of ${last} failed: ${(err as Error).message}`);
    }
  } finally {
    client.release();
  }
}

/** Rollbacks are documented in-file as commented SQL after the sentinel and
 *  are only executed by the explicit `down` path. */
export function splitRollback(sql: string): { up: string; rollback: string | null } {
  const marker = "-- Rollback:";
  const idx = sql.indexOf(marker);
  if (idx === -1) return { up: sql, rollback: null };
  return { up: sql.slice(0, idx), rollback: sql.slice(idx + marker.length) };
}

function extractRollback(sql: string): string | null {
  return splitRollback(sql).rollback;
}
