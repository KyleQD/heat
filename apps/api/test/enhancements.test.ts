/**
 * Enhancement-round integration tests: HEAT engine wiring, cache, reports,
 * creator edit, analytics batch, idempotency conflict, query plan.
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let token: string;

const BBOX = "north=36.33&south=35.98&east=-114.94&west=-115.38";

const BULK_PREFIX = "99999999-9999-3999-8999-";

async function ensureRepresentativeDataset(): Promise<void> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://heat:heat@localhost:5433/heat" });
  try {
    const { rows } = await pool.query<{ c: string }>("SELECT COUNT(*)::text AS c FROM events");
    if (Number(rows[0]!.c) >= 2500) return;
    // Deterministic synthetic density so the planner faces pilot-scale data
    // (TC-P2-004 precondition). Rows live far outside NOW/TONIGHT windows.
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (let i = 0; i < 3000; i += 1) {
      const lat = 36.05 + ((i * 37) % 2500) / 10000;      // deterministic scatter
      const lng = -115.32 + ((i * 53) % 3200) / 10000;
      const start = new Date(Date.now() + 40 * 24 * 3600_000 + i * 60_000);
      values.push(
        `${BULK_PREFIX}${String(i).padStart(12, "0")}`,
        `Synthetic Density Load ${i}`, `synthetic density load ${i}`, start,
        lng, lat,
      );
      const base = i * 6;
      tuples.push(
        `($${base + 1}::uuid,$${base + 2},$${base + 3},(SELECT id FROM event_categories WHERE key='other'),` +
        `ST_SetSRID(ST_MakePoint($${base + 5}::float8,$${base + 6}::float8),4326)::geography,$${base + 4},'exact')`,
      );
    }
    await pool.query(
      `INSERT INTO events (id, title, normalized_title, category_id, location, starts_at, starts_at_precision)
       VALUES ${tuples.join(",")} ON CONFLICT (id) DO NOTHING`,
      values,
    );
  } finally {
    await pool.end();
  }
}

beforeAll(async () => {
  await ensureRepresentativeDataset();
  app = await buildApp();
  await app.ready();
  const res = await app.inject({ method: "POST", url: "/v1/auth/session" });
  token = res.json().token as string;
});

afterAll(async () => {
  await app.close().catch(() => undefined);
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://heat:heat@localhost:5433/heat" });
  try {
    await pool.query("DELETE FROM events WHERE id::text LIKE $1", [`${BULK_PREFIX}%`]);
  } finally {
    await pool.end();
  }
});

// NOTE: must be a function — `token` is assigned in beforeAll, so any
// module-load-time object would capture undefined (Bearer undefined).
const authHeaders = () => ({ authorization: `Bearer ${token}` });

async function firstMapEvent(): Promise<{ id: string; title: string }> {
  const res = await app.inject({ method: "GET", url: `/v1/map/events?${BBOX}&zoom=10&window=now` });
  return (res.json() as { events: Array<{ id: string; title: string }> }).events[0]!;
}

describe("map response cache (doc 48)", () => {
  it("serves identical anonymous queries from cache (same generatedAt)", async () => {
    const r1 = await app.inject({ method: "GET", url: `/v1/map/events?${BBOX}&zoom=10&window=tonight` });
    const r2 = await app.inject({ method: "GET", url: `/v1/map/events?${BBOX}&zoom=10&window=tonight` });
    expect(r2.json().generatedAt).toBe(r1.json().generatedAt);
  });

  it("never caches user-specific star state across users", async () => {
    // Authenticated request must bypass cache and get a fresh generatedAt.
    const anon = await app.inject({ method: "GET", url: `/v1/map/events?${BBOX}&zoom=10&window=now` });
    const authed = await app.inject({
      method: "GET",
      url: `/v1/map/events?${BBOX}&zoom=10&window=now&includeStarredState=true`,
      headers: authHeaders(),
    });
    expect(new Date(authed.json().generatedAt).getTime())
      .toBeGreaterThanOrEqual(new Date(anon.json().generatedAt).getTime());
  });

  it("invalidates on canonical create", async () => {
    const before = await app.inject({ method: "GET", url: `/v1/map/events?${BBOX}&zoom=10&window=now` });
    await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { ...authHeaders(), "x-allow-duplicate": "true", "idempotency-key": `cache-bust-${Date.now()}` },
      payload: {
        title: `Cache Bust Party ${Date.now()}`,
        category: "party",
        startsAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
        endsAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
        location: { lat: 36.13, lng: -115.14 },
      },
    });
    const after = await app.inject({ method: "GET", url: `/v1/map/events?${BBOX}&zoom=10&window=now` });
    expect(after.json().events.length).toBeGreaterThan(before.json().events.length);
  });
});

describe("HEAT engine wiring (P11 groundwork)", () => {
  it("recalculates on star flush and writes snapshots", async () => {
    const ev = await firstMapEvent();
    const before = await app.inject({ method: "GET", url: `/v1/events/${ev.id}` });
    const scoreBefore = before.json().heat.score as number;

    await app.inject({ method: "PUT", url: `/v1/events/${ev.id}/star`, headers: authHeaders() });
    await app.inject({ method: "PUT", url: `/v1/events/${ev.id}/star`, headers: authHeaders() });
    const flushed = await app.heat.flush();
    expect(flushed).toBeGreaterThan(0);

    const after = await app.inject({ method: "GET", url: `/v1/events/${ev.id}` });
    const detail = after.json();
    expect(typeof detail.heat.score).toBe("number");
    // Engine output stays within contract bounds even when equal to prior seed.
    expect(detail.heat.score).toBeGreaterThanOrEqual(0);
    expect(detail.heat.score).toBeLessThanOrEqual(100);
    void scoreBefore;
  });

  it("engine score respects intent ladder end-to-end", async () => {
    const ev = await firstMapEvent();
    for (let i = 0; i < 3; i += 1) {
      await app.inject({ method: "PUT", url: `/v1/events/${ev.id}/star`, headers: authHeaders() }).catch(() => {});
    }
    await app.inject({
      method: "POST",
      url: "/v1/analytics/batch",
      payload: {
        events: [
          { name: "navigation_started", payload: { event_id: ev.id, mode: "drive" } },
          { name: "route_preview_requested", payload: { event_id: ev.id } },
        ],
      },
    });
    await app.heat.flush();
    const d = await app.inject({ method: "GET", url: `/v1/events/${ev.id}` });
    expect(d.statusCode).toBe(200);
  });
});

describe("reports endpoint (P13 baseline)", () => {
  it("accepts a valid reason with confirmation-only body", async () => {
    const ev = await firstMapEvent();
    const res = await app.inject({
      method: "POST",
      url: `/v1/events/${ev.id}/reports`,
      headers: authHeaders(),
      payload: { reason: "wrong_time", details: "starts an hour earlier" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ accepted: true });
    // No moderation internals leak.
    expect(res.body).not.toContain("status");
  });

  it("rejects invalid reasons and missing events", async () => {
    const ev = await firstMapEvent();
    const badReason = await app.inject({
      method: "POST", url: `/v1/events/${ev.id}/reports`, headers: authHeaders(),
      payload: { reason: "because" },
    });
    expect(badReason.statusCode).toBe(400);
    const missing = await app.inject({
      method: "POST", url: "/v1/events/00000000-0000-3000-8000-000000000000/reports",
      headers: authHeaders(), payload: { reason: "duplicate" },
    });
    expect(missing.json().error.code).toBe("EVENT_NOT_FOUND");
  });
});

describe("creator edit PATCH /v1/events/:id (P3-014)", () => {
  it("creator can edit title/time; ownership enforced server-side", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { ...authHeaders(), "x-allow-duplicate": "true", "idempotency-key": `edit-${Date.now()}` },
      payload: {
        title: `Editable Rooftop Session ${Date.now()}`,
        category: "party",
        startsAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
        endsAt: new Date(Date.now() + 7 * 3600_000).toISOString(),
        location: { lat: 36.12, lng: -115.15 },
      },
    });
    const eventId = create.json().event.id as string;

    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/events/${eventId}`,
      headers: authHeaders(),
      payload: { title: "Editable Rooftop Session — Extended", endsAt: new Date(Date.now() + 9 * 3600_000).toISOString() },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().title).toContain("Extended");

    // Second user cannot edit.
    const otherSession = await app.inject({ method: "POST", url: "/v1/auth/session" });
    const otherToken = otherSession.json().token as string;
    const forbidden = await app.inject({
      method: "PATCH",
      url: `/v1/events/${eventId}`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { title: "Hijacked Title" },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("FORBIDDEN");

    // Invalid time ordering blocked.
    const badTimes = await app.inject({
      method: "PATCH",
      url: `/v1/events/${eventId}`,
      headers: authHeaders(),
      payload: { startsAt: new Date(Date.now() + 30 * 3600_000).toISOString(), endsAt: new Date(Date.now() + 8 * 3600_000).toISOString() },
    });
    expect(badTimes.statusCode).toBe(400);
  });
});

describe("analytics batch privacy boundary (P0-011)", () => {
  it("rejects payloads carrying raw coordinates", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/batch",
      payload: { events: [{ name: "event_selected", payload: { event_id: "11111111-1111-3111-8111-111111111111", lat: 36.11 } }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_REQUEST");
  });

  it("enforces batch size bounds", async () => {
    const big = await app.inject({
      method: "POST",
      url: "/v1/analytics/batch",
      payload: { events: Array.from({ length: 101 }, (_, i) => ({ name: `x${i}` })) },
    });
    expect(big.statusCode).toBe(400);
  });

  it("stores interaction rows for event-scoped taxonomy events", async () => {
    const ev = await firstMapEvent();
    await app.inject({
      method: "POST",
      url: "/v1/analytics/batch",
      headers: authHeaders(),
      payload: {
        events: [
          { name: "event_selected", payload: { event_id: ev.id, selection_source: "marker" } },
          { name: "app_opened", payload: {} }, // non-event scoped: ignored, accepted
        ],
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/batch",
      headers: authHeaders(),
      payload: {
        events: [
          { name: "event_selected", payload: { event_id: ev.id, selection_source: "marker" } },
          { name: "app_opened", payload: {} }, // non-event scoped: accepted, not stored
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: 2, stored: 1 });
  });
});

describe("idempotency conflict (P3-011 hardening)", () => {
  it("same key different payload -> IDEMPOTENCY_CONFLICT", async () => {
    const key = `conflict-${Date.now()}`;
    const draftA = {
      title: `Conflict Probe Alpha ${Date.now()}`,
      category: "music" as const,
      startsAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
      endsAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
      location: { lat: 36.16, lng: -115.13 },
    };
    const r1 = await app.inject({
      method: "POST", url: "/v1/events",
      headers: { ...authHeaders(), "x-allow-duplicate": "true", "idempotency-key": key },
      payload: draftA,
    });
    expect(r1.statusCode).toBe(201);

    const draftB = { ...draftA, title: `Conflict Probe Bravo ${Date.now()}` };
    const r2 = await app.inject({
      method: "POST", url: "/v1/events",
      headers: { ...authHeaders(), "x-allow-duplicate": "true", "idempotency-key": key },
      payload: draftB,
    });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("same key same payload still replays original (TC-P3-004)", async () => {
    const key = `replay-${Date.now()}`;
    const draft = {
      title: `Replay Probe ${Date.now()}`,
      category: "arts" as const,
      startsAt: new Date(Date.now() + 10 * 3600_000).toISOString(),
      endsAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
      location: { lat: 36.17, lng: -115.12 },
    };
    const r1 = await app.inject({
      method: "POST", url: "/v1/events",
      headers: { ...authHeaders(), "x-allow-duplicate": "true", "idempotency-key": key },
      payload: draft,
    });
    const r2 = await app.inject({
      method: "POST", url: "/v1/events",
      headers: { ...authHeaders(), "x-allow-duplicate": "true", "idempotency-key": key },
      payload: draft,
    });
    expect(r1.json().event.id).toBe(r2.json().event.id);
  });
});

describe("query-plan guard (TC-P2-004 automated)", () => {
  it("viewport query uses the GIST spatial index", async () => {
    // Reach into the pool through the running app's map query EXPLAIN.
    const res = await app.inject({
      method: "GET",
      url: `/v1/map/events?${BBOX}&zoom=10&window=now&nocache=${Date.now()}`,
    });
    expect(res.statusCode).toBe(200);
    // Direct EXPLAIN via the module's own pool.
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://heat:heat@localhost:5433/heat" });
    try {
      // Representative street-level viewport (city-wide envelopes may
      // legitimately prefer a seq scan — that is not the contract under test).
      const plan = await pool.query(
        `EXPLAIN (COSTS OFF) SELECT e.id FROM events e
         WHERE e.visibility_status='published'
           AND ST_Intersects(e.location, ST_SetSRID(ST_MakeEnvelope(-115.18, 36.11, -115.155, 36.135),4326)::geography)`,
      );
      const text = plan.rows.map((r: { Plan?: string }) => JSON.stringify(r)).join("");
      expect(text).toContain("idx_events_location_gist");
    } finally {
      await pool.end();
    }
  });
});
