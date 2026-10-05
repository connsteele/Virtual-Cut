import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Recording } from './model';
import {
  filmstripMemory,
  FilmstripMemory,
  filmstripSource,
  filmstripTiles,
} from './filmstripMemory';

export const retainedMemory = new FilmstripMemory();

export function useFilmstrip(
  recording: Recording,
  projectId: string | undefined,
  start: number,
  end: number,
  count: number,
  suspended: boolean,
  hidden: boolean,
  overview: boolean,
) {
  const memory = recording.retained ? retainedMemory : filmstripMemory;
  const source = filmstripSource(projectId || '', recording);
  const tiles = filmstripTiles(start, end, count, recording.duration);
  const timesKey = JSON.stringify(tiles.map((t) => t.requested));
  const identity = `${source}:${timesKey}`;
  const [error, setError] = useState('');
  // "Loading filmstrip…" appears only when tiles take longer than this to arrive.
  const [slow, setSlow] = useState('');
  useEffect(() => {
    if (!recording.retained) return;
    retainedMemory.retain(projectId || '', recording);
    return () => retainedMemory.releaseDetails(source);
    // The source key includes all preview identity fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  useSyncExternalStore(memory.subscribe, memory.snapshot);
  const native = !!projectId && !!recording.sourcePath;
  const ready = recording.availability === 'ready';
  useEffect(() => {
    const api = window.virtualCut?.project;
    if (!native || !ready || !api || hidden) return;
    const times: number[] = JSON.parse(timesKey);
    memory.touch(source, times, overview);
    const missing = times.filter((at) => !memory.get(source, at));
    if (!missing.length || suspended) return;
    let alive = true;
    const request = crypto.randomUUID();
    // Decoding waits for zoom and pan to settle; tiles read from a tile file need no wait.
    const timer = setTimeout(
      () => {
        void api
          .filmstrip(projectId!, recording.id, missing, request)
          .then((frames) => {
            if (alive) memory.put(source, frames, overview, times);
          })
          .catch(() => {
            if (alive) setError(identity);
          });
      },
      memory.isStored(source) ? 0 : 250,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
      void api.cancelFilmstrip(projectId!, request).catch(() => {});
      if (recording.retained && !overview) memory.releaseDetails(source);
    };
  }, [
    memory,
    identity,
    source,
    timesKey,
    native,
    ready,
    projectId,
    recording.id,
    recording.retained,
    suspended,
    hidden,
    overview,
  ]);
  const exact = tiles.map((tile) => (ready ? memory.get(source, tile.requested) : undefined));
  const complete = exact.length > 0 && exact.every(Boolean);
  // While a new zoom or pan loads, show the nearest frame already in memory rather than a gap.
  const frames = exact.map(
    (frame, i) =>
      frame ||
      (ready
        ? memory.nearest(source, tiles[i].requested, 2 * (tiles[i].right - tiles[i].left))
        : undefined),
  );
  useEffect(() => {
    if (complete) return;
    const timer = setTimeout(() => setSlow(identity), 300);
    return () => clearTimeout(timer);
  }, [complete, identity]);
  return {
    native,
    tiles,
    frames,
    exact,
    loading: native && ready && !hidden && !complete,
    status: complete
      ? ''
      : error === identity
        ? 'Filmstrip unavailable. Try changing the zoom to retry.'
        : suspended
          ? 'Filmstrip updates when paused'
          : slow === identity
            ? 'Loading filmstrip…'
            : '',
  };
}
