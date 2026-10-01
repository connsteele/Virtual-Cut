import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
/** Called only with a bundled script and the native user's Resolve Scripts folder. */
export async function installResolveHelper(bundledFile: string, scriptsDirectory: string) {
  const content = await readFile(bundledFile);
  const file = path.join(scriptsDirectory, 'Virtual Cut metadata.py'),
    manifest = file + '.vcut-install.json';
  await mkdir(scriptsDirectory, { recursive: true });
  for (const target of [file, manifest]) {
    const info = await lstat(target).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (info && (!info.isFile() || info.isSymbolicLink()))
      throw new Error('Preserve the existing helper link or directory before installing.');
  }
  const old = await readFile(file).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null;
    throw e;
  });
  if (old?.equals(content)) return file;
  if (old) {
    const owned = JSON.parse(await readFile(manifest, 'utf8').catch(() => '{}'));
    if (owned.sha256 !== hash(old))
      throw new Error(
        'The existing Resolve helper was changed or is not app-owned. Preserve it and choose a different script name before installing.',
      );
    await writeFile(file + '.previous-' + Date.now(), old, { flag: 'wx' });
  }
  const temporary = file + '.partial-' + randomUUID();
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    if (old) await rename(temporary, file);
    else {
      // Exclusive create prevents replacing a script installed after our check.
      await writeFile(file, content, { flag: 'wx' });
    }
    await writeFile(manifest, JSON.stringify({ sha256: hash(content) }));
    return file;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
