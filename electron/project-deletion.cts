import { DatabaseSync } from 'node:sqlite';
import { lstat, readdir, realpath, open, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PROJECT_APP_ID, PROJECT_VERSION } from './project-recovery.cjs';
import type { NativeSource } from './project-store.cjs';
import type { ExportRecord } from './export-contracts.js' with { 'resolution-mode': 'import' };
import type { ProjectDeletionPlan, RecentProject, ProjectInfo } from './project-contracts.js' with {
  'resolution-mode': 'import',
};

const key = (file: string) => path.resolve(file).toLowerCase();
const uuid = /^[a-f\d-]{36}$/i;
type Signature = { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number };
export type DeletionPlan = ProjectDeletionPlan & { signatures: Map<string, Signature> };

// Every ancestor is checked: never follow a directory junction during cleanup.
async function regular(file: string) {
  let directory = path.dirname(file);
  for (;;) {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error('Linked folders are retained.');
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    throw new Error('Linked or non-file entries are retained.');
  if (key(await realpath(file)) !== key(file)) throw new Error('Changed file location.');
  return {
    dev: info.dev,
    ino: info.ino,
    size: info.size,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs,
  };
}
function readProject(file: string, immutable = true) {
  const uri = pathToFileURL(file);
  uri.search = 'immutable=1';
  // Closed databases are immutable reads: SQLite must not create WAL/SHM files merely for a preview.
  const db = new DatabaseSync(immutable ? uri.href : file, { readOnly: true });
  try {
    if (
      db.prepare('PRAGMA application_id').get()?.application_id !== PROJECT_APP_ID ||
      ![1, 2, PROJECT_VERSION].includes(
        Number(db.prepare('PRAGMA user_version').get()?.user_version),
      )
    )
      throw new Error('Not a supported Virtual Cut project.');
    const data = JSON.parse(
      String(db.prepare('SELECT body FROM project WHERE id=1').get()?.body),
    ) as { project: ProjectInfo };
    if (!uuid.test(data.project?.id) || !path.isAbsolute(data.project.cache))
      throw new Error('Invalid project identity.');
    const sources = db
      .prepare('SELECT body FROM sources')
      .all()
      .map((r) => JSON.parse(String(r.body)) as NativeSource);
    const exports = db.prepare("SELECT name FROM sqlite_master WHERE name='exports'").get()
      ? db
          .prepare('SELECT body FROM exports')
          .all()
          .map((r) => JSON.parse(String(r.body)) as ExportRecord)
      : [];
    return { ...data, sources, exports };
  } finally {
    db.close();
  }
}

export async function planProjectDeletion(
  project: RecentProject,
  known: RecentProject[],
): Promise<DeletionPlan> {
  if (await lstat(project.file + '.lock').catch(() => null))
    throw new Error(
      'Close this project before deleting it. If its last session was interrupted, open and close it normally first.',
    );
  for (const suffix of ['-wal', '-shm'])
    if (await lstat(project.file + suffix).catch(() => null))
      throw new Error(
        'Open and close this project normally before deleting it so pending database files can settle.',
      );
  const signature = await regular(project.file);
  const data = readProject(project.file);
  if (data.project.id !== project.id)
    throw new Error('The project file changed. Open it again before deleting.');
  const plan: DeletionPlan = {
    token: randomUUID(),
    id: project.id,
    name: data.project.name,
    file: project.file,
    files: [],
    retained: [],
    retainedDetails: [],
    signatures: new Map(),
  };
  const retain = (file: string, group: string, reason: string) => {
    plan.retained.push(file);
    plan.retainedDetails.push({ path: file, group, reason });
  };
  const protectedFiles = new Set<string>();
  const protect = (p: ReturnType<typeof readProject>) => {
    for (const s of p.sources) if (typeof s.file === 'string') protectedFiles.add(key(s.file));
    for (const e of p.exports)
      for (const file of [e.output, e.metadata, e.input?.sourceFile])
        if (typeof file === 'string') protectedFiles.add(key(file));
  };
  protect(data);
  let sharedCache = false,
    unknownPeers = false;
  for (const peer of known) {
    if (key(peer.file) === key(project.file)) continue;
    protectedFiles.add(key(peer.file));
    try {
      const other = readProject(peer.file, !(await lstat(peer.file + '-wal').catch(() => null)));
      protect(other);
      if (key(other.project.cache) === key(data.project.cache)) sharedCache = true;
    } catch {
      unknownPeers = true;
    }
  }
  const candidates: { path: string; kind: 'save' | 'preview' }[] = [];
  const saves = project.file + '.saves';
  for (const entry of await readdir(saves, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(saves, entry.name);
    if (!/^(auto|manual|migration-v\d+-v\d+)-\d+-[a-f\d-]+\.vcut$/i.test(entry.name)) {
      retain(
        file,
        /\.(lock|vcut-(wal|shm))$/i.test(entry.name)
          ? 'Save support files'
          : 'Other save-folder files',
        'Not a recognized standalone save copy.',
      );
      continue;
    }
    try {
      await regular(file);
      for (const suffix of ['.lock', '-wal', '-shm'])
        if (await lstat(file + suffix).catch(() => null))
          throw new Error('Save copy is open or has pending database files.');
      const saved = readProject(file);
      if (saved.project.id !== project.id)
        throw new Error('This save belongs to a different project.');
      protect(saved);
      // Include previews of sources removed from the current project but retained in its saves.
      data.sources.push(...saved.sources);
      candidates.push({ path: file, kind: 'save' });
    } catch (e) {
      retain(
        file,
        'Save copies',
        e instanceof Error ? e.message : 'This save could not be verified.',
      );
    }
  }
  if (protectedFiles.has(key(project.file)))
    throw new Error(
      'This file is referenced as source media or an export. It will not be deleted.',
    );
  plan.files.push({ path: project.file, kind: 'project', bytes: signature.size });
  plan.signatures.set(project.file, signature);
  if (sharedCache || unknownPeers) {
    retain(
      `${data.project.cache} (shared cache or another recent project could not be checked)`,
      'Preview cache',
      'Shared cache or another recent project could not be checked.',
    );
  } else {
    const prefixes = [
      ...new Set(
        data.sources
          .filter((s) => uuid.test(s.id) && /^[a-f\d]{64}$/i.test(s.fingerprint))
          .map((s) => `${s.id}-${s.fingerprint}`),
      ),
    ];
    const suffix =
      /^-(?:frame-[0-7](?:\.partial)?\.jpg|audio-\d+(?:-[a-f\d-]{36})?(?:\.partial)?\.(?:m4a|f32)|asr-[a-f\d-]{36}\.partial\.wav)$/i;
    for (const entry of await readdir(data.project.cache, { withFileTypes: true }).catch(
      () => [],
    )) {
      const file = path.join(data.project.cache, entry.name);
      if (
        prefixes.some(
          (prefix) => entry.name.startsWith(prefix) && suffix.test(entry.name.slice(prefix.length)),
        )
      )
        candidates.push({ path: file, kind: 'preview' });
      else retain(file, 'Other cache files', 'Not a verified disposable preview for this project.');
    }
  }
  for (const candidate of candidates) {
    try {
      if (protectedFiles.has(key(candidate.path)))
        throw new Error('Referenced source footage or completed output.');
      const info = await regular(candidate.path);
      plan.files.push({ ...candidate, bytes: info.size });
      plan.signatures.set(candidate.path, info);
    } catch (e) {
      retain(
        candidate.path,
        candidate.kind === 'save' ? 'Save copies' : 'Previews',
        e instanceof Error ? e.message : 'File could not be verified.',
      );
    }
  }
  return plan;
}

export async function executeProjectDeletion(plan: DeletionPlan, cleanup: boolean) {
  const lock = await open(plan.file + '.lock', 'wx').catch(() => {
    throw new Error('The project is now open. Close it and check deletion again.');
  });
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  await lock.close();
  try {
    // Validate every selected leaf before deleting any. Changed files require a fresh preview.
    const files = plan.files.filter((f) => cleanup || f.kind === 'project');
    for (const f of files)
      if (JSON.stringify(await regular(f.path)) !== JSON.stringify(plan.signatures.get(f.path)))
        throw new Error('Files changed after the deletion preview. Check deletion again.');
    // Remove the project last so a partial cleanup can be inspected and retried.
    let removed = 0;
    for (const f of [
      ...files.filter((f) => f.kind !== 'project'),
      ...files.filter((f) => f.kind === 'project'),
    ]) {
      if (JSON.stringify(await regular(f.path)) !== JSON.stringify(plan.signatures.get(f.path)))
        throw new Error(
          'A file changed during cleanup. Remaining files were retained. Check deletion again.',
        );
      await unlink(f.path);
      removed++;
    }
    if (cleanup) await rmdir(plan.file + '.saves').catch(() => {}); // Empty only; never recursive.
    return { removed, bytes: files.reduce((sum, f) => sum + f.bytes, 0), retained: plan.retained };
  } finally {
    await unlink(plan.file + '.lock');
  }
}
