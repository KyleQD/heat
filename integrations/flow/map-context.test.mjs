import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { decodeDelivery, projectDelivery, heatEventMutation } from './map-context.mjs';
import { openStagingInbox } from './store.mjs';

const eventId = '11111111-1111-4111-8111-111111111111';
const venueId = '22222222-2222-4222-8222-222222222222';
const heatEventId = '33333333-3333-4333-8333-333333333333';
const heatVenueId = '44444444-4444-4444-8444-444444444444';
export const spatialDelivery = (revision = 1) => ({
  bridge_version: 'heat-staging/1',
  publication: { event_id: eventId, source_product: 'tourify', revision, status: 'public', updated_at: '2026-10-26T12:00:00Z', title: 'Synthetic show', starts_at: '2026-11-01T02:00:00Z', ends_at: '2026-11-01T05:00:00Z', venue: { venue_id: venueId, name: 'Test venue', city: 'Las Vegas', country: 'US' } },
  map_context: { event_id: eventId, publication_revision: revision, venue_id: venueId, heat_event_id: heatEventId, heat_venue_id: heatVenueId, lat: 36.1699, lng: -115.1398, timezone: 'America/Los_Angeles', category: 'music' },
});
const withdrawal = revision => ({ event_id: eventId, revision, source_product: 'tourify', status: 'unpublished', updated_at: '2026-10-26T13:00:00Z' });
test('mapped projection prepares HEAT fields using local canonical IDs', () => {
  const state = projectDelivery(null, spatialDelivery()).state;
  const mutation = heatEventMutation(state);
  assert.equal(state.readiness, 'map-patch-ready');
  assert.equal(mutation.event.id, heatEventId); assert.equal(mutation.event.venue_id, heatVenueId);
  assert.equal(mutation.event.lng, -115.1398); assert.equal(mutation.event.timezone, 'America/Los_Angeles');
  assert.equal(Object.hasOwn(mutation.event, 'source_ref'), false);
  assert.equal(Object.hasOwn(mutation.event, 'heat_score'), false);
  assert.equal(Object.hasOwn(mutation.event, 'stars_count'), false);
});
test('missing spatial context never fabricates map fields', () => {
  const state = projectDelivery(null, spatialDelivery().publication).state;
  assert.equal(state.readiness, 'needs-spatial-enrichment'); assert.equal(heatEventMutation(state), null);
});
test('spatial data must bind to exact event, venue and publication revision', () => {
  for (const patch of [{ event_id: heatEventId }, { venue_id: heatVenueId }, { publication_revision: 2 }]) {
    const m = spatialDelivery(); Object.assign(m.map_context, patch); assert.throws(() => decodeDelivery(m), /bound/);
  }
});
test('invalid coordinates, timezone, category and extra private fields fail closed', () => {
  for (const patch of [{ lat: 91 }, { lng: -181 }, { lat: NaN }, { lat: '36' }, { timezone: 'Vegas' }, { category: 'made-up' }, { email: 'private@example.com' }]) {
    const m = spatialDelivery(); Object.assign(m.map_context, patch); assert.throws(() => decodeDelivery(m));
  }
  const m = spatialDelivery(); m.private_notes = 'private'; assert.throws(() => decodeDelivery(m));
});
test('reordered context is idempotent but same-revision coordinate changes conflict', () => {
  const current = projectDelivery(null, spatialDelivery()).state;
  const m = spatialDelivery(); m.map_context = Object.fromEntries(Object.entries(m.map_context).reverse());
  assert.equal(projectDelivery(current, m).effect, 'duplicate-ignored');
  m.map_context.lat = 36.2; assert.throws(() => projectDelivery(current, m), /Conflicting/);
  assert.throws(() => projectDelivery(current, m.publication), /Conflicting/);
});
test('higher revisions update coordinates while canonical event identity remains stable', () => {
  const current = projectDelivery(null, spatialDelivery()).state;
  const m = spatialDelivery(2); m.map_context.lat = 36.2;
  const next = projectDelivery(current, m).state;
  assert.equal(heatEventMutation(next).event.lat, 36.2);
  assert.equal(heatEventMutation(next).event.id, heatEventId);
  m.map_context.heat_event_id = venueId; assert.throws(() => projectDelivery(current, m), /canonical mapping/);
  m.map_context.heat_event_id = heatEventId; m.map_context.heat_venue_id = eventId;
  assert.throws(() => projectDelivery(current, m), /canonical mapping/);
});
test('withdrawal clears spatial content and prepares hiding mapped canonical event', () => {
  const current = projectDelivery(null, spatialDelivery()).state;
  const next = projectDelivery(current, withdrawal(2)).state;
  assert.equal(next.map_context, null); assert.equal(next.publication, null);
  assert.deepEqual(heatEventMutation(next), { action: 'hide', id: heatEventId, visibility_status: 'hidden' });
  assert.equal(projectDelivery(next, spatialDelivery()).effect, 'stale-ignored');
  assert.equal(heatEventMutation(projectDelivery(null, withdrawal(2)).state), null);
});
test('withdrawals cannot carry coordinates and removing context requires higher revision', () => {
  const current = projectDelivery(null, spatialDelivery()).state;
  const invalid = spatialDelivery(2); invalid.publication = withdrawal(2);
  assert.throws(() => decodeDelivery(invalid), /Withdrawals/);
  const next = projectDelivery(current, spatialDelivery(2).publication).state;
  assert.equal(next.map_context, null); assert.equal(heatEventMutation(next).action, 'hide');
});
test('durable mapped state and withdrawal survive orderly restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'heat-spatial-')); let inbox;
  try {
    inbox = await openStagingInbox(root); await inbox.apply(spatialDelivery());
    await inbox.close(); inbox = await openStagingInbox(root);
    assert.equal(heatEventMutation(await inbox.read(eventId)).event.id, heatEventId);
    await inbox.apply(withdrawal(2)); await inbox.close(); inbox = await openStagingInbox(root);
    assert.equal(heatEventMutation(await inbox.read(eventId)).action, 'hide');
    assert.equal((await inbox.apply(spatialDelivery())).effect, 'stale-ignored');
  } finally { await inbox?.close(); await rm(root, { recursive: true, force: true }); }
});
