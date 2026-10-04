import { useEffect, useSyncExternalStore } from 'react';
import type { FrameIndex } from '../../electron/frame-index';
import type { Model, Recording } from './model';

/** Identity of one inspected file revision; a new inspection invalidates its index. */
const revision = (project: string, r: Recording) =>
  JSON.stringify([project, r.id, r.sourceModified, r.duration, r.frameCount, r.keyCount]);

// Project models omit per-frame arrays. The renderer reads them for the recordings it
// is showing and keeps a few, so switching between recent sources does not refetch.
// An hour at 60 fps is 216,000 timestamps (about 1.7 MB as doubles).
class FrameIndexes {
  private entries = new Map<string, FrameIndex>();
  private attached = new WeakMap<Recording, { index: FrameIndex; value: Recording }>();
  private pending = new Set<string>();
  private listeners = new Set<() => void>();
  private version = 0;
  private project = '';
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.version;
  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
  /** The recording with its index attached when one is loaded; otherwise unchanged. */
  attach(project: string | undefined, r: Recording): Recording {
    if (!project || r.retained || !(r.frameCount || r.keyCount)) return r;
    const index = this.entries.get(revision(project, r));
    if (!index) return r;
    // Keep object identity stable for an unchanged recording and index.
    const cached = this.attached.get(r);
    if (cached?.index === index) return cached.value;
    const value = { ...r, frameTimes: index.frameTimes, keys: index.keys };
    this.attached.set(r, { index, value });
    return value;
  }
  load(project: string | undefined, r: Recording | undefined) {
    if (!project || !r || r.retained || !(r.frameCount || r.keyCount)) return;
    if (r.availability !== 'ready') return;
    if (project !== this.project) {
      this.project = project;
      this.entries.clear();
      this.pending.clear();
    }
    const key = revision(project, r);
    if (this.entries.has(key) || this.pending.has(key)) {
      // Refresh recency for an already loaded index.
      const index = this.entries.get(key);
      if (index) {
        this.entries.delete(key);
        this.entries.set(key, index);
      }
      return;
    }
    this.pending.add(key);
    void window
      .virtualCut!.project.frameIndex(project, r.id)
      .then((index) => {
        if (!index || this.project !== project || !this.pending.has(key)) return;
        this.entries.set(key, index);
        while (this.entries.size > 4) this.entries.delete(this.entries.keys().next().value!);
        this.changed();
      })
      // Frame stepping falls back to the nominal rate until the index loads.
      .catch(() => {})
      .finally(() => this.pending.delete(key));
  }
}
export const frameIndexes = new FrameIndexes();

/** Load indexes for the given recordings; the component re-renders when one arrives. */
export function useFrameIndexes(
  project: string | undefined,
  recordings: (Recording | undefined)[],
) {
  useSyncExternalStore(frameIndexes.subscribe, frameIndexes.snapshot);
  const keys = recordings.map((r) => (r && project ? revision(project, r) : '')).join('\n');
  useEffect(() => {
    for (const r of recordings) frameIndexes.load(project, r);
    // The joined revisions capture every input that changes which index is needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, keys]);
}

/** Native saves never need per-frame arrays; leave them out of the IPC payload. */
export function withoutFrameIndexes(model: Model): Model {
  if (!model.recordings.some((r) => r.frameTimes || r.keys)) return model;
  return {
    ...model,
    recordings: model.recordings.map((r) => {
      if (!r.frameTimes && !r.keys) return r;
      const copy = { ...r };
      delete copy.frameTimes;
      delete copy.keys;
      return copy;
    }),
  };
}
