/**
 * Remediation Round 2 regression coverage (v1.1 handoff).
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let tokenA: string;
let tokenB: string;

const BBOX = "north=36.33&south=35.98&east=-114.94&west=-115.38&zoom=10";

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  tokenA = (await app.inject({ method: "POST", url: "/v1/auth/session" })).json().token;
  tokenB = (await app.inject({ method: "POST", url: "/v1/auth/session" })).json().token;
});

afterAll(async () => {
  await app.close().catch(() => undefined);
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://heat:heat@localhost:5433/heat" });
  try {
    await pool.query("DELETE FROM events WHERE title LIKE 'R2-%'");
  } finally {
    await pool.end();
  }
});

const authA = () => ({ authorization: `Bearer ${tokenA}` });
const authB = () => ({ authorization: `Bearer ${tokenB}` });

// ---------------------------------------------------------------------------
// R2-002 — personalized Starred responses never enter the shared cache
// ---------------------------------------------------------------------------

describe("R2-002 personalized cache isolation", () => {
  it("user A stars an event; user B and anonymous must never see A's starredOnly result", async () => {
    // Pick an event and star it as user A.
    const mapRes = await app.inject({ method: "GET", url: `/v1/map/events?${BBOX}&window=now` });
    const eventId = (mapRes.json() as { events: Array<{ id: string }> }).events[0]!.id;
    await app.inject({ method: "PUT", url: `/v1/events/${eventId}/star`, headers: authA() });

    // A's personalized starred-only view contains the event.
    const aView = await app.inject({
      method: "GET",
      url: `/v1/map/events?${BBOX}&window=now&starredOnly=true`,
      headers: authA(),
    });
    const aIds = (aView.json() as { events: Array<{ id: string; starred: boolean | null }> }).events.map((e) => e.id);
    expect(aIds).toContain(eventId);

    // B's starred-only view is computed for B — not a replay of A's.
    const bView = await app.inject({
      method: "GET",
      url: `/v1/map/events?${BBOX}&window=now&starredOnly=true`,
      headers: authB(),
    });
    const bIds = (bView.json() as { events: Array<{ id: string }> }).events.map((e) => e.id);
    expect(bIds).not.toContain(eventId);

    // Anonymous general-map query cannot leak starred=true flags.
    const anon = await app.inject({ method: "GET", url: `/v1/map/events?${BBOX}&window=now&starredOnly=true` });
    expect(anon.statusCode).toBe(200);
    for (const e of (anon.json() as { events: Array<{ starred: boolean | null }> }).events) {
      expect(e.starred === true).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// R2-003 — actor-scoped idempotency
// ---------------------------------------------------------------------------

describe("R2-003 actor-scoped idempotency", () => {
  const baseDraft = (title: string) => ({
    title,
    category: "party" as const,
    startsAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
    endsAt: new Date(Date.now() + 32 * 3600_000).toISOString(),
    location: { lat: 36.14, lng: -115.11 },
  });

  it("same actor + same key + same body → replay; different actor → independent create", async () => {
    const key = `r2-003-${Date.now()}`;
    const draftA = baseDraft(`R2-003 Alpha ${Date.now()}`);

    const r1 = await app.inject({
      method: "POST", url: "/v1/events",
      headers: { ...authA(), "x-allow-duplicate": "true", "idempotency-key": key },
      payload: draftA,
    });
    expect(r1.statusCode).toBe(201);
    const createdId = r1.json().event.id as string;

    // Same actor/key/body replays the original.
    const r2 = await app.inject({
      method: "POST", url: "/v1/events",
      headers: { ...authA(), "x-allow-duplicate": "true", "idempotency-key": key },
      payload: draftA,
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().event.id).toBe(createdId);

    // Different actor, SAME key → independent publish, no replay of A.
    const r3 = await app.inject({
      method: "POST", url: "/v1/events",
      headers: { ...authB(), "x-allow-duplicate": "true", "idempotency-key": key },
      payload: baseDraft(`R2-003 Beta ${Date.now()}`),
    });
    expect(r3.statusCode).toBe(201);
    expect(r3.json().event.id).not.toBe(createdId);

    // Identical CONTENT from two users does not collide either (different keys).
    const content = baseDraft(`R2-003 Twin ${Date.now()}`);
    const u1 = await app.inject({
      method: "POST", url: "/v1/events",
      headers: { ...authA(), "x-allow-duplicate": "true", "idempotency-key": `twin-a-${Date.now()}` },
      payload: content,
    });
    const u2 = await app.inject({
      method: "POST", url: "/v1/events",
      headers: { ...authB(), "x-allow-duplicate": "true", "idempotency-key": `twin-b-${Date.now()}` },
      payload: content,
    });
    expect(u1.statusCode).toBe(201);
    expect(u2.statusCode).toBe(201);
    expect(u1.json().event.id).not.toBe(u2.json().event.id);
  });

  it("same actor + same key + different body → IDEMPOTENCY_CONFLICT", async () => {
    const key = `r2-003-conflict-${Date.now()}`;
    await app.inject({
      method: "POST", url: "/v1/events",
      headers: { ...authA(), "x-allow-duplicate": "true", "idempotency-key": key },
      payload: baseDraft(`R2-003 Conflict One ${Date.now()}`),
    });
    const conflicting = await app.inject({
      method: "POST", url: "/v1/events",
      headers: { ...authA(), "x-allow-duplicate": "true", "idempotency-key": key },
      payload: baseDraft(`R2-003 Conflict Two ${Date.now()}`),
    });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("actor B reusing actor A's key with A's exact body still creates independently", async () => {
    const key = `r2-003-cross-${Date.now()}`;
    const draft = baseDraft(`R2-003 Cross ${Date.now()}`);
    const a = await app.inject({
      method: "POST", url: "/v1/events",
      headers: { ...authA(), "x-allow-duplicate": "true", "idempotency-key": key },
      payload: draft,
    });
    const b = await app.inject({
      method: "POST", url: "/v1/events",
      headers: { ...authB(), "x-allow-duplicate": "true", "idempotency-key": key },
      payload: draft, // identical body AND identical key, different actor
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.json().event.id).not.toBe(a.json().event.id);
  });
});

// ---------------------------------------------------------------------------
// R2-004 — description persists end to end
// ---------------------------------------------------------------------------

describe("R2-004 create payload parity", () => {
  it("description sent at create is stored and returned in detail", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/events",
      headers: { ...authA(), "x-allow-duplicate": "true", "idempotency-key": `r2-004-${Date.now()}` },
      payload: {
        title: `R2-004 Described ${Date.now()}`,
        description: "Bring a blanket and good headphones.",
        category: "community",
        startsAt: new Date(Date.now() + 34 * 3600_000).toISOString(),
        endsAt: new Date(Date.now() + 36 * 3600_000).toISOString(),
        location: { lat: 36.15, lng: -115.10 },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().event.description).toBe("Bring a blanket and good headphones.");
  });
});

// ---------------------------------------------------------------------------
// R2-011 — search lifecycle filtering
// ---------------------------------------------------------------------------

describe("R2-011 search lifecycle filtering", () => {
  it("canceled and already-ended events are excluded; postponed stays visible", async () => {
    // Fixtures inserted directly: the policy under test is search SQL, not
    // creation, so we avoid burning the per-hour create budget.
    const suffix = Date.now();
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://heat:heat@localhost:5433/heat" });
    try {
      await pool.query(
        `INSERT INTO events (id,title,normalized_title,category_id,location,starts_at,ends_at,starts_at_precision,status)
         VALUES
         ('99999999-1111-3111-8111-000000000101','R2-011 Cancelled $1','r2-011 cancelled $1',
          (SELECT id FROM event_categories WHERE key='music'),
          ST_SetSRID(ST_MakePoint(-115.09,36.16),4326)::geography,
          now() + interval '20 hours', now() + interval '22 hours','exact','canceled'),
         ('99999999-1111-3111-8111-000000000102','R2-011 Ended $1','r2-011 ended $1',
          (SELECT id FROM event_categories WHERE key='music'),
          ST_SetSRID(ST_MakePoint(-115.09,36.16),4326)::geography,
          now() - interval '6 hours', now() - interval '2 hours','exact','scheduled'),
         ('99999999-1111-3111-8111-000000000103','R2-011 Live Postponed $1','r2-011 live postponed $1',
          (SELECT id FROM event_categories WHERE key='music'),
          ST_SetSRID(ST_MakePoint(-115.09,36.16),4326)::geography,
          now() + interval '24 hours', now() + interval '26 hours','exact','postponed')`.replaceAll("$1", String(suffix)),
      );

      const res = await app.inject({
        method: "GET",
        url: `/v1/search?q=${encodeURIComponent("R2-011")}&limit=20`,
      });
      const titles = (res.json() as { events: Array<{ title: string }> }).events.map((e) => e.title);
      expect(titles.some((t) => t.includes("Cancelled"))).toBe(false);
      expect(titles.some((t) => t.includes("Ended"))).toBe(false);
      expect(titles.some((t) => t.includes("Postponed"))).toBe(true);
    } finally {
      await pool.query("DELETE FROM events WHERE id::text LIKE '99999999-1111-3111-8111-00000000010%'");
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------
// R2-013 — navigation-start correlation
// ---------------------------------------------------------------------------

describe("R2-013 route-request correlation", () => {
  it("navigation-start with mismatched routeRequestId/event pair does not mark started", async () => {
    const mapRes = await app.inject({ method: "GET", url: `/v1/map/events?${BBOX}&window=now` });
    const events = (mapRes.json() as { events: Array<{ id: string }> }).events;

    const preview = await app.inject({
      method: "POST", url: "/v1/routes/preview",
      payload: { eventId: events[0]!.id, origin: { lat: 36.1, lng: -115.18 }, modes: ["drive"] },
    });
    const routeRequestId = preview.json().routeRequestId as string;
    const otherEventId = events[1]!.id;

    await app.inject({
      method: "POST", url: "/v1/routes/navigation-start",
      payload: { eventId: otherEventId, mode: "drive", provider: "apple_maps", routeRequestId },
    });

    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://heat:heat@localhost:5433/heat" });
    try {
      const { rows } = await pool.query<{ external_navigation_started_at: Date | null }>(
        "SELECT external_navigation_started_at FROM event_route_requests WHERE id = $1",
        [routeRequestId],
      );
      expect(rows[0]!.external_navigation_started_at).toBeNull();
    } finally {
      await pool.end();
    }
  });
});
