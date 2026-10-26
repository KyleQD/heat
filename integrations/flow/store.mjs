/** Single-process staging inbox. For production use a transactional DB inbox. */
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectPublication } from './publication.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function openStagingInbox(directory) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Fail rather than permit two processes to overwrite each other's revisions.
  const leasePath = join(root, '.writer-lock');
  const lease = await open(leasePath, 'wx', 0o600);
  let tail = Promise.resolve();
  let closed = false;
  const file = id => {
    if (typeof id !== 'string' || !uuid.test(id)) throw new TypeError('Invalid event UUID');
    return join(root, id.toLowerCase() + '.json');
  };
  const read = async id => {
    try { return JSON.parse(await readFile(file(id), 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  };
  return {
    read,
    apply(message) {
      if (closed) return Promise.reject(new Error('Inbox closed'));
      const snapshot = structuredClone(message);
      const task = tail.then(async () => {
        const destination = file(snapshot.event_id);
        const current = await read(snapshot.event_id);
        const result = projectPublication(current, snapshot);
        if (result.effect.endsWith('ignored')) return result;
        const temporary = join(root, '.pending-' + randomUUID());
        try {
          const handle = await open(temporary, 'wx', 0o600);
          try { await handle.writeFile(JSON.stringify(result.state)); await handle.sync(); }
          finally { await handle.close(); }
          await rename(temporary, destination);
          const dir = await open(root, 'r');
          try { await dir.sync(); } finally { await dir.close(); }
        } finally { await rm(temporary, { force: true }); }
        return result;
      });
      tail = task.catch(() => {});
      return task;
    },
    async close() {
      if (closed) return;
      closed = true;
      await tail;
      await lease.close();
      await rm(leasePath);
    },
  };
}
