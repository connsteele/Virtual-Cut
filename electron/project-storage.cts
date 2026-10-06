import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { NativeSource } from './project-store.cjs';
import type { ExportRecord } from './export-contracts.js' with { 'resolution-mode': 'import' };
import type { ProjectInfo, ProjectStorageUsage } from './project-contracts.js' with {
  'resolution-mode': 'import',
};

/** File sizes only. Never hashes media, opens databases, saves edits or walks media folders. */
export async function projectStorageUsage(
  project: ProjectInfo,
  sources: NativeSource[],
  exports: ExportRecord[],
): Promise<ProjectStorageUsage> {
  const labels = {
    project: 'Project and working database',
    auto: 'Automatic saves',
    manual: 'Manual saves',
    migration: 'Before-upgrade saves',
    saveOther: 'Other save-folder files',
    images: 'Thumbnails and filmstrips',
    audio: 'Audio previews',
    cacheOther: 'Other cache files',
    exports: 'Completed videos',
    companions: 'Companion metadata',
    sources: 'Source footage (referenced)',
  };
  type Kind = keyof typeof labels;
  const rows = Object.fromEntries(
    Object.entries(labels).map(([id, label]) => [
      id,
      { id, label, files: 0, bytes: 0, unavailable: 0 },
    ]),
  ) as Record<Kind, ProjectStorageUsage['rows'][number]>;
  const issues: string[] = [],
    seenPaths = new Set<string>(),
    seenFiles = new Set<string>();
  const candidates: { file: string; kind: Kind; optional?: boolean }[] = [];
  const add = (file: string | undefined, kind: Kind, optional = false) => {
    if (!file || !path.isAbsolute(file)) return;
    const key = path.resolve(file).toLowerCase();
    if (seenPaths.has(key)) return;
    seenPaths.add(key);
    candidates.push({ file, kind, optional });
  };
  // Referenced originals and delivered media take priority even if placed in a cache folder.
  sources.forEach((s) => add(s.file, 'sources'));
  exports
    .filter((e) => e.state === 'verified')
    .forEach((e) => {
      add(e.output, 'exports');
      add(e.metadata, 'companions');
      for (const w of e.subtitles?.written || []) add(w.file, 'companions');
    });
  add(project.file, 'project');
  for (const suffix of ['-wal', '-shm', '.lock']) add(project.file + suffix, 'project', true);
  async function folder(directory: string, kind: (name: string) => Kind, optional = false) {
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        issues.push(`${directory}: linked or non-folder location was not scanned.`);
        return;
      }
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          issues.push(
            `${path.join(directory, entry.name)}: nested or linked entry was not scanned.`,
          );
          continue;
        }
        add(path.join(directory, entry.name), kind(entry.name));
      }
    } catch (e) {
      if (
        optional &&
        (e as NodeJS.ErrnoException).code === 'ENOENT' &&
        (await stat(path.dirname(directory)).catch(() => null))
      )
        return;
      issues.push(`${directory}: unavailable; folder sizes are incomplete.`);
    }
  }
  await folder(
    project.file + '.saves',
    (name) => {
      const match = /^(auto|manual|migration-v\d+-v\d+)-\d+-[a-f\d-]+\.vcut$/i.exec(name);
      return !match
        ? 'saveOther'
        : match[1].startsWith('migration')
          ? 'migration'
          : (match[1].toLowerCase() as 'auto' | 'manual');
    },
    true,
  );
  await folder(project.cache, (name) =>
    /-(?:frame-\d+(?:\.partial)?\.jpg|filmstrip(?:\.partial)?\.bin)$/i.test(name)
      ? 'images'
      : /-audio-\d+(?:-[a-f\d-]{36})?(?:\.partial)?\.(m4a|f32)$/i.test(name)
        ? 'audio'
        : 'cacheOther',
  );
  // Sequential categories ensure aliases/hard links have a deterministic owner; small batches keep IO bounded.
  for (let start = 0; start < candidates.length; start += 8) {
    const batch = candidates.slice(start, start + 8);
    const results = await Promise.allSettled(
      batch.map(async ({ file }) => ({ info: await stat(file), canonical: await realpath(file) })),
    );
    results.forEach((result, i) => {
      const candidate = batch[i],
        row = rows[candidate.kind];
      if (result.status === 'rejected') {
        if (!candidate.optional || result.reason?.code !== 'ENOENT') row.unavailable++;
        return;
      }
      const { info, canonical } = result.value;
      if (!info.isFile()) {
        row.unavailable++;
        return;
      }
      const identity = info.ino ? `${info.dev}:${info.ino}` : canonical.toLowerCase();
      if (seenFiles.has(identity)) return;
      seenFiles.add(identity);
      row.files++;
      row.bytes += info.size;
    });
  }
  return { measuredAt: new Date().toISOString(), rows: Object.values(rows), issues };
}
