import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { ResolveHelperStatus } from './project-contracts.js';
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
async function regularFile(file: string) {
  const info = await lstat(file).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null;
    throw e;
  });
  if (info && (!info.isFile() || info.isSymbolicLink()))
    throw new Error('Preserve the existing helper link or directory before changing it.');
  return info ? readFile(file) : null;
}
async function checkDirectory(directory: string) {
  const info = await lstat(directory).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null;
    throw e;
  });
  if (info && (!info.isDirectory() || info.isSymbolicLink()))
    throw new Error(
      'The Resolve Utility folder is a link or is not a regular directory. Preserve it before changing the helper.',
    );
}
function paths(directory: string) {
  const file = path.join(directory, 'Virtual Cut metadata.py');
  return { file, manifest: file + '.vcut-install.json' };
}
async function ownedHash(manifest: string) {
  const content = await regularFile(manifest);
  try {
    const value = JSON.parse(content?.toString('utf8') || '{}');
    return typeof value.sha256 === 'string' ? value.sha256 : undefined;
  } catch {
    return undefined;
  }
}
export async function resolveHelperStatus(
  bundledFile: string,
  scriptsDirectory: string,
): Promise<ResolveHelperStatus> {
  const { file, manifest } = paths(scriptsDirectory);
  await checkDirectory(scriptsDirectory);
  const content = await regularFile(file);
  if (!content) return { state: 'missing', file };
  const bundled = await readFile(bundledFile),
    owned = await ownedHash(manifest);
  return {
    file,
    state:
      owned === hash(content)
        ? content.equals(bundled)
          ? 'installed'
          : 'outdated'
        : content.equals(bundled)
          ? 'unmanaged'
          : 'customized',
  };
}
/** Explicit user action: remove only a byte-identical app-owned script and its manifest. */
export async function removeResolveHelper(bundledFile: string, scriptsDirectory: string) {
  const status = await resolveHelperStatus(bundledFile, scriptsDirectory);
  if (status.state === 'missing') return status;
  if (!['installed', 'outdated'].includes(status.state))
    throw new Error(
      'The existing Resolve helper was changed or is not app-owned. It has been preserved.',
    );
  const { file, manifest } = paths(scriptsDirectory);
  const content = await regularFile(file);
  if (!content || (await ownedHash(manifest)) !== hash(content))
    throw new Error('The helper changed during removal. It has been preserved.');
  await unlink(file);
  await unlink(manifest);
  return { state: 'missing' as const, file };
}
/** Called only with a bundled script and the native user's Resolve Scripts folder. */
export async function installResolveHelper(bundledFile: string, scriptsDirectory: string) {
  const content = await readFile(bundledFile);
  const file = path.join(scriptsDirectory, 'Virtual Cut metadata.py'),
    manifest = file + '.vcut-install.json';
  await checkDirectory(scriptsDirectory);
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
  if (old?.equals(content)) {
    // Explicit installation can register an identical bundled helper already present.
    await writeFile(manifest, JSON.stringify({ sha256: hash(content) }));
    return file;
  }
  if (old) {
    if ((await ownedHash(manifest)) !== hash(old))
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
