import { openStagingInbox } from './store.mjs';
import { createStagingReceiver } from './receiver.mjs';
import { validateKey } from './transport.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Staging bridge cannot run in production');
const key = { id: process.env.FLOW_BRIDGE_KEY_ID, secret: process.env.FLOW_BRIDGE_SECRET };
validateKey(key);
let inbox;
let pool;
if (process.env.FLOW_BRIDGE_STORAGE === 'postgres') {
  const connectionString = process.env.FLOW_BRIDGE_DATABASE_URL;
  if (!connectionString || !['127.0.0.1', 'localhost'].includes(new URL(connectionString).hostname)) throw new Error('Staging Postgres mode requires an explicit loopback database URL');
  const [{ default: pg }, { createPostgresInbox }, { normalizeTitle }] = await Promise.all([
    import('pg'), import('./postgres-inbox.mjs'), import('../../apps/api/src/lib/normalize.ts'),
  ]);
  pool = new pg.Pool({ connectionString });
  inbox = createPostgresInbox(pool, { normalizeTitle });
} else {
  if (process.env.FLOW_BRIDGE_STORAGE && process.env.FLOW_BRIDGE_STORAGE !== 'file') throw new Error('Unknown bridge storage');
  const directory = process.env.FLOW_BRIDGE_STATE_DIR;
  if (!directory) throw new Error('FLOW_BRIDGE_STATE_DIR required');
  inbox = await openStagingInbox(directory);
}
let receiver;
try {
  receiver = createStagingReceiver({ inbox, key, onError: value => console.error(JSON.stringify(value)) });
  const port = Number(process.env.FLOW_BRIDGE_PORT ?? 8790);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid bridge port');
  console.log(JSON.stringify({ mode: 'staging-only', url: await receiver.listen(port) }));
} catch (err) { await inbox.close(); await pool?.end(); throw err; }
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  try { await receiver.close(); } finally { await inbox.close(); await pool?.end(); }
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
