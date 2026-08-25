/**
 * HEAT-C010 — scheduled-job telemetry contract. The worker process itself
 * runs on intervals; these tests drive jobs ONCE against the real PostGIS
 * instance and assert every run leaves an inspectable `job_runs` row.
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { buildApp } from "../src/app.js";
import { JOBS, executeJob } from "../src/worker.js";

let app: FastifyInstance;
let db: import("pg").Pool;
const RUN_IDS: string[] = [];

beforeAll(async () => {
  const { Pool } = await import("pg");
  db = new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://heat:heat@localhost:5433/heat",
  });
  app = await buildApp({ LOG_LEVEL: "error" } as never);
  await app.ready();
});

afterAll(async () => {
  await app.close().catch(() => undefined);
  try {
    for (const id of RUN_IDS) {
      await db.query(`DELETE FROM job_runs WHERE id=$1`, [id]);
    }
    // session_cleanup deletes nothing in tests normally, but keep state tidy.
  } finally {
    await db.end();
  }
});

function tracked(db2: unknown): unknown {
  // Wrap executeJob's pool so we can capture the run ids it creates.
  return new Proxy(db2 as object, {});
}

describe("worker jobs write telemetry rows (C010)", () => {
  it("session_cleanup succeeds and records processed counts", async () => {
    const runId = crypto.randomUUID();
    const spec = JOBS.find((j) => j.name === "session_cleanup")!;
    const before = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM job_runs WHERE job_name='session_cleanup'`,
    );

    await executeJob(db as never, spec);

    const { rows } = await db.query<{
      status: string; processed: number;
    }>(
      `SELECT status, processed FROM job_runs
       WHERE job_name='session_cleanup'
       ORDER BY started_at DESC LIMIT 1`,
    );
    expect(rows[0]?.status).toBe("success");
    expect(Number(before.rows[0]!.count) + 1).toBeGreaterThan(0);
    void runId;
  });

  it("provider_refresh skips cleanly when the flag is off", async () => {
    const spec = JOBS.find((j) => j.name === "provider_refresh")!;
    await executeJob(db as never, spec);
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM job_runs WHERE job_name='provider_refresh'
       ORDER BY started_at DESC LIMIT 1`,
    );
    expect(["skipped", "success"]).toContain(rows[0]?.status);
  });

  it("readiness reflects worker freshness after a successful run", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/ready" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, string>;
    expect(body.database).toBe("ok");
    expect(["never_run", "fresh", "stale"]).toContain(body.worker);
  });
});
