import type { Clip, Model } from './workflow-types.js';

/** Windows names are checked without rewriting the user's proposed wording. */
export function nameProblem(name: string): string | undefined {
  if (
    !name ||
    name.length > 180 ||
    name.trim() !== name ||
    /[<>:"/\\|?*]/.test(name) ||
    [...name].some((c) => c.charCodeAt(0) < 32) ||
    /[. ]$/.test(name)
  )
    return 'Use 1–180 characters without Windows filename punctuation or leading/trailing spaces.';
  if (
    name === '.' ||
    name === '..' ||
    /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(name)
  )
    return 'That name is reserved by Windows. Choose another name.';
}
export function folderProblem(folder: string): string | undefined {
  if (!folder) return;
  if (folder.length > 2000 || folder.split('/').some((part) => nameProblem(part)))
    return 'Choose a folder within the project destination using valid Windows folder names.';
}
export function plannedFilename(clip: Clip, sourcePath: string): string {
  const ext = /\.(mp4|m4v|mov|mkv|webm)$/i.exec(sourcePath)?.[0].toLowerCase() || '.mp4';
  return clip.name.toLowerCase().endsWith(ext) ? clip.name : clip.name + ext;
}
export function destinationKey(model: Model, clip: Clip): string {
  const r = model.recordings.find((r) => r.id === clip.rid);
  return JSON.stringify([clip.id, clip.name, clip.folder, r?.sourcePath, r?.availability]);
}
export function destinationSignature(model: Model): string {
  return JSON.stringify(model.clips.map((c) => destinationKey(model, c)));
}
/** Immediate checks also run on unsaved edits; filesystem checks belong to main. */
export function localDestinationIssues(model: Model): Record<string, string[]> {
  const issues: Record<string, string[]> = {};
  const targets = new Map<string, string[]>();
  const sources = new Map(model.recordings.map((r) => [r.id, r]));
  for (const clip of model.clips) {
    const problem = nameProblem(clip.name) || folderProblem(clip.folder);
    issues[clip.id] = problem ? [problem] : [];
    if (problem) continue;
    const source = sources.get(clip.rid);
    const target =
      `${clip.folder}/${plannedFilename(clip, source?.sourcePath || '')}`.toLowerCase();
    const peers = targets.get(target);
    if (peers) peers.push(clip.id);
    else targets.set(target, [clip.id]);
  }
  for (const ids of targets.values())
    if (ids.length > 1)
      for (const id of ids)
        issues[id].push(
          'Another clip in this project has the same planned filename. Rename it or choose another folder.',
        );
  return issues;
}
/** Navigation, playback settings and generated previews do not change acceptance. */
export function reviewContent(
  model: Model,
  clip: Clip,
  issues = localDestinationIssues(model),
): string {
  const r = model.recordings.find((r) => r.id === clip.rid);
  return JSON.stringify([
    clip.id,
    clip.rid,
    clip.name,
    clip.start,
    clip.end,
    clip.folder,
    clip.note || '',
    r && [
      r.sourcePath,
      r.sourceModified,
      r.duration,
      r.sourceStart,
      r.timeBase,
      r.availability,
      r.context,
      r.gameTrack,
      r.micTrack,
    ],
    model.markers[clip.rid] || [],
    // Changing a peer's target can invalidate this clip's acceptance too.
    ...(issues[clip.id] || []),
  ]);
}
export interface DestinationRow {
  clipId: string;
  key: string;
  path: string;
  issues: string[];
}
export interface DestinationPlan {
  root: string;
  rows: DestinationRow[];
}
export interface DestinationFolders {
  root: string;
  children: string[];
  planned: boolean;
}
