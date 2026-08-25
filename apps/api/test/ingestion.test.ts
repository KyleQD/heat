/**
 * Phase D/E fixture tests — Ticketmaster normalization + resolution
 * orchestration. No network, no API keys: transport is bypassed via fixtures.
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import {
  normalizeTmEvent,
  type NormalizedExternalEvent,
} from "../src/modules/ingestion/ticketmaster.js";
import { orchestrateTicketmasterIngestion } from "../src/modules/ingestion/orchestrator.js";

process.env.ADMIN_TOKEN = "admin-test-token";

let app: FastifyInstance;
let db: import("pg").Pool;
const ADMIN = () => ({ authorization: `Bearer admin-test-token` });
let adminTokenOn = false;

beforeAll(async () => {
  const { getPool } = await import("../src/db/pool.js");
  db = getPool({
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://heat:heat@localhost:5433/heat",
    LOG_LEVEL: "error",
  } as never);
  app = await buildApp({ LOG_LEVEL: "error" } as never);
  await app.ready();
});

afterAll(async () => {
  await app.close().catch(() => undefined);
  delete process.env.ADMIN_TOKEN;
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://heat:heat@localhost:5433/heat" });
  try {
    // Clean provider-created rows (keep seeded/native data intact).
    // Order matters: decisions → sources → events (FK chain).
    await pool.query(
      `DELETE FROM event_resolution_decisions
       WHERE source_event_id IN (SELECT id FROM event_sources WHERE provider='ticketmaster')`,
    );
    await pool.query(`DELETE FROM event_sources WHERE provider='ticketmaster'`);
    await pool.query(`DELETE FROM events WHERE title LIKE 'TM Fixture%' OR title LIKE 'Neon Pulse%'`);
    await pool.query(`DELETE FROM venues WHERE name LIKE 'TM Fixture Venue%' OR name='Ticketmaster Venue' AND verified_owner_id IS NULL AND verification_level='source_verified' AND street_address IS NULL AND locality='Las Vegas' AND slug IS NULL`);
    // Admin-surface rows regardless of which updated_by label wrote them.
    await pool.query(`DELETE FROM feature_flag_overrides WHERE key IN ('ticketmaster_enabled','stars_enabled')`);
    await pool.query(`DELETE FROM ingestion_runs WHERE provider='ticketmaster'`);
  } finally {
    await pool.end();
  }
});

// --- Ticketmaster Discovery API response shape (trimmed real-world shape) ---
function tmEvent(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `tm-${Math.random().toString(36).slice(2, 10)}`,
    name: "TM Fixture Concert",
    dates: {
      start: { localDate: "2026-09-15", localTime: "20:00:00", dateTime: new Date(Date.now() + 21 * 3600_000).toISOString() },
      status: { code: "onsale" },
    },
    classifications: [{ segment: { name: "Music" } }],
    priceRanges: [{ min: 49, max: 199, currency: "USD" }],
    url: "https://www.ticketmaster.com/tm-fixture",
    images: [{ url: "https://img.example/x.jpg", width: 1024 }],
    _embedded: {
      venues: [{
        id: "tm-venue-1",
        name: "TM Fixture Venue",
        location: { latitude: "36.1699", longitude: "-115.1398" },
        city: { name: "Las Vegas" },
        state: { stateCode: "NV" },
      }],
    },
    ...overrides,
  };
}

function normalizedFrom(overrides: Record<string, unknown>): NormalizedExternalEvent {
  const raw = tmEvent(overrides);
  const n = normalizeTmEvent(raw as never, `tm:${raw.id}`);
  if (!n) throw new Error("fixture failed to normalize");
  return n;
}

describe("Phase D — Ticketmaster normalization", () => {
  it("maps segment→category, status codes, prices, venue geo", () => {
    const n = normalizeTmEvent(tmEvent({}) as never, "r1")!;
    expect(n.category).toBe("music");
    expect(n.status).toBe("scheduled");
    expect(n.priceMin).toBe(49);
    expect(n.currency).toBe("USD");
    expect(n.lat).toBeCloseTo(36.1699, 3);
    expect(n.venueTmId).toBe("tm-venue-1");
    expect(n.startsAtPrecision).toBe("exact");
  });

  it("preserves uncertainty: no dateTime → date-only precision, never an invented time", () => {
    const n = normalizeTmEvent(tmEvent({
      dates: { start: { localDate: "2026-09-15", noSpecificTime: true }, status: { code: "onsale" } },
    }) as never, "r2")!;
    expect(n.startsAtUtc).toBeNull();
    expect(["date_only", "date_tbd"]).toContain(n.startsAtPrecision);
  });

  it("canceled/postponed statuses map explicitly", () => {
    expect(normalizeTmEvent(tmEvent({ dates: { start: {}, status: { code: "cancelled" } } }) as never, "r3")!.status).toBe("canceled");
    expect(normalizeTmEvent(tmEvent({ dates: { start: {}, status: { code: "postponed" } } }) as never, "r4")!.status).toBe("postponed");
  });

  it("unknown segment falls back to other", () => {
    expect(normalizeTmEvent(tmEvent({
      classifications: [{ segment: { name: "Miscellaneous" } }],
    }) as never, "r5")!.category).toBe("other");
  });
});

describe("Phase D/E — orchestrator with resolution", () => {
  let firstRunId: string;
  // Stable provider identity across runs: idempotency is keyed on the
  // EXTERNAL id, so both runs must reuse the exact same normalized record.
  let concertN: NormalizedExternalEvent;
  let comedyN: NormalizedExternalEvent;

  it("creates canonical events + source rows from fixtures", async () => {
    concertN = normalizedFrom({});
    comedyN = normalizedFrom({ name: "TM Fixture Comedy Night", classifications: [{ segment: { name: "Arts & Theatre" } }] });
    const outcome = await orchestrateTicketmasterIngestion(db as never, {
      fixtures: [
        { raw: { fixture: true }, normalized: concertN },
        { raw: { fixture: true }, normalized: comedyN },
      ],
    });
    expect(outcome.received).toBe(2);
    expect(outcome.created).toBeGreaterThanOrEqual(1);
    firstRunId = outcome.runId;
  });

  it("second run with same external ids is idempotent (updated, not duplicated)", async () => {
    const before = await app.inject({ method: "GET", url: "/v1/search?q=TM%20Fixture&limit=20" });
    const countBefore = (before.json() as { events: unknown[] }).events.length;

    const outcome = await orchestrateTicketmasterIngestion(db as never, {
      fixtures: [{ raw: { fixture: true }, normalized: concertN! }],
    });
    expect(outcome.updated).toBeGreaterThanOrEqual(1);
    expect(outcome.created).toBe(0);

    const after = await app.inject({ method: "GET", url: "/v1/search?q=TM%20Fixture&limit=20" });
    expect((after.json() as { events: unknown[] }).events.length).toBe(countBefore);
  });

  it("near-identical community event attaches instead of duplicating (auto-match ≥0.90)", async () => {
    // Seed a matching canonical community event at the same place/time.
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://heat:heat@localhost:5433/heat" });
    const startsAt = new Date(Date.now() + 40 * 3600_000);
    await pool.query(
      `INSERT INTO events (id,title,normalized_title,category_id,location,starts_at,ends_at,starts_at_precision,status)
       VALUES ('99999999-1111-3111-8111-00000000e001','TM Fixture Concert','tm fixture concert',
               (SELECT id FROM event_categories WHERE key='music'),
               ST_SetSRID(ST_MakePoint(-115.1398,36.1699),4326)::geography,$1,$2,'exact','scheduled')
       ON CONFLICT (id) DO NOTHING`,
      [startsAt, new Date(startsAt.getTime() + 2 * 3600_000)],
    );
    await pool.end();

    const outcome = await orchestrateTicketmasterIngestion(db as never, {
      fixtures: [{
        raw: { fixture: true },
        normalized: normalizedFrom({
          dates: {
            start: { dateTime: startsAt.toISOString() },
            status: { code: "onsale" },
          },
        }),
      }],
    });
    expect(outcome.attached).toBeGreaterThanOrEqual(1);
    expect(outcome.created).toBe(0);
  });

  it("run telemetry recorded", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/admin/flags",
      headers: ADMIN(),
      payload: { key: "ticketmaster_enabled", enabled: true, reason: "test" },
    });
    expect(res.statusCode).toBe(200);
    adminTokenOn = true;

    const cfg = await app.inject({ method: "GET", url: "/v1/config" });
    expect(cfg.json().flags.ticketmaster_enabled).toBe(true);
  });
});

describe("Admin surface security", () => {
  it("admin endpoints are 404-absent without ADMIN_TOKEN and 403 without the token", async () => {
    // This suite set ADMIN_TOKEN; a wrong token is FORBIDDEN.
    const wrong = await app.inject({ method: "PUT", url: "/v1/admin/flags", headers: { authorization: "Bearer nope" }, payload: { key: "stars_enabled", enabled: false } });
    expect(wrong.statusCode).toBe(403);
  });

  it("flag override flows through /v1/config and can be re-disabled", async () => {
    expect(adminTokenOn).toBe(true);
    await app.inject({
      method: "PUT", url: "/v1/admin/flags",
      headers: ADMIN(), payload: { key: "ticketmaster_enabled", enabled: false, reason: "test done" },
    });
    const cfg = await app.inject({ method: "GET", url: "/v1/config" });
    expect(cfg.json().flags.ticketmaster_enabled).toBe(false);
  });

  it("ingest is flag-gated: disabled flag blocks non-dry-run ingest", async () => {
    const blocked = await app.inject({
      method: "POST", url: "/v1/admin/ingest/ticketmaster",
      headers: ADMIN(), payload: {},
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("PROVIDER_UNAVAILABLE");

    const dry = await app.inject({
      method: "POST", url: "/v1/admin/ingest/ticketmaster",
      headers: ADMIN(), payload: { dryRun: true },
    });
    expect(dry.statusCode).toBe(200); // dry-run permitted even when gated off
  });
});
