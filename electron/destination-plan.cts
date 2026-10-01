import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { destinationKey, folderProblem, nameProblem, plannedFilename } from './review-plan.js';
import type { DestinationPlan, DestinationFolders } from './review-plan.js' with {
  'resolution-mode': 'import',
};
import type { Model } from './workflow-types.js' with { 'resolution-mode': 'import' };

function within(root: string, file: string) {
  const rel = path.relative(root, file);
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}
async function rootPath(root: string) {
  if (!path.isAbsolute(root) || !(await lstat(root)).isDirectory())
    throw new Error('Destination is unavailable. Reconnect its drive.');
  return realpath(root);
}
async function inspectFolder(root: string, folder: string) {
  const problem = folderProblem(folder);
  if (problem) throw new Error(problem);
  let current = root,
    planned = false;
  for (const part of folder ? folder.split('/') : []) {
    current = path.join(current, part);
    if (!within(root, current)) throw new Error('Folder leaves the project destination.');
    const info = await lstat(current).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null;
      throw new Error('Folder cannot be inspected. Check its drive and permissions.');
    });
    if (!info) {
      planned = true;
      continue;
    }
    if (info.isSymbolicLink() || !info.isDirectory() || !within(root, await realpath(current)))
      throw new Error('Choose a regular destination folder, not a link or an existing file.');
  }
  return { current, planned };
}
export async function destinationFolders(
  destination: string,
  folder: string,
): Promise<DestinationFolders> {
  const root = await rootPath(destination);
  const { current, planned } = await inspectFolder(root, folder);
  const children = planned
    ? []
    : (await readdir(current, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !e.isSymbolicLink() && !nameProblem(e.name))
        .map((e) => (folder ? folder + '/' + e.name : e.name))
        .sort((a, b) => a.localeCompare(b));
  if (children.length > 1000)
    throw new Error('This folder has too many children to list. Choose a smaller destination.');
  return { root: destination, children, planned };
}
/** Resolve only a validated folder (or its nearest existing parent) for Explorer. */
export async function destinationLocation(destination: string, folder: string) {
  const root = await rootPath(destination);
  let { current } = await inspectFolder(root, folder);
  while (!(await lstat(current).catch(() => null))) current = path.dirname(current);
  if (!within(root, current)) throw new Error('Folder leaves the project destination.');
  return current;
}
export async function destinationPlan(
  destination: string,
  model: Model,
  sourcePaths: string[],
): Promise<DestinationPlan> {
  let root = '',
    rootError = '';
  try {
    root = await rootPath(destination);
  } catch {
    rootError = 'Destination is unavailable. Reconnect its drive and check again.';
  }
  const rows: DestinationPlan['rows'] = [];
  const targets = new Map<string, typeof rows>();
  const sourceSet = new Set(sourcePaths.map((f) => path.resolve(f).toLowerCase()));
  for (const clip of model.clips) {
    const recording = model.recordings.find((r) => r.id === clip.rid);
    const issues: string[] = [];
    const row = { clipId: clip.id, key: destinationKey(model, clip), path: '', issues };
    rows.push(row);
    const invalid = nameProblem(clip.name) || folderProblem(clip.folder);
    if (invalid) {
      issues.push(invalid);
      continue;
    }
    const filename = plannedFilename(clip, recording?.sourcePath || '');
    row.path = path.join(destination, ...clip.folder.split('/'), filename);
    if (rootError) issues.push(rootError);
    if (recording?.availability !== 'ready')
      issues.push('Source is unavailable or still being inspected.');
    const target = path.join(root || destination, ...clip.folder.split('/'), filename);
    const key = target.toLowerCase();
    targets.set(key, [...(targets.get(key) || []), row]);
    if (rootError) continue;
    try {
      await inspectFolder(root, clip.folder);
      if (sourceSet.has(key))
        issues.push('This target is an original source. Choose another name or folder.');
      for (const candidate of [target, target + '.vcut.json']) {
        const exists = await lstat(candidate).catch((e: NodeJS.ErrnoException) => {
          if (e.code === 'ENOENT') return null;
          throw e;
        });
        if (exists)
          issues.push(
            candidate === target
              ? 'A file or folder already uses this filename. Rename the clip or choose another folder.'
              : 'A companion metadata file already uses this name. Rename the clip or choose another folder.',
          );
      }
    } catch (e) {
      issues.push(e instanceof Error ? e.message : 'Destination cannot be checked.');
    }
  }
  for (const group of targets.values())
    if (group.length > 1)
      group.forEach((row) =>
        row.issues.push(
          'Another clip in this project has the same planned filename. Rename it or choose another folder.',
        ),
      );
  return { root: destination, rows };
}
