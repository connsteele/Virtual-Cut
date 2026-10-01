import type { Clip, Recording } from './model';
import type { ExportRecord, RetainedClip } from '../../electron/export-contracts';

export type ReviewSort = 'folder' | 'name' | 'date-asc' | 'date-desc';
export type ReviewGrouping = 'folders' | 'sequence';
export interface ReviewLocation {
  folder: string;
  external: boolean;
  exportId?: string;
  output?: string;
}
export type ReviewRow = Clip & { location: ReviewLocation; modified?: number };
const absolute = (folder: string) => /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(folder);
const key = (location: ReviewLocation) =>
  `${location.external ? 'external:' : ''}${location.folder}`;
export const reviewFolderKey = key;

/** Presentation only: a current native Done receipt never rewrites a draft or its plan. */
export function reviewRows(
  clips: Clip[],
  recordings: Recording[],
  exports: ExportRecord[] = [],
  library: RetainedClip[] = [],
): ReviewRow[] {
  return clips.map((clip) => {
    const receipt = clip.filed
      ? exports
          .filter(
            (e) =>
              e.plan.clipId === clip.id &&
              e.current &&
              e.state === 'verified' &&
              e.filing?.state === 'complete',
          )
          .sort((a, b) => b.updated.localeCompare(a.updated) || a.plan.id.localeCompare(b.plan.id))
          .find((e) =>
            library.some((c) => c.exportId === e.plan.id && c.available && c.metadataAvailable),
          )
      : undefined;
    const retained = receipt && library.find((c) => c.exportId === receipt.plan.id);
    const sourceDate =
      receipt?.input.sourceModified ?? recordings.find((r) => r.id === clip.rid)?.sourceModified;
    const modified =
      sourceDate == null
        ? undefined
        : sourceDate + (receipt?.plan.requested.start ?? clip.start) * 1000;
    return {
      ...clip,
      modified: modified != null && Number.isFinite(modified) ? modified : undefined,
      location: retained
        ? {
            folder: retained.folder,
            external: absolute(retained.folder),
            exportId: retained.exportId,
            output: retained.output,
          }
        : { folder: clip.folder, external: false },
    };
  });
}
const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
export function sortReview(rows: ReviewRow[], sort: ReviewSort) {
  return [...rows].sort((a, b) => {
    let order = 0;
    if (sort === 'folder') order = compare(key(a.location), key(b.location));
    if (sort.startsWith('date-')) {
      if (a.modified == null || b.modified == null)
        order = Number(b.modified != null) - Number(a.modified != null);
      else order = (a.modified - b.modified) * (sort === 'date-desc' ? -1 : 1);
    }
    return order || compare(a.name, b.name) || compare(a.id, b.id);
  });
}
export function inReviewFolder(row: ReviewRow, filter: string) {
  const folder = key(row.location);
  return (
    !filter || folder === filter || (!row.location.external && folder.startsWith(filter + '/'))
  );
}
export function groupReview(rows: ReviewRow[], mode: ReviewGrouping) {
  const groups: { key: string; location: ReviewLocation; rows: ReviewRow[] }[] = [];
  const occurrences = new Map<string, number>();
  for (const row of rows) {
    const folder = key(row.location);
    const group =
      mode === 'folders' ? groups.find((g) => key(g.location) === folder) : groups.at(-1);
    if (group && key(group.location) === folder) group.rows.push(row);
    else {
      const occurrence = occurrences.get(folder) || 0;
      occurrences.set(folder, occurrence + 1);
      groups.push({
        key: JSON.stringify([folder, occurrence]),
        location: row.location,
        rows: [row],
      });
    }
  }
  return groups;
}
