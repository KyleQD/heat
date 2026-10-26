import { createHmac, timingSafeEqual } from 'node:crypto';

export const INGEST_PATH = '/internal/flow/event-publications';
export const MAX_BYTES = 32 * 1024;
export class BridgeError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
export function validateKey(key) {
  if (!key || !/^[a-z0-9-]{1,40}$/.test(key.id) || typeof key.secret !== 'string' || Buffer.byteLength(key.secret) < 32) throw new Error('Bridge key configuration invalid');
}
const mac = (secret, timestamp, body) => createHmac('sha256', secret).update(`${timestamp}.POST.${INGEST_PATH}.`).update(body).digest('hex');
export function signedHeaders(body, key, now = Date.now()) {
  validateKey(key);
  const timestamp = String(Math.floor(now / 1000));
  return { 'content-type': 'application/json', 'x-flow-key-id': key.id, 'x-flow-timestamp': timestamp, 'x-flow-signature': mac(key.secret, timestamp, body) };
}
export function verifyDelivery(body, headers, key, now = Date.now()) {
  validateKey(key);
  if (body.length > MAX_BYTES) throw new BridgeError('PAYLOAD_TOO_LARGE', 413);
  const timestamp = headers['x-flow-timestamp'];
  const signature = headers['x-flow-signature'];
  if (headers['x-flow-key-id'] !== key.id || typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) throw new BridgeError('UNAUTHORIZED_DELIVERY', 401);
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(mac(key.secret, timestamp, body), 'hex'))) throw new BridgeError('UNAUTHORIZED_DELIVERY', 401);
}
