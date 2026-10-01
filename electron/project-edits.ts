import type { Model, Recording, Clip, Marker } from './workflow-types.js';

export function emptyModel(): Model {
  return {
    recordings: [],
    clips: [],
    markers: {},
    terms: [],
    links: [],
    notes: [],
    sequence: [],
    targets: [],
    folders: ['_Review'],
    markerBaseline: {},
    scratchpad: '',
  };
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fields = [
  'title',
  'context',
  'pinned',
  'gameTrack',
  'micTrack',
  'monitor',
  'audioWarning',
] as const;
const micro = (n: number) => Math.round(n * 1e6) / 1e6;

/** Merge only changes the caller actually made. Inspection can add unrelated
 * sources/chapters while an edit is being saved without either writer losing data. */
function mergeItems<T>(before: T[], after: T[], current: T[], key: (x: T) => string): T[] {
  const old = new Map(before.map((x) => [key(x), x]));
  const next = new Map(after.map((x) => [key(x), x]));
  const result = new Map(current.map((x) => [key(x), x]));
  if (old.size !== before.length || next.size !== after.length)
    throw new Error('Duplicate item identity.');
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    if (equal(old.get(id), next.get(id))) continue;
    if (!equal(result.get(id), old.get(id)) && !equal(result.get(id), next.get(id)))
      throw new Error(
        'This item changed elsewhere. Your draft is still open; reload the project before editing it again.',
      );
    if (next.has(id)) result.set(id, next.get(id)!);
    else result.delete(id);
  }
  const orderChanged = JSON.stringify(before.map(key)) !== JSON.stringify(after.map(key));
  // Restore/reorder edited items in the user's order, while retaining unrelated
  // items concurrently added by inspection. Undoing deletion must not renumber
  // the restored clip by appending it to the end of the collection.
  return orderChanged
    ? [
        ...after.map((item) => result.get(key(item))!).filter(Boolean),
        ...[...result].filter(([id]) => !next.has(id)).map(([, item]) => item),
      ]
    : [...result.values()];
}
export function mergeEdits(before: Model, after: Model, current: Model): Model {
  // Done is derived from native receipts. Never merge renderer presentation flags
  // into draft edits, or treat a completed job as a concurrent editorial change.
  const withoutDone = (m: Model): Model => ({
    ...m,
    clips: m.clips.map((c) => ({ ...c, filed: false })),
  });
  before = withoutDone(before);
  after = withoutDone(after);
  current = withoutDone(current);
  const result = structuredClone(current);
  const byId = (x: { id: string }) => x.id;
  for (const field of ['clips', 'terms', 'notes', 'sequence', 'targets'] as const) {
    // Each collection is homogeneous; the shared identity operation preserves its type.
    Object.assign(result, {
      [field]: mergeItems<{ id: string }>(before[field], after[field], current[field], byId),
    });
  }
  result.links = mergeItems(before.links, after.links, current.links, (x) =>
    JSON.stringify([x.from, x.to, x.label]),
  );
  result.folders = mergeItems(before.folders, after.folders, current.folders, (x) => x);
  for (const id of new Set([...Object.keys(before.markers), ...Object.keys(after.markers)]))
    result.markers[id] = mergeItems(
      before.markers[id] || [],
      after.markers[id] || [],
      current.markers[id] || [],
      byId,
    );
  result.recordings = current.recordings.map((r) => {
    const old = before.recordings.find((x) => x.id === r.id),
      next = after.recordings.find((x) => x.id === r.id);
    if (!old || !next) return r;
    const value = { ...r };
    for (const field of fields) {
      if (equal(old[field], next[field])) continue;
      if (!equal(r[field], old[field]) && !equal(r[field], next[field]))
        throw new Error(
          'The recording changed elsewhere. Reload the project to reconcile your draft.',
        );
      Object.assign(value, { [field]: next[field] });
    }
    if (Number.isFinite(next.position) && next.position !== old.position)
      value.position = Math.max(0, Math.min(r.duration, next.position));
    return value;
  });
  if (before.scratchpad !== after.scratchpad) {
    if (current.scratchpad !== before.scratchpad && current.scratchpad !== after.scratchpad)
      throw new Error('Project notes changed elsewhere.');
    result.scratchpad = after.scratchpad;
  }
  if (
    before.selectedRecordingId !== after.selectedRecordingId &&
    (!after.selectedRecordingId ||
      current.recordings.some((r) => r.id === after.selectedRecordingId))
  )
    result.selectedRecordingId = after.selectedRecordingId;
  return result;
}
export function editorial(model: Model): string {
  return JSON.stringify({
    ...model,
    clips: model.clips.map((c) => ({ ...c, filed: false })),
    selectedRecordingId: undefined,
    recordings: model.recordings.map((r) => ({
      id: r.id,
      ...Object.fromEntries(fields.map((f) => [f, r[f]])),
    })),
  });
}
export function validateEdits(model: Model): Model {
  if (JSON.stringify(model).length > 32 * 1024 * 1024)
    throw new Error('Project edit is too large. Use a smaller pinned preview.');
  const sources = new Map(model.recordings.map((r) => [r.id, r]));
  const text = (s: unknown, max = 100000): s is string => typeof s === 'string' && s.length <= max;
  if (!text(model.scratchpad || '') || model.clips.length > 50000)
    throw new Error('Invalid project edit.');
  const validTime = (n: number, r: Recording) =>
    Number.isFinite(n) && n >= 0 && n <= r.duration + 0.000001;
  model.clips = model.clips.map((c: Clip) => {
    const r = sources.get(c.rid);
    if (
      !r ||
      !text(c.id, 200) ||
      !text(c.name, 500) ||
      !validTime(c.start, r) ||
      !validTime(c.end, r) ||
      c.end <= c.start ||
      !text(c.folder, 2000)
    )
      throw new Error('A clip must belong to a recording and have valid in/out points.');
    return {
      ...c,
      start: micro(c.start),
      end: micro(c.end),
      include: true,
      ...(c.filed ? { filed: false } : {}),
    };
  });
  const seen = new Set<string>();
  for (const [rid, markers] of Object.entries(model.markers)) {
    const r = sources.get(rid);
    if (!r && markers.length) throw new Error('Marker source is missing.');
    model.markers[rid] = markers.map((m: Marker) => {
      if (
        seen.has(m.id) ||
        !text(m.id, 200) ||
        !text(m.name, 10000) ||
        !r ||
        !validTime(m.time, r) ||
        (m.end != null && (!validTime(m.end, r) || micro(m.end) <= micro(m.time))) ||
        !['Character', 'Combat', 'Mechanic', 'Story', 'Context'].includes(m.category) ||
        !text(m.note || '')
      )
        throw new Error('Invalid marker.');
      seen.add(m.id);
      return { ...m, time: micro(m.time), ...(m.end != null ? { end: micro(m.end) } : {}) };
    });
  }
  for (const r of model.recordings) {
    if (
      !text(r.title, 500) ||
      !text(r.context) ||
      (r.pinned && (!r.pinned.startsWith('data:image/') || r.pinned.length > 8 * 1024 * 1024))
    )
      throw new Error('Invalid recording context or pinned preview.');
    for (const role of [r.gameTrack, r.micTrack])
      if (role != null && !r.audioTracks?.some((t) => t.index === role))
        throw new Error('Choose an audio track belonging to this recording.');
    if (r.gameTrack != null && r.gameTrack === r.micTrack)
      throw new Error('Game and microphone must use different tracks.');
  }
  return model;
}
