import { decodeDelivery, projectDelivery, heatEventMutation } from './map-context.mjs';
import { BridgeError } from './transport.mjs';

/** Caller supplies HEAT's existing normalization helper and verified DB pool. */
export function createPostgresInbox(pool, { normalizeTitle }) {
  if (typeof normalizeTitle !== 'function') throw new TypeError('HEAT normalizeTitle required');
  return {
    async apply(input) {
      const delivery = structuredClone(input);
      const { publication, context } = decodeDelivery(delivery);
      const sourceId = publication.event_id.toLowerCase();
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        // Serializes even a first delivery, before an inbox row exists.
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 7351))', [sourceId]);
        const saved = (await db.query('SELECT state, hidden_by_bridge FROM flow_bridge.inbox WHERE source_event_id=$1 FOR UPDATE', [sourceId])).rows[0];
        const result = projectDelivery(saved?.state ?? null, delivery);
        if (result.effect.endsWith('ignored')) { await db.query('COMMIT'); return result; }
        const binding = (await db.query(`
          SELECT b.heat_event_id, b.source_venue_id, b.heat_venue_id,
                 e.updated_at = b.expected_event_updated_at AS unchanged,
                 e.visibility_status, e.deleted_at
          FROM flow_bridge.event_bindings b JOIN public.events e ON e.id=b.heat_event_id
          WHERE b.source_event_id=$1 FOR UPDATE OF b,e`, [sourceId])).rows[0];
        if (context && (!binding || binding.heat_event_id !== context.heat_event_id.toLowerCase() || binding.source_venue_id !== context.venue_id.toLowerCase() || binding.heat_venue_id !== context.heat_venue_id.toLowerCase())) throw new BridgeError('UNAPPROVED_CANONICAL_MAPPING', 409);
        if (binding) {
          if (binding.deleted_at || !binding.unchanged || (binding.visibility_status !== 'published' && !(binding.visibility_status === 'hidden' && saved?.hidden_by_bridge))) throw new BridgeError('TARGET_CHANGED_OR_MODERATED', 409);
          result.state.mapping = { heat_event_id: binding.heat_event_id, source_venue_id: binding.source_venue_id, heat_venue_id: binding.heat_venue_id };
        }
        const mutation = heatEventMutation(result.state);
        // A remembered mapping cannot authorize a write after resolver revocation.
        if (mutation && !binding) throw new BridgeError('UNAPPROVED_CANONICAL_MAPPING', 409);
        let hidden = false;
        if (mutation) {
          let updated;
          if (mutation.action === 'hide') {
            hidden = true;
            updated = await db.query("UPDATE public.events SET visibility_status='hidden', updated_at=clock_timestamp() WHERE id=$1 RETURNING updated_at::text", [mutation.id]);
          } else {
            const e = mutation.event;
            updated = await db.query(`UPDATE public.events SET
              title=$2, normalized_title=$3, description=$4, venue_id=$5,
              category_id=(SELECT id FROM public.event_categories WHERE key=$6),
              location=ST_SetSRID(ST_MakePoint($8::float8,$7::float8),4326)::geography,
              timezone=$9, starts_at=$10, ends_at=$11, status=$12,
              visibility_status='published', updated_at=clock_timestamp()
              WHERE id=$1 RETURNING updated_at::text`,
            [e.id,e.title,normalizeTitle(e.title),e.description,e.venue_id,e.category_key,e.lat,e.lng,e.timezone,e.starts_at,e.ends_at,e.status]);
          }
          if (updated.rowCount !== 1) throw new Error('Mapped event missing');
          await db.query('UPDATE flow_bridge.event_bindings SET expected_event_updated_at=$2 WHERE source_event_id=$1', [sourceId,updated.rows[0].updated_at]);
        }
        await db.query(`INSERT INTO flow_bridge.inbox(source_event_id,revision,state,hidden_by_bridge)
          VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(source_event_id) DO UPDATE SET
          revision=EXCLUDED.revision,state=EXCLUDED.state,hidden_by_bridge=EXCLUDED.hidden_by_bridge,updated_at=clock_timestamp()`,
        [sourceId,publication.revision,JSON.stringify(result.state),hidden]);
        await db.query('COMMIT');
        return result;
      } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        throw err;
      } finally { db.release(); }
    },
    async read(id) {
      const { rows } = await pool.query('SELECT state FROM flow_bridge.inbox WHERE source_event_id=$1', [id]);
      return rows[0]?.state ?? null;
    },
    // Pool lifetime belongs to the API/worker, not this adapter.
    async close() {},
  };
}
