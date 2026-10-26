import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStagingInbox } from './store.mjs';
import { signedHeaders, verifyDelivery } from './transport.mjs';

const key = { id: 'synthetic', secret: 'test-only-key-0000000000000000000000000000' };
const id = '11111111-1111-4111-8111-111111111111';
const tombstone = revision => ({ event_id: id, revision, source_product: 'tourify', status: 'unpublished', updated_at: '2026-10-26T12:00:00Z' });
test('durable inbox retains highest revision across concurrent delivery and restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'heat-inbox-')); let inbox;
  try {
    inbox = await openStagingInbox(root);
    await assert.rejects(openStagingInbox(root), { code: 'EEXIST' });
    await Promise.all([inbox.apply(tombstone(4)), inbox.apply(tombstone(2)), inbox.apply(tombstone(3))]);
    await inbox.close(); inbox = await openStagingInbox(root);
    assert.equal((await inbox.read(id)).revision, 4);
    assert.equal((await inbox.apply(tombstone(4))).effect, 'duplicate-ignored');
    assert.equal((await inbox.apply(tombstone(1))).effect, 'stale-ignored');
    await assert.rejects(inbox.apply({ ...tombstone(5), event_id: '../escape' }), /UUID/);
    assert.equal((await inbox.apply(tombstone(5))).state.revision, 5);
  } finally { await inbox?.close(); await rm(root, { recursive: true, force: true }); }
});
test('HMAC validates exact bytes, current key and timestamp freshness', () => {
  const body = Buffer.from(JSON.stringify(tombstone(1))); const now = Date.now();
  const headers = signedHeaders(body, key, now);
  assert.doesNotThrow(() => verifyDelivery(body, headers, key, now));
  assert.throws(() => verifyDelivery(Buffer.from('{}'), headers, key, now), /UNAUTHORIZED/);
  assert.throws(() => verifyDelivery(body, headers, key, now + 600_000), /UNAUTHORIZED/);
  assert.throws(() => verifyDelivery(body, { ...headers, 'x-flow-key-id': 'revoked' }, key, now), /UNAUTHORIZED/);
});
