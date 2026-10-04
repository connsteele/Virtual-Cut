import type { Model } from './workflow-types.js';

/** Inspected per-frame and keyframe timestamps for one source, in source seconds. */
export interface FrameIndex {
  frameTimes: number[];
  keys: number[];
}

/** Exact IEEE 754 doubles; JSON text would cost about 50% more and round-trip slower. */
export function encodeTimes(values: readonly number[]): Uint8Array {
  return new Uint8Array(Float64Array.from(values).buffer);
}

export function decodeTimes(blob: Uint8Array): number[] {
  if (blob.byteLength % 8) throw new Error('Frame index data is damaged.');
  // SQLite blobs are not guaranteed to be 8-byte aligned; copy before viewing as doubles.
  return Array.from(new Float64Array(Uint8Array.from(blob).buffer));
}

/**
 * Move per-frame arrays out of a model's recordings, leaving their counts. Projects
 * saved before schema 5 stored them inline, where they grew the editable model with
 * footage length. Mutates the model; returns the removed indexes by recording id.
 */
export function extractFrameIndexes(model: Model): Map<string, FrameIndex> {
  const found = new Map<string, FrameIndex>();
  for (const r of model.recordings || []) {
    if (!Array.isArray(r.frameTimes) && !Array.isArray(r.keys)) continue;
    const index = {
      frameTimes: Array.isArray(r.frameTimes) ? r.frameTimes : [],
      keys: Array.isArray(r.keys) ? r.keys : [],
    };
    found.set(r.id, index);
    delete r.frameTimes;
    delete r.keys;
    r.frameCount = index.frameTimes.length;
    r.keyCount = index.keys.length;
  }
  return found;
}
