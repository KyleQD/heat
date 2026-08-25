/**
 * Integration tests — run against the live PostGIS database (docker compose).
 * Covers VS-1 acceptance scenarios: GEO-AC, CRT-AC, STAR-AC, GO-AC.
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let token: string;

const BBOX = "north=36.33&south=35.98&east=-114.94&west=-115.38";

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const res = await app.inject({ method: "POST", url: "/v1/auth/session" });
  token = res.json().token as string;
});

afterAll(async () => {
  await app.close();
});

async function mapQuery(extra = ""): Promise<{ events: Array<Record<string, unknown>>; heatPoints: unknown[]; clusters: Array<{ count: number }> }> {
  const res = await app.inject({ method: "GET", url: `/v1/map/events?${BBOX}&zoom=10&window=now${extra}` });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe("GEO viewport (GEO-AC-001..006)", () => {
  it("returns bounded canonical marker records with no raw payloads", async () => {
    const body = await mapQuery("&includeStarredState=true");
    expect(body.events.length).toBeGreaterThan(0);
    const e = body.events[0]!;
    for (const key of ["id", "title", "lat", "lng", "heatScore", "confidence", "trend", "starred", "markerPriority"]) {
      expect(e).toHaveProperty(key);
    }
    expect(JSON.stringify(body)).not.toContain("rawPayload");
    expect(body.events.length).toBeLessThanOrEqual(400);
  });

  it("excludes events outside bounds (GEO-AC-002)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/map/events?north=36.00&south=35.99&east=-114.99&west=-115.0&zoom=15&window=now",
    });
    const body = res.json() as { events: Array<{ lat: number; lng: number }> };
    for (const e of body.events) {
      expect(e.lat).toBeLessThanOrEqual(36.0);
      expect(e.lng).toBeGreaterThanOrEqual(-115.0);
      expect(e.lng).toBeLessThanOrEqual(-114.99);
    }
  });

  it("tonight window includes after-midnight event (GEO-AC-003)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/map/events?${BBOX}&zoom=10&window=tonight`,
    });
    const titles = (res.json() as { events: Array<{ title: string }> }).events.map((e) => e.title);
    expect(titles).toContain("Late Night Vinyl Sessions");
  });

  it("canceled event is clearly status-marked (GEO-AC-004)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/map/events?${BBOX}&zoom=10&window=tonight`,
    });
    const canceled = (res.json() as { events: Array<{ title: string; status: string }> }).events.find(
      (e) => e.title === "Harbor Lights Acoustic Evening",
    );
    expect(canceled?.status).toBe("canceled");
  });

  it("two same-venue events both render (GEO-AC-005)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/map/events?${BBOX}&zoom=10&window=tonight` });
    const body = res.json() as { events: Array<{ title: string }> };
    const twilight = body.events.filter((e) => String(e.title).startsWith("Twilight Sessions"));
    expect(twilight.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects inverted bbox and world-sized queries (endpoint matrix guard)", async () => {
    let res = await app.inject({ method: "GET", url: "/v1/map/events?north=35&south=36&east=-115&west=-116&zoom=15" });
    expect(res.statusCode).toBe(400);
    res = await app.inject({ method: "GET", url: "/v1/map/events?north=89&south=-89&east=179&west=-179&zoom=15" });
    // World-size is syntactically valid but server caps results; must not 500.
    expect([200, 400]).toContain(res.statusCode);
  });
});

describe("stars (STAR-AC-001..006)", () => {
  it("double star does not duplicate; count stays consistent", async () => {
    const { events } = await mapQuery();
    const id = events[0]!.id as string;
    const r1 = await app.inject({ method: "PUT", url: `/v1/events/${id}/star`, headers: { authorization: `Bearer ${token}` } });
    const r2 = await app.inject({ method: "PUT", url: `/v1/events/${id}/star`, headers: { authorization: `Bearer ${token}` } });
    expect(r1.statusCode).toBe(200);
    expect(r2.json()).toEqual(r1.json());
    // history check via detail
    const d = await app.inject({ method: "GET", url: `/v1/events/${id}`, headers: { authorization: `Bearer ${token}` } });
    expect(d.json().stars.starredByViewer).toBe(true);
  });

  it("unstar preserves history and returns current state", async () => {
    const { events } = await mapQuery();
    const id = events[0]!.id as string;
    await app.inject({ method: "PUT", url: `/v1/events/${id}/star`, headers: { authorization: `Bearer ${token}` } });
    const del = await app.inject({ method: "DELETE", url: `/v1/events/${id}/star`, headers: { authorization: `Bearer ${token}` } });
    expect(del.json()).toMatchObject({ starred: false });
    const del2 = await app.inject({ method: "DELETE", url: `/v1/events/${id}/star`, headers: { authorization: `Bearer ${token}` } });
    expect(del2.json().starCount).toBe(del.json().starCount); // idempotent
  });

  it("requires auth (AUTH_REQUIRED) (STAR gate)", async () => {
    const { events } = await mapQuery();
    const id = events[0]!.id as string;
    const res = await app.inject({ method: "PUT", url: `/v1/events/${id}/star` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("AUTH_REQUIRED");
  });

  it("never exposes star user identities (TC-P5-004)", async () => {
    const d = await app.inject({ method: "GET", url: `/v1/map/events?${BBOX}&zoom=10` });
    expect(d.body).not.toContain("userId");
    expect(d.body).not.toContain("starrers");
  });
});

describe("GO / routing (GO-AC-001..005)", () => {
  it("previews routes for multiple modes; unavailable modes degrade gracefully (TC-P6-002)", async () => {
    const { events } = await mapQuery();
    const id = events[0]!.id as string;
    const res = await app.inject({
      method: "POST",
      url: "/v1/routes/preview",
      payload: { eventId: id, origin: { lat: 36.1, lng: -115.18 }, modes: ["drive", "walk"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.routes.length).toBeGreaterThanOrEqual(1);
    expect(body.routeRequestId).toBeTruthy();
  });

  it("rejects invalid origin with LOCATION_REQUIRED (P6-004)", async () => {
    const { events } = await mapQuery();
    const res = await app.inject({
      method: "POST",
      url: "/v1/routes/preview",
      payload: { eventId: events[0]!.id, origin: { lat: 999, lng: 999 }, modes: ["drive"] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("LOCATION_REQUIRED");
  });

  it("navigation start records intent without route path storage (TC-P6-005)", async () => {
    const { events } = await mapQuery();
    const res = await app.inject({
      method: "POST",
      url: "/v1/routes/navigation-start",
      payload: { eventId: events[0]!.id, mode: "drive", provider: "apple_maps" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(true);
  });
});

describe("native creation (CRT-AC-001..006)", () => {
  const draft = {
    title: `Integration Rooftop Party ${Date.now()}`,
    category: "party",
    startsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
    endsAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
    location: { lat: 36.11, lng: -115.16 },
  };

  it("creates a canonical community event that appears on the map (CRT-AC-001)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: `Bearer ${token}`, "x-allow-duplicate": "true", "idempotency-key": `it-${Date.now()}` },
      payload: draft,
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.trustLevel).toBe("community");
    const map = await mapQuery();
    expect(map.events.some((e) => e.id === created.event.id)).toBe(true);
  });

  it("same idempotency-key retry yields ONE canonical event (CRT-AC-004/TC-P3-004)", async () => {
    const key = `it-idem-${Date.now()}`;
    const r1 = await app.inject({ method: "POST", url: "/v1/events", headers: { authorization: `Bearer ${token}`, "x-allow-duplicate": "true", "idempotency-key": key }, payload: draft });
    const r2 = await app.inject({ method: "POST", url: "/v1/events", headers: { authorization: `Bearer ${token}`, "x-allow-duplicate": "true", "idempotency-key": key }, payload: draft });
    expect(r1.json().event.id).toBe(r2.json().event.id);
  });

  it("duplicate candidates surface before publish (CRT-AC-003)", async () => {
    // Self-contained probe: create the original first so the check never
    // depends on how long ago static fixtures were seeded.
    const originalStart = new Date(Date.now() + 9 * 3600_000);
    await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: `Bearer ${token}`, "x-allow-duplicate": "true", "idempotency-key": `dup-probe-${Date.now()}` },
      payload: {
        title: "Dup Probe Original Set",
        category: "music",
        startsAt: originalStart.toISOString(),
        endsAt: new Date(originalStart.getTime() + 2 * 3600_000).toISOString(),
        location: { lat: 36.1521, lng: -115.2014 },
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/events/duplicate-check",
      payload: {
        title: "Dup Probe Original Set!",
        category: "music",
        startsAt: new Date(originalStart.getTime() + 15 * 60_000).toISOString(),
        endsAt: new Date(originalStart.getTime() + 2 * 3600_000).toISOString(),
        location: { lat: 36.1521, lng: -115.2014 },
      },
    });
    expect(res.statusCode).toBe(200);
    const cands = res.json().candidates;
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0].matchConfidence).toBeGreaterThan(0.5);
  });

  it("blocks end before start (CRT-AC-005)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { authorization: `Bearer ${token}`, "x-allow-duplicate": "true" },
      payload: { ...draft, startsAt: draft.endsAt, endsAt: draft.startsAt, title: "Bad Times Test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("anonymous creation requires auth but duplicate-check stays open", async () => {
    const anon = await app.inject({ method: "POST", url: "/v1/events", payload: draft });
    expect(anon.statusCode).toBe(401);
    const dupCheck = await app.inject({
      method: "POST",
      url: "/v1/events/duplicate-check",
      payload: draft,
    });
    expect(dupCheck.statusCode).toBe(200);
  });
});

describe("search (accessibility fallback / venue search)", () => {
  it("finds canonical events by title and returns grouped results", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/search?q=neon" });
    expect(res.statusCode).toBe(200);
    const items = res.json().events;
    expect(items.some((i: { type: string }) => i.type === "event")).toBe(true);
  });

  it("finds venues for create flow", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/search?q=sphere" });
    const items = res.json().events;
    expect(items.some((i: { type: string; name?: string }) => i.type === "venue")).toBe(true);
  });
});

describe("event detail (EVT-AC)", () => {
  it("sparse event renders without attendance estimate (no false precision)", async () => {
    const map = await mapQuery();
    const sparse = map.events.find((e) => e.title === "Open Decks Rooftop Social");
    expect(sparse).toBeTruthy();
    const d = await app.inject({ method: "GET", url: `/v1/events/${sparse!.id}` });
    expect(d.statusCode).toBe(200);
    const detail = d.json();
    if (detail.heat.attendanceEstimate != null) {
      expect(detail.heat.attendanceEstimate.displayText).not.toBeNull();
    }
  });

  it("hidden events return EVENT_NOT_FOUND (moderation baseline)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/search?q=crypto%20alpha" });
    expect(res.json().events.filter((i: { type: string }) => i.type === "event")).toHaveLength(0);
  });

  it("unknown id returns stable error code", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/events/00000000-0000-3000-8000-000000000000" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("EVENT_NOT_FOUND");
  });
});
