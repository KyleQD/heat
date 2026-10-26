import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPublication, publicPublication } from './publication.mjs';

const message = () => ({
  event_id: '11111111-1111-4111-8111-111111111111', source_product: 'tourify',
  revision: 1, status: 'public', updated_at: '2026-10-26T12:00:00Z',
  title: 'Synthetic Las Vegas event', starts_at: '2026-11-01T02:00:00Z', ends_at: '2026-11-01T05:00:00Z',
  venue: { venue_id: '22222222-2222-4222-8222-222222222222', name: 'Test venue', city: 'Las Vegas', country: 'US' },
  public_url: 'https://example.com/events/test',
});
const initial = () => projectPublication(null, message()).state;
const retract = status => ({ event_id: message().event_id, source_product: 'tourify', revision: 2, status, updated_at: '2026-10-26T13:00:00Z' });

test('public projection preserves source identity and requires spatial enrichment', () => {
  const state = initial();
  assert.equal(state.source_ref, 'tourify:event:' + message().event_id);
  assert.equal(state.readiness, 'needs-spatial-enrichment');
  assert.deepEqual(publicPublication(state), message());
});
test('replay with reordered object keys is idempotent', () => {
  const m = message(); m.venue = Object.fromEntries(Object.entries(m.venue).reverse());
  assert.equal(projectPublication(initial(), Object.fromEntries(Object.entries(m).reverse())).effect, 'duplicate-ignored');
});
test('same revision with changed content conflicts', () => {
  assert.throws(() => projectPublication(initial(), { ...message(), title: 'Changed' }), /Conflicting/);
});
test('higher revision updates public content', () => {
  const state = projectPublication(initial(), { ...message(), revision: 2, title: 'Updated' }).state;
  assert.equal(publicPublication(state).title, 'Updated');
});
for (const status of ['unpublished', 'canceled']) test(status + ' retracts and prevents stale resurrection', () => {
  const state = projectPublication(initial(), retract(status)).state;
  assert.equal(publicPublication(state), null);
  assert.equal(state.publication, null);
  assert.equal(projectPublication(state, message()).effect, 'stale-ignored');
  assert.equal(projectPublication(state, retract(status)).effect, 'duplicate-ignored');
});
test('retraction received before publication still blocks stale delivery', () => {
  const state = projectPublication(null, retract('unpublished')).state;
  assert.equal(projectPublication(state, message()).state.published, false);
});
test('private fields are rejected at top level and inside venue', () => {
  assert.throws(() => projectPublication(null, { ...message(), crew: ['private'] }), /Unexpected/);
  const m = message(); m.venue.email = 'private@example.com';
  assert.throws(() => projectPublication(null, m), /Unexpected/);
});
test('invalid identity, source, revision, status and schedule fail closed', () => {
  for (const patch of [{ event_id: 'bad' }, { source_product: 'heat' }, { revision: 0 }, { status: 'draft' }, { ends_at: message().starts_at }, { title: '' }, { starts_at: 'bad' }]) {
    assert.throws(() => projectPublication(null, { ...message(), ...patch }));
  }
  assert.throws(() => projectPublication(initial(), { ...message(), event_id: '33333333-3333-4333-8333-333333333333' }), /identity/);
});
test('publications require complete content but tombstones do not', () => {
  const m = message(); delete m.venue;
  assert.throws(() => projectPublication(null, m), /missing venue/);
  assert.equal(projectPublication(null, retract('canceled')).state.published, false);
});
test('unsafe public URLs fail closed', () => {
  for (const url of ['http://example.com', 'javascript:alert(1)', 'https://user:password@example.com']) assert.throws(() => projectPublication(null, { ...message(), public_url: url }));
});
test('input and public output mutations cannot change stored projection', () => {
  const m = message(); const state = projectPublication(null, m).state;
  m.venue.name = 'Mutated'; const view = publicPublication(state); view.venue.name = 'Also mutated';
  assert.equal(publicPublication(state).venue.name, 'Test venue');
});
