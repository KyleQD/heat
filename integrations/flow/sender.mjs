import { INGEST_PATH, MAX_BYTES, signedHeaders } from './transport.mjs';
import { decodeDelivery } from './map-context.mjs';

/** Send an already-authorized public projection; never accepts raw DB rows. */
export async function deliverPublication({ baseUrl, publication, mapContext, key, fetchImpl = fetch, now = Date.now() }) {
  const delivery = mapContext === undefined ? publication : { bridge_version: 'heat-staging/1', publication, map_context: mapContext };
  decodeDelivery(delivery);
  const target = new URL(INGEST_PATH, baseUrl);
  if (target.username || target.password || target.search || target.hash || (target.protocol !== 'https:' && !(target.protocol === 'http:' && target.hostname === '127.0.0.1'))) throw new Error('HTTPS or loopback staging URL required');
  const body = Buffer.from(JSON.stringify(delivery));
  if (body.length > MAX_BYTES) throw new Error('Publication exceeds delivery limit');
  const response = await fetchImpl(target, { method: 'POST', redirect: 'error', headers: signedHeaders(body, key, now), body, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const error = new Error('FLOW_DELIVERY_FAILED');
    error.status = response.status;
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  return response.json();
}
