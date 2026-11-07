import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
export async function openStore(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'database.json');
  let data;
  try { data = JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; data = { devices: [], logs: [], deliveries: [] }; }
  let queue = Promise.resolve();
  return {
    read: () => structuredClone(data),
    update(fn) {
      const task = queue.then(async () => {
        const next = structuredClone(data);
        const result = fn(next);
        await writeFile(path + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
        await rename(path + '.tmp', path);
        data = next;
        return result;
      });
      queue = task.catch(() => {});
      return task;
    },
  };
}
