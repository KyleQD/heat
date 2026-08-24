/**
 * P3-010/011/012 — Native event creation. Transactional: resolve/create
 * venue-less canonical event, native source evidence, submission audit,
 * idempotency key, map cache invalidation hook.
 */
import crypto from "node:crypto";
import type { Queryable } from "../../db/pool.js";
import { normalizeTitle } from "../../lib/normalize.js";
import type { CreateEventRequest } from "@heat/api-contracts";

export interface CreateResult {
  eventId: string;
  reusedIdempotencyKey: boolean;
}

export async function createNativeEvent(
  db: Queryable,
  req: CreateEventRequest,
  userId: string,
  idempotencyKey: string | null,
  requestHash?: string,
): Promise<CreateResult> {
  const client = await (db as unknown as { connect: () => Promise<import("pg").PoolClient> }).connect();
  try {
    await client.query("BEGIN");

    if (idempotencyKey) {
      // Retry-safe: same key returns the original canonical event (TC-P3-004).
      // Same key + different payload is a client bug -> stable conflict code.
      const existing = await client.query<{ event_id: string; request_hash: string | null }>(
        "SELECT event_id, request_hash FROM native_event_submissions WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        if (requestHash && existing.rows[0].request_hash &&
            existing.rows[0].request_hash !== requestHash) {
          throw Object.assign(new Error("Idempotency key reused with different payload"), {
            statusCode: 409, code: "IDEMPOTENCY_CONFLICT",
          });
        }
        return { eventId: existing.rows[0].event_id, reusedIdempotencyKey: true };
      }
    }

    const { rows: catRows } = await client.query<{ id: number }>(
      "SELECT id FROM event_categories WHERE key = $1 AND active",
      [req.category],
    );
    if (!catRows[0]) {
      throw Object.assign(new Error("Unknown category"), { statusCode: 400, code: "INVALID_REQUEST" });
    }

    // Drop-pin near a known venue attaches that venue (CRT-AC-002).
    let venueId: string | null = req.location.venueId ?? null;
    if (venueId == null) {
      const { rows: nearby } = await client.query<{ id: string }>(
        `SELECT id FROM venues
         WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography, 75)
         ORDER BY ST_Distance(location, ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography)
         LIMIT 1`,
        [req.location.lat, req.location.lng],
      );
      venueId = nearby[0]?.id ?? null;
    }

    const eventId = crypto.randomUUID();
    await client.query(
      `
      INSERT INTO events (
        id, title, normalized_title, description, category_id, venue_id,
        location, starts_at, ends_at, starts_at_precision,
        price_min, price_max, currency, canonical_ticket_url,
        status, verification_level, visibility_status, created_by, source_count
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
        $9,$10,'exact',$11,$12,$13,$14,
        'scheduled','community','published',$15,1
      )
      `,
      [
        eventId,
        req.title.trim(),
        normalizeTitle(req.title),
        req.description ?? null,
        catRows[0].id,
        venueId,
        req.location.lng,
        req.location.lat,
        req.startsAt,
        req.endsAt,
        req.priceMin ?? null,
        req.priceMax ?? null,
        req.currency ?? null,
        req.ticketUrl ?? null,
        userId,
      ],
    );

    // Native is still a source: evidence row + submission snapshot.
    await client.query(
      `INSERT INTO event_sources (id, event_id, provider, external_event_id, raw_payload, source_priority, source_confidence, active)
       VALUES ($1,$2,'native',$3,$4,100,0.9,TRUE)`,
      [crypto.randomUUID(), eventId, `native:${eventId}`, JSON.stringify({ submittedBy: userId })],
    );
    await client.query(
      `INSERT INTO native_event_submissions (id, event_id, creator_user_id, submitted_payload, duplicate_candidates, idempotency_key, request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        crypto.randomUUID(),
        eventId,
        userId,
        JSON.stringify(req),
        JSON.stringify([]),
        idempotencyKey,
        requestHash ?? null,
      ],
    );

    await client.query("COMMIT");
    return { eventId, reusedIdempotencyKey: false };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
