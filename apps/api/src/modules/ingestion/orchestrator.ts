/**
 * Phase D/E — ingestion orchestrator with entity resolution.
 *
 * For each normalized candidate:
 *   1. Same provider+externalId already attached → refresh evidence (idempotent).
 *   2. Resolve against canonical candidates (venue/time/title/category weights
 *      per doc 06): score ≥ 0.90 auto-attach source to existing event;
 *      0.75–0.899 → new event + decision row flagged ambiguous for review;
 *      < 0.75 → create new canonical event.
 *   3. Every decision writes an auditable `event_resolution_decisions` row.
 *   4. Raw payloads are preserved; nothing is deleted on attach.
 */
import crypto from "node:crypto";
import type { Queryable } from "../../db/pool.js";
import { metrics } from "../../plugins/metrics.js";
import { titleSimilarity } from "../../lib/normalize.js";
import {
  fetchTicketmasterEvents,
  type NormalizedExternalEvent,
} from "./ticketmaster.js";

export const RESOLUTION_RULE_VERSION = "resolution-v0.1";

const AUTO_ATTACH_THRESHOLD = 0.9;
const AMBIGUOUS_THRESHOLD = 0.75;

export interface IngestOutcome {
  runId: string;
  received: number;
  created: number;
  attached: number;
  updated: number;
  failed: number;
}

interface CanonicalCandidate {
  id: string;
  normalized_title: string;
  starts_at: Date;
  venue_name: string | null;
  category: string;
  distance_meters: number | null;
}

async function findCandidates(
  db: Queryable,
  n: NormalizedExternalEvent,
): Promise<CanonicalCandidate[]> {
  if (n.startsAtUtc == null || n.lat == null || n.lng == null) return [];
  const { rows } = await db.query<CanonicalCandidate>(
    `
    SELECT e.id, e.normalized_title, e.starts_at,
           v.name AS venue_name,
           cat.key AS category,
           ST_Distance(e.location, ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography)::int AS distance_meters
    FROM events e
    JOIN event_categories cat ON cat.id = e.category_id
    LEFT JOIN venues v ON v.id = e.venue_id
    WHERE e.deleted_at IS NULL AND e.visibility_status = 'published'
      AND ST_DWithin(e.location, ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography, 500)
      AND e.starts_at BETWEEN $3::timestamptz - interval '6 hours' AND $3::timestamptz + interval '6 hours'
    LIMIT 25
    `,
    [n.lat, n.lng, new Date(n.startsAtUtc)],
  );
  return rows;
}

/**
 * Weights per doc 06: venue .30 / time .30 / title .20 / performer .15 /
 * category .05. No adapter extracts performer evidence yet; its weight is
 * RENORMALIZED across the signals we DO have rather than silently capping
 * every possible match below the auto-attach threshold (raw max was 0.85).
 */
export function scoreMatch(
  candidate: { normalized_title: string; starts_at: Date; venue_name: string | null; category: string; distance_meters: number | null },
  n: NormalizedExternalEvent,
): { total: number; title: number; venue: number; time: number; category: number } {
  const title = titleSimilarity(n.title, candidate.normalized_title);
  const deltaH = Math.abs(candidate.starts_at.getTime() - new Date(n.startsAtUtc ?? 0).getTime()) / 3_600_000;
  const time = Math.max(0, 1 - deltaH / 6);
  const proximity = candidate.distance_meters == null ? 0 : Math.max(0, 1 - candidate.distance_meters / 500);
  // Same named venue is decisive; conflicting names are weak-positive evidence
  // (shared complexes exist); when a name is unavailable on either side,
  // physical proximity carries the venue signal.
  const nameSim = n.venueName != null && candidate.venue_name != null
    ? titleSimilarity(n.venueName, candidate.venue_name)
    : null;
  const venue = nameSim != null ? (nameSim > 0.85 ? 1 : 0.3 * nameSim) : proximity;
  const category = n.category === candidate.category ? 1 : 0;
  const W = { venue: 0.3, time: 0.3, title: 0.2, category: 0.05 } as const;
  const total =
    (W.venue * venue + W.time * time + W.title * title + W.category * category) /
    (W.venue + W.time + W.title + W.category);
  return { title, venue, time, category, total };
}

async function resolveVenue(
  db: Queryable,
  n: NormalizedExternalEvent,
): Promise<string | null> {
  if (n.lat == null || n.lng == null) return null;
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM venues WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($2::float8,$1::float8),4326)::geography, 60)
     ORDER BY ST_Distance(location, ST_SetSRID(ST_MakePoint($2::float8,$1::float8),4326)::geography) LIMIT 1`,
    [n.lat, n.lng],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO venues (id, name, normalized_name, location, locality, region, country_code, timezone, verification_level)
     VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint($5::float8,$4::float8),4326)::geography,
             $6,'NV','US','America/Los_Angeles','source_verified')
     ON CONFLICT (id) DO NOTHING`,
    [id, n.venueName ?? "Ticketmaster Venue", (n.venueName ?? "ticketmaster venue").toLowerCase(), n.lat, n.lng, "Las Vegas"],
  );
  await db.query(
    `INSERT INTO venue_sources (id, venue_id, provider, external_venue_id, confidence, active)
     VALUES ($1,$2,'ticketmaster',$3,0.95,TRUE)
     ON CONFLICT (provider, external_venue_id) DO NOTHING`,
    [crypto.randomUUID(), id, `tm:${n.venueTmId ?? n.externalId}`],
  );
  return id;
}

async function createCanonicalFromNormalized(
  db: Queryable,
  n: NormalizedExternalEvent,
): Promise<string> {
  const eventId = crypto.randomUUID();
  const venueId = await resolveVenue(db, n);
  await db.query(
    `INSERT INTO events (
       id, title, normalized_title, description, category_id, venue_id, location,
       locality, region, country_code, timezone, starts_at, ends_at, starts_at_precision,
       price_min, price_max, currency, canonical_ticket_url, cover_image_url,
       status, verification_level, visibility_status, source_count
     ) VALUES (
       $1, $2, $3, NULL,
       (SELECT id FROM event_categories WHERE key = $4),
       $5::uuid,
       ST_SetSRID(ST_MakePoint($7::float8, $6::float8), 4326)::geography,
       'Las Vegas', 'NV', 'US', 'America/Los_Angeles',
       $8, $9, $10,
       $11, $12, $13, $14, $15,
       $16, 'source_verified', 'published', 1
     )
     ON CONFLICT (id) DO NOTHING`,
    [
      eventId,
      n.title,
      n.normalizedTitle,
      n.category,
      venueId,
      n.lat,
      n.lng,
      n.startsAtUtc,
      n.endsAtUtc,
      n.startsAtPrecision,
      n.priceMin,
      n.priceMax,
      n.currency ?? "USD",
      n.ticketUrl,
      n.imageUrl,
      n.status === "canceled" ? "canceled" : "scheduled",
    ],
  );
  return eventId;
}

/**
 * HEAT-D009 — refresh path for already-attached sources. Cancellation and
 * postponement MUST propagate to the canonical event; enrichment fields only
 * ever fill gaps (never overwrite community content). A canceled canonical
 * never reverts automatically — that requires human review.
 */
async function refreshAttachedSource(
  client: { query: (...args: unknown[]) => Promise<unknown> },
  canonicalId: string,
  n: NormalizedExternalEvent,
  rawPayload: unknown,
): Promise<void> {
  await client.query(
    `UPDATE event_sources SET
       raw_payload = $2, last_synced_at = now(), active = TRUE
     WHERE provider='ticketmaster' AND external_event_id=$1`,
    [`tm:${n.externalId}`, JSON.stringify(rawPayload)],
  );
  await client.query(
    `UPDATE events SET
        status = CASE
          WHEN $2 = 'canceled' THEN 'canceled'
          WHEN status <> 'canceled' AND $2 = 'postponed' THEN 'postponed'
          ELSE status
        END,
        price_min  = COALESCE(price_min,  $3),
        price_max  = COALESCE(price_max,  $4),
        cover_image_url = COALESCE(cover_image_url, $5),
        updated_at = now()
      WHERE id = $1`,
    [
      canonicalId,
      n.status === "canceled" || n.status === "postponed" ? n.status : "scheduled",
      n.priceMin, n.priceMax, n.imageUrl,
    ],
  );
}

async function attachSource(
  client: import("pg").PoolClient,
  n: NormalizedExternalEvent,
  canonicalId: string,
  rawPayload: unknown,
): Promise<string> {
  await client.query(
    `UPDATE events SET
       source_count = source_count + 1,
       canonical_ticket_url = COALESCE(canonical_ticket_url, $2),
       cover_image_url = COALESCE(cover_image_url, $3),
       price_min = COALESCE(price_min, $4),
       price_max = COALESCE(price_max, $5),
       currency = COALESCE(currency, $6),
       status = CASE WHEN $7::text = 'canceled' THEN 'canceled' ELSE status END,
       updated_at = now()
     WHERE id = $1`,
    [canonicalId, n.ticketUrl, n.imageUrl,
     n.priceMin, n.priceMax, n.currency ?? "USD", n.status],
  );
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO event_sources (id, event_id, provider, external_event_id, raw_payload, source_priority, source_confidence, active, last_synced_at)
     VALUES ($1,$2,'ticketmaster',$3,$4,90,$5,TRUE, now())
     ON CONFLICT (provider, external_event_id) DO UPDATE SET
       raw_payload = EXCLUDED.raw_payload, last_synced_at = now(), active = TRUE
     RETURNING id`,
    [crypto.randomUUID(), canonicalId, `tm:${n.externalId}`, JSON.stringify(rawPayload), n.sourceConfidence],
  );
  return rows[0]!.id;
}

async function recordDecision(
  db: Queryable,
  sourceRowId: string,
  candidateEventId: string | null,
  decision: "auto_match" | "new_event",
  scores: { total: number; title: number; venue: number; time: number; category: number } | null,
): Promise<void> {
  await db.query(
    `INSERT INTO event_resolution_decisions (
       id, source_event_id, candidate_event_id, decision, match_score,
       title_score, venue_score, time_score, category_score, rule_version
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      crypto.randomUUID(), sourceRowId, candidateEventId, decision,
      scores?.total ?? null, scores?.title ?? null, scores?.venue ?? null,
      scores?.time ?? null, scores?.category ?? null,
      RESOLUTION_RULE_VERSION,
    ],
  );
}

const iso = (d: Date) => d.toISOString();

// ---------------------------------------------------------------------------

export interface FixtureCandidate {
  raw: unknown;
  normalized: NormalizedExternalEvent;
}

export interface OrchestrateOptions {
  apiKey?: string | undefined;
  dryRun?: boolean;
  transport?: (url: string) => Promise<unknown>;
  /** Fixture mode: bypasses transport entirely (tests / replay tooling). */
  fixtures?: FixtureCandidate[];
  /** HEAT-D007 — tiered schedule window passed through to the provider. */
  timeWindow?: { start: Date; end: Date };
}

export async function orchestrateTicketmasterIngestion(
  db: Queryable,
  opts: OrchestrateOptions,
): Promise<IngestOutcome> {
  // HEAT-D012 — the fixture pathway exists ONLY for tests/replay tooling.
  if (opts.fixtures != null && process.env.NODE_ENV === "production") {
    throw new Error("FIXTURE_INGESTION_FORBIDDEN");
  }

  const runId = crypto.randomUUID();
  await db.query(
    `INSERT INTO ingestion_runs (id, provider, scope) VALUES ($1,'ticketmaster','las_vegas_nv')`,
    [runId],
  );

  let candidates: Array<{ raw: unknown; normalized: NormalizedExternalEvent }> = opts.fixtures ?? [];
  let requestCount = 0;

  if (opts.fixtures == null) {
    const fetched = await fetchTicketmasterEvents(
      {
        apiKey: opts.apiKey,
        cityKey: "las_vegas_nv",
        ...(opts.timeWindow
          ? {
              startDateTime: iso(opts.timeWindow.start),
              endDateTime: iso(opts.timeWindow.end),
            }
          : {}),
      },
      opts.transport,
    );
    requestCount = fetched.requestCount;
    candidates = fetched.events.filter((e) => e.normalized != null)
      .map((e) => ({ raw: e.raw, normalized: e.normalized! }));
  }

  const outcome: IngestOutcome = {
    runId, received: candidates.length,
    created: 0, attached: 0, updated: 0, failed: 0,
  };

  for (const { raw, normalized: n } of candidates) {
    try {
      // Idempotent by provider identity — but "seen before" never means
      // "stale forever": HEAT-D009 requires cancellation/postponement and
      // price drift to propagate on every refresh.
      const existingSource = await db.query<{ event_id: string }>(
        `SELECT s.event_id FROM event_sources s
         WHERE s.provider='ticketmaster' AND s.external_event_id=$1 AND s.active`,
        [`tm:${n.externalId}`],
      );
      if (existingSource.rows[0]) {
        if (opts.dryRun) {
          outcome.updated += 1;
          continue;
        }
        const canonicalId = existingSource.rows[0].event_id;
        const client = await (db as unknown as { connect: () => Promise<import("pg").PoolClient> }).connect();
        try {
          await client.query("BEGIN");
          await refreshAttachedSource(client, canonicalId, n, raw);
          await client.query("COMMIT");
          outcome.updated += 1;
        } catch (e) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw e;
        } finally {
          client.release();
        }
        continue;
      }

      if (opts.dryRun) continue;

      const cands = n.startsAtPrecision === "exact" ? await findCandidates(db, n) : [];

      let best: { cand: CanonicalCandidate; score: ReturnType<typeof scoreMatch> } | null = null;
      for (const cand of cands) {
        const score = scoreMatch(cand, n);
        if (!best || score.total > best.score.total) best = { cand, score };
      }

      const client = await (db as unknown as { connect: () => Promise<import("pg").PoolClient> }).connect();
      // Ops tracer: tag failures with the last statement so per-candidate
      // errors can be surfaced in run telemetry (pg errors lose position info).
      const rawQuery = client.query.bind(client);
      (client as unknown as { query: unknown }).query = (...args: unknown[]) => {
        return Promise.resolve(
          (rawQuery as (...x: unknown[]) => Promise<unknown>)(...(args as [])),
        ).catch((e: Error & { lastSql?: string }) => {
          e.lastSql = String(args[0]).slice(0, 160);
          throw e;
        });
      };
      try {
        await client.query("BEGIN");
        if (best && best.score.total >= AUTO_ATTACH_THRESHOLD) {
          const srcId = await attachSource(client, n, best.cand.id, raw);
          await recordDecision(client as unknown as Queryable, srcId, best.cand.id, "auto_match", best.score);
          outcome.attached += 1;
        } else if (best && best.score.total >= AMBIGUOUS_THRESHOLD) {
          // Ambiguous band: create separately but leave an audit trail.
          const newId = await createCanonicalFromNormalized(client, n);
          const srcId = await attachSource(client, n, newId, raw);
          await recordDecision(client as unknown as Queryable, srcId, best.cand.id, "new_event", best.score);
          outcome.created += 1;
        } else {
          const newId = await createCanonicalFromNormalized(client, n);
          const srcId = await attachSource(client, n, newId, raw);
          await recordDecision(client as unknown as Queryable, srcId, newId, "new_event",
            best?.score ?? { total: 0, title: 0, venue: 0, time: 0, category: 0 });
          outcome.created += 1;
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
        throw e;
      }
      client.release();
    } catch (err) {
      outcome.failed += 1;
      const detail = `${(err as Error).message.slice(0, 160)} :: ${(err as Error & { lastSql?: string }).lastSql?.slice(0, 140) ?? ""}`;
      await db.query(
        `UPDATE ingestion_runs SET error_summary = COALESCE(error_summary || ' | ', '') || $2 WHERE id=$1`,
        [runId, detail],
      ).catch(() => undefined);
    }
  }

  await db.query(
    `UPDATE ingestion_runs SET status=$2, completed_at=now(),
       records_received=$3, records_created=$4, records_attached=$5,
       records_updated=$6, records_failed=$7, request_count=$8
     WHERE id=$1`,
    [runId,
     outcome.failed === 0 ? "success" : (outcome.created + outcome.attached + outcome.updated > 0 ? "partial" : "failed"),
     outcome.received, outcome.created, outcome.attached, outcome.updated, outcome.failed, requestCount],
  );

  // HEAT-D011 — provider health surfaces in /v1/metrics for dashboards.
  metrics.inc("provider_runs_total", { provider: "ticketmaster" });
  if (outcome.created > 0) metrics.inc("provider_records_total", { provider: "ticketmaster", outcome: "created" }, outcome.created);
  if (outcome.attached > 0) metrics.inc("provider_records_total", { provider: "ticketmaster", outcome: "attached" }, outcome.attached);
  if (outcome.updated > 0) metrics.inc("provider_records_total", { provider: "ticketmaster", outcome: "updated" }, outcome.updated);
  if (outcome.failed > 0) metrics.inc("provider_records_total", { provider: "ticketmaster", outcome: "failed" }, outcome.failed);

  return outcome;
}
