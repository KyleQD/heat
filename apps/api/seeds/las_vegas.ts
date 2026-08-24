/**
 * P0-014 / P2-009 — Deterministic Las Vegas seed writer.
 * Stable IDs (sha1-derived), fixed venue set, event times anchored to seed
 * time. Dev/staging ONLY — refuses to run when NODE_ENV=production.
 */
import crypto from "node:crypto";
import pg from "pg";
import { VENUES, EVENTS, type EventSeed, type VenueSeed } from "./fixtureData.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://heat:heat@localhost:5433/heat";

if ((process.env.NODE_ENV ?? "development") === "production") {
  console.error("Refusing to seed production. This tool is dev/staging only.");
  process.exit(1);
}

function uuid(key: string): string {
  const hex = crypto.createHash("sha1").update(`heat-seed:${key}`).digest("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), `3${hex.slice(13, 16)}`, `4${hex.slice(17, 20)}`, hex.slice(20, 32)].join("-");
}

const H = 3_600_000;
const now = Date.now();

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query("BEGIN");

    // City config (idempotent upsert).
    await pool.query(
      `INSERT INTO city_configs (city_key, display_name, timezone, center_lat, center_lng, bounds, enabled)
       VALUES ('las_vegas_nv','Las Vegas','America/Los_Angeles',36.1147,-115.1728,
               '{"north":36.331,"south":35.982,"east":-114.948,"west":-115.375}', TRUE)
       ON CONFLICT (city_key) DO NOTHING`,
    );

    // Categories.
    const categories: Array<[string, string, number]> = [
      ["music", "Music", 10],
      ["nightlife", "Nightlife", 20],
      ["festival", "Festival", 30],
      ["sports", "Sports", 40],
      ["food", "Food & Drink", 50],
      ["arts", "Arts & Theatre", 60],
      ["community", "Community", 70],
      ["convention", "Convention", 80],
      ["party", "Party", 90],
      ["other", "Other", 100],
    ];
    for (const [key, label, sort] of categories) {
      await pool.query(
        `INSERT INTO event_categories (key, label, active, sort_order) VALUES ($1,$2,TRUE,$3)
         ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label`,
        [key, label, sort],
      );
    }
    const { rows: catRows } = await pool.query<{ id: number; key: string }>(
      "SELECT id, key FROM event_categories",
    );
    const catId = new Map(catRows.map((r) => [r.key, r.id]));

    // Venues.
    for (const v of VENUES) {
      await pool.query(
        `INSERT INTO venues (id, name, normalized_name, location, street_address, locality, region, postal_code, country_code, timezone, capacity, verification_level)
         VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint($4,$5),4326)::geography, $6,$7,'NV','89109','US','America/Los_Angeles',$8,'source_verified')
         ON CONFLICT (id) DO NOTHING`,
        [uuid(`venue:${v.key}`), v.name, v.name.toLowerCase(), v.lng, v.lat, v.address, v.locality, v.capacity],
      );
    }

    // Events (+ native source evidence + placeholder HEAT snapshot history).
    let insertedEvents = 0;
    for (const e of EVENTS) {
      const venue = e.venueKey ? VENUES.find((v) => v.key === e.venueKey) : undefined;
      if (e.venueKey && !venue) throw new Error(`Unknown venueKey ${e.venueKey} on ${e.key}`);
      const lat = venue?.lat ?? e.lat;
      const lng = venue?.lng ?? e.lng;
      if (lat == null || lng == null) throw new Error(`No location for ${e.key}`);
      await insertEvent(pool, e, {
        id: uuid(`event:${e.key}`),
        venueId: venue ? uuid(`venue:${venue.key}`) : null,
        lat,
        lng,
        cat: catId.get(e.category)!,
        startsAt: new Date(now + e.startH * H),
        endsAt: e.endH == null ? null : new Date(now + e.endH * H),
      });
      insertedEvents += 1;
    }

    await pool.query("COMMIT");
    console.log(
      `Seeded ${VENUES.length} venues and ${insertedEvents} events into ${DATABASE_URL}`,
    );
  } catch (err) {
    await pool.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await pool.end();
  }
}

interface ResolvedEvent {
  id: string;
  venueId: string | null;
  lat: number;
  lng: number;
  cat: number;
  startsAt: Date;
  endsAt: Date | null;
}

async function insertEvent(
  pool: pg.Pool,
  e: EventSeed,
  r: ResolvedEvent,
): Promise<void> {
  await pool.query(
    `INSERT INTO events (
       id, title, normalized_title, description, category_id, venue_id, location,
       locality, region, country_code, timezone, starts_at, ends_at, starts_at_precision,
       price_min, price_max, currency, canonical_ticket_url, age_restriction,
       status, verification_level, visibility_status,
       heat_score, heat_confidence, attendance_low, attendance_high, attendance_estimate_type,
       stars_count, source_count
     ) VALUES (
       $1,$2,$3,$4,$5,$6, ST_SetSRID(ST_MakePoint($7,$8),4326)::geography,
       'Las Vegas','NV','US','America/Los_Angeles',$9,$10,'exact',
       $11,$12,'USD',$13,$14,
       $15,$16,$17,
       $18,$19,$20,$21,$22,
       $23,1
     )
     ON CONFLICT (id) DO NOTHING`,
    [
      r.id,
      e.title,
      e.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim(),
      e.description ?? null,
      r.cat,
      r.venueId,
      r.lng,
      r.lat,
      r.startsAt,
      r.endsAt,
      e.priceMin ?? null,
      e.priceMax ?? null,
      e.ticketUrl ?? null,
      e.ageRestriction ?? null,
      e.status ?? "scheduled",
      e.verification ?? "community",
      e.visibility ?? "published",
      e.heat,
      e.confidence,
      e.attLow ?? null,
      e.attHigh ?? null,
      e.attType ?? "unknown",
      Math.floor(e.heat / 10),
    ],
  );

  // Placeholder HEAT history so score-history requirements have data pre-P11.
  await pool.query(
    `INSERT INTO event_heat_snapshots (event_id, calculated_at, heat_score, heat_confidence, attendance_low, attendance_high, trend, scoring_model_version, input_version)
     VALUES ($1, now() - interval '1 hour', $2, $3, $4, $5, $6, 'heat-v0-placeholder', 'seed-1')`,
    [
      r.id,
      Math.max(0, e.heat - 6),
      e.confidence,
      e.attLow ?? null,
      e.attHigh ?? null,
      e.status === "canceled" ? "cooling_down" : "warming_up",
    ],
  );
  await pool.query(
    `INSERT INTO event_heat_snapshots (event_id, calculated_at, heat_score, heat_confidence, attendance_low, attendance_high, trend, scoring_model_version, input_version)
     VALUES ($1, now(), $2, $3, $4, $5, $6, 'heat-v0-placeholder', 'seed-1')`,
    [
      r.id,
      e.heat,
      e.confidence,
      e.attLow ?? null,
      e.attHigh ?? null,
      e.status === "canceled" ? "cooling_down" : "steady",
    ],
  );

  // Seed source evidence row (native provenance for the fixture itself).
  await pool.query(
    `INSERT INTO event_sources (id, event_id, provider, external_event_id, source_priority, source_confidence, active)
     VALUES ($1,$2,'native',$3,100,0.95,TRUE)
     ON CONFLICT (provider, external_event_id) DO NOTHING`,
    [uuid(`source:${e.key}`), r.id, `seed:${e.key}`],
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
