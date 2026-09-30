import type { Recording } from './model';

export const mediaSorts = {
  'date-asc': 'Date · oldest first',
  'date-desc': 'Date · newest first',
  'intake-asc': 'Intake time · oldest first',
  'intake-desc': 'Intake time · newest first',
  'name-asc': 'Name · A–Z',
  'name-desc': 'Name · Z–A',
} as const;
export type MediaSort = keyof typeof mediaSorts;
export function sortMedia(records: Recording[], sort: MediaSort) {
  const field = sort.split('-')[0],
    direction = sort.endsWith('desc') ? -1 : 1;
  return [...records].sort((a, b) => {
    if (field === 'name')
      return direction * a.title.localeCompare(b.title, undefined, { numeric: true });
    const x = field === 'date' ? a.sourceModified : a.importedAt;
    const y = field === 'date' ? b.sourceModified : b.importedAt;
    const validX = x != null && Number.isFinite(x),
      validY = y != null && Number.isFinite(y);
    if (!validX || !validY) return Number(validY) - Number(validX);
    return direction * (x - y);
  });
}
