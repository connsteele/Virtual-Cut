/** Small reading preferences only; project edits remain in the project store. */
export interface TranscriptView {
  projectId: string;
  sourceId: string;
  transcriptId: string;
  page: number;
  search: string;
  filter: 'all' | 'cues' | 'pending' | 'accepted' | 'rejected';
  follow: boolean;
  original: boolean;
  scroll: number;
  focus?: { segment: number; word?: number };
}
interface ViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const key = 'virtual-cut-transcript-view-v1';
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 180;
const index = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1000000;
function valid(value: unknown): value is TranscriptView {
  if (!value || typeof value !== 'object') return false;
  const v = value as TranscriptView;
  return (
    identifier(v.projectId) &&
    identifier(v.sourceId) &&
    identifier(v.transcriptId) &&
    index(v.page) &&
    typeof v.search === 'string' &&
    v.search.length <= 300 &&
    ['all', 'cues', 'pending', 'accepted', 'rejected'].includes(v.filter) &&
    typeof v.follow === 'boolean' &&
    typeof v.original === 'boolean' &&
    Number.isFinite(v.scroll) &&
    v.scroll >= 0 &&
    v.scroll <= 10000000 &&
    (v.focus == null || (index(v.focus.segment) && (v.focus.word == null || index(v.focus.word))))
  );
}
function views(storage: ViewStorage, owner: string): TranscriptView[] {
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > 20000) return [];
    const cached = JSON.parse(raw);
    return cached.owner === owner && Array.isArray(cached.views)
      ? cached.views.slice(0, 8).filter(valid)
      : [];
  } catch {
    return [];
  }
}
export function readTranscriptView(
  storage: ViewStorage,
  owner: string,
  projectId: string,
  sourceId: string,
  transcripts: string[],
): TranscriptView | undefined {
  if (!identifier(owner)) return;
  return views(storage, owner).find(
    (v) =>
      v.projectId === projectId && v.sourceId === sourceId && transcripts.includes(v.transcriptId),
  );
}
export function saveTranscriptView(storage: ViewStorage, owner: string, view: TranscriptView) {
  if (!identifier(owner) || !valid(view)) return;
  // Copy known fields: never persist cue/correction drafts or recognition bodies.
  const clean: TranscriptView = {
    projectId: view.projectId,
    sourceId: view.sourceId,
    transcriptId: view.transcriptId,
    page: view.page,
    search: view.search,
    filter: view.filter,
    follow: view.follow,
    original: view.original,
    scroll: view.scroll,
    ...(view.focus ? { focus: { segment: view.focus.segment, word: view.focus.word } } : {}),
  };
  const previous = views(storage, owner).filter(
    (v) => v.projectId !== view.projectId || v.sourceId !== view.sourceId,
  );
  try {
    storage.setItem(key, JSON.stringify({ owner, views: [clean, ...previous].slice(0, 8) }));
  } catch {
    /* Reading state is optional when browser storage is unavailable. */
  }
}
