import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationEligibility } from './source-policy.mjs';

test('each source requires an explicit public signal and publishable lifecycle', () => {
  for (const table of ['events', 'artist_events', 'events_v2']) {
    const status = table === 'events_v2' ? 'confirmed' : 'published';
    assert.equal(publicationEligibility(table, { status }).reason, 'publication-consent-missing');
    assert.equal(publicationEligibility(table, { status, visibility: 'public' }).eligible, true);
    assert.equal(publicationEligibility(table, { status: 'draft', visibility: 'public' }).eligible, false);
  }
});
test('private/unlisted and contradictory settings always prevent export', () => {
  for (const visibility of ['private', 'unlisted', 'unknown']) {
    assert.equal(publicationEligibility('artist_events', { status: 'published', visibility, is_public: true }).eligible, false);
    assert.equal(publicationEligibility('events_v2', { status: 'confirmed', visibility: 'public', settings: { visibility } }).eligible, false);
  }
  assert.equal(publicationEligibility('events', { status: 'published', visibility: 'public', producer_settings: { is_public: false } }).eligible, false);
});
test('invalid source metadata fails closed and unknown source tables are rejected', () => {
  for (const settings of ['public', [], 1]) assert.equal(publicationEligibility('events_v2', { status: 'confirmed', settings, is_public: true }).eligible, false);
  assert.equal(publicationEligibility('events', null).eligible, false);
  assert.throws(() => publicationEligibility('crew', {}), /Unknown/);
  assert.equal(publicationEligibility('events', { status: 'published', is_public: 'true' }).eligible, false);
});
test('canceled records are not new public publications and need outbox retraction', () => {
  for (const status of ['canceled', 'cancelled', 'deleted']) assert.equal(publicationEligibility('events', { status, visibility: 'public' }).eligible, false);
});
