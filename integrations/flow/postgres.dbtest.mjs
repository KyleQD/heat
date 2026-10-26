import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createPostgresInbox } from './postgres-inbox.mjs';
import { normalizeTitle } from '../../apps/api/src/lib/normalize.ts';
import { queryViewport } from '../../apps/api/src/modules/map/mapRepository.ts';
import { fetchEventDetail } from '../../apps/api/src/modules/events/eventRepository.ts';

const url = process.env.FLOW_BRIDGE_TEST_DATABASE_URL;
if (!url || process.env.FLOW_BRIDGE_DISPOSABLE_DB !== '1' || !['127.0.0.1','localhost'].includes(new URL(url).hostname)) throw new Error('Disposable loopback test DB explicitly required');
const pool = new pg.Pool({ connectionString: url });
after(() => pool.end());
await pool.query(await readFile(new URL('./postgres-schema.sql', import.meta.url), 'utf8'));
await pool.query("INSERT INTO event_categories(key,label) VALUES('music','Music') ON CONFLICT(key) DO NOTHING");
const inbox = createPostgresInbox(pool, { normalizeTitle });
async function fixture() {
  const source = randomUUID(), sourceVenue = randomUUID(), event = randomUUID(), venue = randomUUID();
  await pool.query("INSERT INTO venues(id,name,normalized_name,location) VALUES($1,'Test venue','test venue',ST_SetSRID(ST_MakePoint(-115.1398,36.1699),4326)::geography)", [venue]);
  await pool.query(`INSERT INTO events(id,title,normalized_title,category_id,venue_id,location,starts_at,ends_at,stars_count,heat_score,heat_confidence)
    VALUES($1,'Before','before',(SELECT id FROM event_categories WHERE key='music'),$2,ST_SetSRID(ST_MakePoint(-115.1398,36.1699),4326)::geography,'2026-11-01T02:00:00Z','2026-11-01T05:00:00Z',7,42,55)`, [event,venue]);
  await pool.query(`INSERT INTO flow_bridge.event_bindings(source_event_id,heat_event_id,source_venue_id,heat_venue_id,expected_event_updated_at)
    SELECT $1,$2,$3,$4,updated_at FROM events WHERE id=$2`, [source,event,sourceVenue,venue]);
  const delivery = revision => ({ bridge_version: 'heat-staging/1', publication: { event_id: source, source_product:'tourify', revision, status:'public', updated_at:'2026-10-26T12:00:00Z', title:'Test Show Official', starts_at:'2026-11-01T02:00:00Z', ends_at:'2026-11-01T05:00:00Z', venue:{ venue_id:sourceVenue,name:'Test venue',city:'Las Vegas',country:'US' } }, map_context:{ event_id:source,publication_revision:revision,venue_id:sourceVenue,heat_event_id:event,heat_venue_id:venue,lat:36.1699,lng:-115.1398,timezone:'America/Los_Angeles',category:'music' } });
  const retract = revision => ({ event_id:source,source_product:'tourify',revision,status:'unpublished',updated_at:'2026-10-26T13:00:00Z' });
  return { source,event,venue,delivery,retract };
}
const viewport = () => queryViewport(pool, { north:37,south:35,east:-114,west:-116,windowStart:new Date('2026-11-01T00:00:00Z'),windowEnd:new Date('2026-11-02T00:00:00Z'),starredOnly:false,viewerUserId:null,limit:1000 });

test('transaction writes canonical HEAT row read by existing map/detail repositories', async () => {
  const f = await fixture();
  assert.equal((await inbox.apply(f.delivery(1))).state.readiness,'map-patch-ready');
  const detail = await fetchEventDetail(pool,f.event,null);
  assert.equal(detail.title,'Test Show Official'); assert.equal(detail.venueId,f.venue);
  assert.equal(Number(detail.lat),36.1699); assert.equal(Number(detail.lng),-115.1398);
  assert.equal((await viewport()).find(e=>e.id===f.event).title,'Test Show Official');
  const row = (await pool.query('SELECT normalized_title,stars_count,heat_score,heat_confidence FROM events WHERE id=$1',[f.event])).rows[0];
  assert.equal(row.normalized_title,normalizeTitle('Test Show Official'));
  assert.equal(row.stars_count,7); assert.equal(Number(row.heat_score),42); assert.equal(Number(row.heat_confidence),55);
  await inbox.apply(f.retract(2));
  assert.equal(await fetchEventDetail(pool,f.event,null),null);
  assert.equal((await viewport()).some(e=>e.id===f.event),false);
  assert.equal((await createPostgresInbox(pool,{normalizeTitle}).apply(f.delivery(1))).effect,'stale-ignored');
  assert.equal((await inbox.read(f.source)).publication,null);
  await inbox.apply(f.delivery(3)); assert.equal((await fetchEventDetail(pool,f.event,null)).title,'Test Show Official');
});
test('concurrent database deliveries retain highest revision and cancellation', async () => {
  const f=await fixture();
  await Promise.all([inbox.apply(f.retract(5)),inbox.apply(f.delivery(2)),inbox.apply(f.delivery(4))]);
  assert.equal((await inbox.read(f.source)).revision,5);
  assert.equal(await fetchEventDetail(pool,f.event,null),null);
});
test('unapproved source mapping cannot alter an event or advance inbox', async () => {
  const f=await fixture(); const m=f.delivery(1); m.map_context.heat_event_id=randomUUID();
  await assert.rejects(inbox.apply(m),err=>err.code==='UNAPPROVED_CANONICAL_MAPPING');
  assert.equal(await inbox.read(f.source),null);
  assert.equal((await fetchEventDetail(pool,f.event,null)).title,'Before');
});
test('external edits and moderation holds are preserved', async () => {
  const f=await fixture(); await inbox.apply(f.delivery(1));
  await pool.query("UPDATE events SET visibility_status='hidden',updated_at=clock_timestamp() WHERE id=$1",[f.event]);
  await assert.rejects(inbox.apply(f.delivery(2)),err=>err.code==='TARGET_CHANGED_OR_MODERATED');
  assert.equal((await inbox.read(f.source)).revision,1);
  assert.equal(await fetchEventDetail(pool,f.event,null),null);
});
test('database failure rolls back event, binding version and inbox together', async () => {
  const f=await fixture(); const m=f.delivery(1); m.map_context.category='festival';
  // The disposable DB deliberately has only music, so the target NOT NULL fails.
  await assert.rejects(inbox.apply(m),err=>err.code==='23502');
  assert.equal(await inbox.read(f.source),null);
  assert.equal((await fetchEventDetail(pool,f.event,null)).title,'Before');
  assert.equal((await inbox.apply(f.delivery(1))).effect,'published');
});
test('higher revision without spatial proof hides a previously mapped event', async () => {
  const f=await fixture(); await inbox.apply(f.delivery(1));
  await inbox.apply(f.delivery(2).publication);
  assert.equal(await fetchEventDetail(pool,f.event,null),null);
  assert.equal((await inbox.read(f.source)).readiness,'needs-spatial-enrichment');
});
