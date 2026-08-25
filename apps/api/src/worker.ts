/**
 * HEAT-C010 — scheduled job runtime.
 *
 * A dedicated process (never the request-serving replicas) owns periodic
 * work so API latency stays independent of batch load:
 *
 *   provider_refresh   Ticketmaster ingestion, flag-gated, every 6h
 *   stale_source_sweep Deactivate provider sources not synced in 7 days
 *   session_cleanup    Purge expired/revoked sessions past retention
 *
 * Every run writes a `job_runs` row (name, run window, processed, failed,
 * error summary) — the ops contract in doc 05 §C010. Jobs skip rather than
 * overlap: each spec tracks its own in-flight promise.
 */
import crypto from "node:crypto";
import { loadEnv } from "./env.js";
import { getPool, closePool } from "./db/pool.js";
import type { Queryable } from "./db/pool.js";
import { orchestrateTicketmasterIngestion } from "./modules/ingestion/orchestrator.js";

type PgPool = Queryable & { connect: unknown };

interface JobResult {
  processed: number;
  failed?: number;
}

interface JobSpec {
  name: string;
  intervalMs: number;
  /** Stagger the first run so boot never thundering-herds the DB. */
  initialDelayMs: number;
  run: (db: Queryable) => Promise<JobResult | "skipped">;
}

async function executeJob(db: PgPool, spec: JobSpec): Promise<void> {
  const runId = crypto.randomUUID();
  await db.query(
    `INSERT INTO job_runs (id, job_name) VALUES ($1,$2)`,
    [runId, spec.name],
  ).catch(() => undefined);

  try {
    const result = await spec.run(db);
    if (result === "skipped") {
      await db.query(
        `UPDATE job_runs SET status='skipped', finished_at=now() WHERE id=$1`,
        [runId],
      );
      console.log(`[worker] ${spec.name}: skipped`);
      return;
    }
    await db.query(
      `UPDATE job_runs SET status='success', finished_at=now(),
         processed=$2, failed=$3
       WHERE id=$1`,
      [runId, result.processed, result.failed ?? 0],
    );
    console.log(`[worker] ${spec.name}: ok (${result.processed} processed, ${result.failed ?? 0} failed)`);
  } catch (err) {
    const detail = (err as Error).message.slice(0, 500);
    console.error(`[worker] ${spec.name} FAILED: ${detail}`);
    await db.query(
      `UPDATE job_runs SET status='failed', finished_at=now(), error_summary=$2
       WHERE id=$1`,
      [runId, detail],
    ).catch(() => undefined);
  }
}

function schedule(db: PgPool, spec: JobSpec): void {
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return; // never overlap a job with itself
    inFlight = true;
    try {
      await executeJob(db, spec);
    } finally {
      inFlight = false;
    }
  };
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), spec.intervalMs);
  }, spec.initialDelayMs).unref();
}

// Exposed for operational tests / one-shot manual runs.
export { executeJob, JOBS };

const HOUR = 3_600_000;

const JOBS: JobSpec[] = [
  {
    name: "provider_refresh",
    intervalMs: 6 * HOUR,
    initialDelayMs: 30_000,
    run: async (db) => {
      // Runtime-flag gate mirrors the admin ingest endpoint: an explicit
      // override row wins over the compiled default.
      const flags = await db.query<{ key: string; enabled: boolean }>(
        "SELECT key, enabled FROM feature_flag_overrides WHERE key='ticketmaster_enabled'",
      );
      const enabled = flags.rows[0]?.enabled === true;
      if (!enabled) return "skipped";
      const apiKey = process.env.TICKETMASTER_API_KEY;
      if (!apiKey) return "skipped";
      const outcome = await orchestrateTicketmasterIngestion(db, { apiKey });
      return { processed: outcome.received, failed: outcome.failed };
    },
  },
  {
    name: "stale_source_sweep",
    intervalMs: 1 * HOUR,
    initialDelayMs: 90_000,
    run: async (db) => {
      // Cancellation/postponement freshness (D009 groundwork): provider
      // sources that stopped syncing lose their active vote on canonicals.
      // Native sources are exempt — they have no external lifecycle.
      const { rowCount } = await db.query(
        `UPDATE event_sources SET active = FALSE
         WHERE provider <> 'native' AND active
           AND last_synced_at < now() - interval '7 days'`,
      );
      return { processed: rowCount ?? 0 };
    },
  },
  {
    name: "session_cleanup",
    intervalMs: 1 * HOUR,
    initialDelayMs: 150_000,
    run: async (db) => {
      const { rowCount } = await db.query(
        `DELETE FROM sessions WHERE expires_at < now() - interval '7 days'
           OR revoked_at < now() - interval '30 days'`,
      );
      return { processed: rowCount ?? 0 };
    },
  },
];

export function startWorker(env = loadEnv()): { stop: () => Promise<void> } {
  const db = getPool({ ...env }) as PgPool;
  for (const spec of JOBS) schedule(db, spec);
  console.log(`[worker] started: ${JOBS.map((j) => j.name).join(", ")}`);
  return {
    stop: async () => {
      await closePool();
    },
  };
}

// Run directly (`tsx src/worker.ts`), not when imported by tests.
if (process.argv[1]?.endsWith("worker.ts")) {
  const worker = startWorker();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await worker.stop();
      process.exit(0);
    });
  }
}
