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

const iso = (d: Date) => d.toISOString();

/** HEAT-D005 — real transport with status-code propagation so the adapter's
 * retry/backoff can distinguish 429/quota from transient 5xx. */
const httpTransport = async (url: string): Promise<unknown> => {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`ticketmaster ${res.status}`) as Error & { statusCode?: number };
    err.statusCode = res.status;
    throw err;
  }
  return res.json();
};

const JOBS: JobSpec[] = [
  {
    // HEAT-D007 — tier 1: the imminent window (next 72h) is what users see
    // NOW; it refreshes every 6h so cancellations propagate fast.
    name: "provider_refresh_imminent",
    intervalMs: 6 * HOUR,
    initialDelayMs: 30_000,
    run: async (db) => {
      const flags = await db.query<{ key: string; enabled: boolean }>(
        "SELECT key, enabled FROM feature_flag_overrides WHERE key='ticketmaster_enabled'",
      );
      if (flags.rows[0]?.enabled !== true) return "skipped";
      const apiKey = process.env.TICKETMASTER_API_KEY;
      if (!apiKey) return "skipped";
      const outcome = await orchestrateTicketmasterIngestion(db, {
        apiKey,
        transport: httpTransport,
        timeWindow: { start: new Date(), end: new Date(Date.now() + 72 * HOUR) },
      });
      return { processed: outcome.received, failed: outcome.failed };
    },
  },
  {
    // HEAT-D007 — tier 2: the 72h–30d horizon refreshes weekly; supply
    // discovery for future planning, tolerant of drift.
    name: "provider_refresh_horizon",
    intervalMs: 7 * 24 * HOUR,
    initialDelayMs: 10 * 60_000,
    run: async (db) => {
      const flags = await db.query<{ key: string; enabled: boolean }>(
        "SELECT key, enabled FROM feature_flag_overrides WHERE key='ticketmaster_enabled'",
      );
      if (flags.rows[0]?.enabled !== true) return "skipped";
      const apiKey = process.env.TICKETMASTER_API_KEY;
      if (!apiKey) return "skipped";
      const outcome = await orchestrateTicketmasterIngestion(db, {
        apiKey,
        transport: httpTransport,
        timeWindow: { start: new Date(Date.now() + 72 * HOUR), end: new Date(Date.now() + 30 * 24 * HOUR) },
      });
      return { processed: outcome.received, failed: outcome.failed };
    },
  },
  {
    // HEAT-D003 — raw provider payloads are evidence, not product: after 90
    // days without a re-sync the full JSON collapses to a compact marker.
    name: "raw_payload_retention",
    intervalMs: 24 * HOUR,
    initialDelayMs: 5 * 60_000,
    run: async (db) => {
      const { rowCount } = await db.query(
        `UPDATE event_sources
         SET raw_payload = jsonb_build_object(
               'retained_ref', external_event_id,
               'stripped_at', now(),
               'note', 'raw payload past 90-day retention'
             )
         WHERE provider <> 'native'
           AND active
           AND last_synced_at < now() - interval '90 days'
           AND NOT (raw_payload ? 'stripped_at')`,
      );
      return { processed: rowCount ?? 0 };
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
