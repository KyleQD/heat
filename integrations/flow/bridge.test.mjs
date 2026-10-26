import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStagingInbox } from './store.mjs';
import { createStagingReceiver } from './receiver.mjs';
import { deliverPublication } from './sender.mjs';
import { signedHeaders, INGEST_PATH, MAX_BYTES } from './transport.mjs';

// Synthetic key is test-only; no operational credentials are created.
const key = { id: 'synthetic', secret: 'test-only-key-0000000000000000000000000000' };
const eventId = '11111111-1111-4111-8111-111111111111';
const message = (revision = 1, status = 'public') => ({
  event_id: eventId, source_product: 'tourify', revision, status, updated_at: '2026-10-26T12:00:00Z',
  ...(status === 'public' ? { title: 'Synthetic show', starts_at: '2026-11-01T02:00:00Z', ends_at: '2026-11-01T05:00:00Z', venue: { venue_id: '22222222-2222-4222-8222-222222222222', name: 'Test venue', city: 'Las Vegas', country: 'US' } } : {}),
});
async function harness(t) {
  const root = await mkdtemp(join(tmpdir(), 'heat-flow-test-'));
  let inbox = await openStagingInbox(root);
  let receiver = createStagingReceiver({ inbox, key });
  t.after(async () => { await receiver.close(); await inbox.close(); await rm(root, { recursive: true, force: true }); });
  let url = await receiver.listen();
  return {
    root, get inbox() { return inbox; }, get url() { return url; },
    send: publication => deliverPublication({ baseUrl: url, key, publication }),
    async restart() {
      await receiver.close(); await inbox.close();
      inbox = await openStagingInbox(root); receiver = createStagingReceiver({ inbox, key }); url = await receiver.listen();
    },
  };
}
async function raw(url, body, headers) {
  return fetch(url + INGEST_PATH, { method: 'POST', headers: headers ?? signedHeaders(body, key), body });
}

test('signed HTTP -> durable inbox -> restart -> update -> retraction -> stale replay', async t => {
  const h = await harness(t);
  assert.equal((await h.send(message())).effect, 'published');
  assert.equal((await h.send(message())).effect, 'duplicate-ignored');
  await h.restart();
  assert.equal((await h.send(message())).effect, 'duplicate-ignored');
  assert.equal((await h.send({ ...message(2), title: 'Updated show' })).revision, 2);
  assert.equal((await h.inbox.read(eventId)).publication.title, 'Updated show');
  assert.equal((await h.send(message(3, 'unpublished'))).effect, 'retracted');
  await h.restart();
  assert.equal((await h.send(message(2))).effect, 'stale-ignored');
  assert.equal((await h.inbox.read(eventId)).publication, null);
});
test('HTTP rejects missing signature, wrong key, modified body and expired signature', async t => {
  const h = await harness(t); const body = Buffer.from(JSON.stringify(message()));
  const cases = [ { 'content-type': 'application/json' }, signedHeaders(body, { ...key, id: 'wrong' }), signedHeaders(body, { ...key, secret: key.secret + 'wrong' }), signedHeaders(body, key, Date.now() - 600_000) ];
  for (const headers of cases) assert.equal((await raw(h.url, body, headers)).status, 401);
  assert.equal((await raw(h.url, Buffer.from(JSON.stringify({ ...message(), title: 'tampered' })), signedHeaders(body, key))).status, 401);
  assert.equal(await h.inbox.read(eventId), null);
});
test('HTTP rejects private fields, malformed JSON, invalid media type and oversized body', async t => {
  const h = await harness(t);
  for (const [body, status] of [[JSON.stringify({ ...message(), private_email: 'private@example.com' }), 400], ['{', 400], ['x'.repeat(MAX_BYTES + 1), 413]]) {
    const bytes = Buffer.from(body); assert.equal((await raw(h.url, bytes)).status, status);
  }
  const body = Buffer.from(JSON.stringify(message()));
  assert.equal((await raw(h.url, body, { ...signedHeaders(body, key), 'content-type': 'text/plain' })).status, 415);
  assert.equal(await h.inbox.read(eventId), null);
});
test('HTTP exposes conflict as non-retryable 409 and preserves original', async t => {
  const h = await harness(t); await h.send(message());
  await assert.rejects(h.send({ ...message(), title: 'conflict' }), err => err.status === 409 && err.retryable === false);
  assert.equal((await h.inbox.read(eventId)).publication.title, 'Synthetic show');
});
test('concurrent reverse-order deliveries keep highest revision', async t => {
  const h = await harness(t);
  await Promise.all([h.send(message(5, 'canceled')), h.send(message(2)), h.send(message(4)), h.send(message(1))]);
  assert.equal((await h.inbox.read(eventId)).revision, 5);
  assert.equal((await h.inbox.read(eventId)).published, false);
});
test('single writer lease refuses another process/store; orderly shutdown releases it', async t => {
  const h = await harness(t);
  await assert.rejects(openStagingInbox(h.root), { code: 'EEXIST' });
  await h.restart();
  assert.equal((await h.send(message())).effect, 'published');
});
test('corrupt persisted state fails closed rather than replacing history', async t => {
  const h = await harness(t);
  await writeFile(join(h.root, eventId + '.json'), 'corrupted');
  await assert.rejects(h.send(message()), err => err.status === 500 && err.retryable === true);
});
test('sender rejects unencrypted non-loopback destinations and validates before network', async () => {
  for (const baseUrl of ['http://example.com', 'http://localhost:8790', 'https://user:password@example.com']) {
    await assert.rejects(deliverPublication({ baseUrl, key, publication: message(), fetchImpl: () => { throw new Error('network must not run'); } }), /HTTPS or loopback/);
  }
  await assert.rejects(deliverPublication({ baseUrl: 'https://example.com', key, publication: { ...message(), crew: [] }, fetchImpl: () => { throw new Error('network must not run'); } }), /Unexpected/);
});
test('sender treats server outage as retryable and blocks redirects', async () => {
  await assert.rejects(deliverPublication({ baseUrl: 'https://example.com', key, publication: message(), fetchImpl: async (url, options) => {
    assert.equal(options.redirect, 'error'); assert.equal(new URL(url).pathname, INGEST_PATH);
    return { ok: false, status: 503 };
  } }), err => err.status === 503 && err.retryable === true);
});
