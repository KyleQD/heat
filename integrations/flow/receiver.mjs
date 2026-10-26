import { createServer } from 'node:http';
import { INGEST_PATH, MAX_BYTES, BridgeError, validateKey, verifyDelivery } from './transport.mjs';

/** A staging-only loopback receiver. Never attach this to a public listener. */
export function createStagingReceiver({ inbox, key, now = Date.now, onError = () => {} }) {
  validateKey(key);
  const server = createServer(async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.method === 'GET' && req.url === '/health') return send(200, { status: 'ok', mode: 'staging-only' });
      if (req.method !== 'POST' || req.url !== INGEST_PATH) return send(404, { error: 'NOT_FOUND' });
      if (req.headers['content-type'] !== 'application/json') throw new BridgeError('JSON_REQUIRED', 415);
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > MAX_BYTES) throw new BridgeError('PAYLOAD_TOO_LARGE', 413);
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      verifyDelivery(body, req.headers, key, now());
      let message;
      try { message = JSON.parse(body.toString('utf8')); }
      catch { throw new BridgeError('INVALID_JSON', 400); }
      let result;
      try { result = await inbox.apply(message); }
      catch (err) {
        if (err instanceof TypeError) throw new BridgeError('INVALID_PUBLICATION', 400);
        if (err.message === 'Conflicting event revision' || err.message === 'Conflicting canonical mapping') throw new BridgeError('REVISION_CONFLICT', 409);
        throw err;
      }
      return send(200, { effect: result.effect, revision: result.state.revision, published: result.state.published, readiness: result.state.readiness });
    } catch (err) {
      if (!(err instanceof BridgeError)) onError({ code: 'INBOX_WRITE_FAILED' });
      return send(err instanceof BridgeError ? err.status : 500, { error: err instanceof BridgeError ? err.code : 'INTERNAL_ERROR' });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  return {
    async listen(port = 0) {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      if (!server.listening) return;
      server.closeIdleConnections();
      await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    },
  };
}
