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
/** Navigation, playback settings and generated previews do not change acceptance. */
export function reviewContent(model: Model, clip: Clip): string {
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
  ]);
}
export interface DestinationRow {
  clipId: string;
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
