import { openStagingInbox } from './store.mjs';
import { createStagingReceiver } from './receiver.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Staging bridge cannot run in production');
const directory = process.env.FLOW_BRIDGE_STATE_DIR;
if (!directory) throw new Error('FLOW_BRIDGE_STATE_DIR required');
const key = { id: process.env.FLOW_BRIDGE_KEY_ID, secret: process.env.FLOW_BRIDGE_SECRET };
const inbox = await openStagingInbox(directory);
let receiver;
try {
  receiver = createStagingReceiver({ inbox, key, onError: value => console.error(JSON.stringify(value)) });
  const port = Number(process.env.FLOW_BRIDGE_PORT ?? 8790);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid bridge port');
  console.log(JSON.stringify({ mode: 'staging-only', url: await receiver.listen(port) }));
} catch (err) { await inbox.close(); throw err; }
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  try { await receiver.close(); } finally { await inbox.close(); }
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
