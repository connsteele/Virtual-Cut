import type { FilmstripFrame } from '../../electron/project-contracts';
import type { Recording } from './model';

export function filmstripSource(project: string, r: Recording) {
  return JSON.stringify([
    project,
    r.id,
    r.retained ? '' : r.url,
    r.sourcePath,
    r.sourceModified,
    r.sourceStart,
    r.duration,
    r.availability,
    // Project models keep only the count; the keyframe arrays load on demand.
    r.keyCount ?? r.keys?.length,
  ]);
}

// A source-anchored grid survives pans. Round away subtraction noise, not media
// timestamps. At most count+1 tiles intersect the viewport (count is at most 31).
export function filmstripTiles(start: number, end: number, count: number, duration: number) {
  const step = Number(((end - start) / Math.max(1, Math.min(31, count))).toPrecision(12));
  if (!(step > 0) || !(duration > 0)) return [];
  const first = Math.floor(start / step + 1e-9);
  const last = Math.ceil(end / step - 1e-9);
  return Array.from({ length: Math.min(32, last - first) }, (_, n) => {
    const index = first + n;
    const left = index * step;
    const right = Math.min(duration, left + step);
    return { left, right, requested: Number(((left + right) / 2).toPrecision(12)) };
  });
}

type Entry = { source: string; frame: FilmstripFrame; cost: number; overview: boolean };
const key = (source: string, at: number) => `${source}:${at.toPrecision(12)}`;

// JPEG blobs, never detached Image elements or full-size video frames. The budget
// includes an estimate for one decoded RGBA surface per tile, not just JPEG bytes.
// Chromium manages decoder/GPU overhead; this is not a total RSS limit.
export class FilmstripMemory {
  private project = '';
  private valid = new Set<string>();
  private entries = new Map<string, Entry>();
  private bytes = 0;
  private revision = 0;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.revision;
  private changed() {
    this.revision++;
    this.listeners.forEach((fn) => fn());
  }
  private remove(id: string) {
    const entry = this.entries.get(id)!;
    URL.revokeObjectURL(entry.frame.data);
    this.bytes -= entry.cost;
    this.entries.delete(id);
  }
  sync(project: string, recordings: Recording[]) {
    const next = new Set(
      recordings.filter((r) => r.availability === 'ready').map((r) => filmstripSource(project, r)),
    );
    let changed = this.project !== project;
    this.project = project;
    this.valid = next;
    for (const [id, entry] of this.entries) {
      if (!next.has(entry.source)) {
        this.remove(id);
        changed = true;
      }
    }
    if (changed) this.changed();
  }
  retain(project: string, recording: Recording) {
    if (this.project !== project) this.sync(project, []);
    this.valid.add(filmstripSource(project, recording));
  }
  releaseDetails(source: string) {
    for (const [id, entry] of this.entries) {
      if (entry.source === source && !entry.overview) this.remove(id);
    }
    this.changed();
  }
  get(source: string, at: number) {
    return this.entries.get(key(source, at))?.frame;
  }
  touch(source: string, times: number[], overview: boolean) {
    for (const at of times) {
      const id = key(source, at),
        entry = this.entries.get(id);
      if (!entry) continue;
      entry.overview ||= overview;
      this.entries.delete(id);
      this.entries.set(id, entry);
    }
  }
  put(source: string, frames: FilmstripFrame[], overview: boolean, visible: number[]) {
    if (!this.valid.has(source)) return;
    for (const frame of frames) {
      const id = key(source, frame.requested);
      if (this.entries.has(id)) continue;
      const data = Uint8Array.from(atob(frame.data.split(',')[1]), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([data], { type: 'image/jpeg' }));
      const cost = data.byteLength + 240 * 136 * 4;
      this.entries.set(id, { source, frame: { ...frame, data: url }, cost, overview });
      this.bytes += cost;
    }
    this.touch(source, visible, overview);
    const protectedKeys = new Set(visible.map((at) => key(source, at)));
    while (this.entries.size > 192 || this.bytes > 24 * 1024 * 1024) {
      const candidates = [...this.entries].filter(([id]) => !protectedKeys.has(id));
      // Reserve up to 96 recent overview tiles; detail uses the remaining budget.
      const overviews = [...this.entries.values()].filter((e) => e.overview).length;
      const victim = (overviews <= 96 && candidates.find(([, e]) => !e.overview)) || candidates[0];
      if (!victim) break;
      this.remove(victim[0]);
    }
    this.changed();
  }
  stats() {
    return { entries: this.entries.size, bytes: this.bytes };
  }
}

export const filmstripMemory = new FilmstripMemory();
