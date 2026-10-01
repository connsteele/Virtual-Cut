import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Recording } from './model';
import { filmstripMemory, filmstripSource, filmstripTiles } from './filmstripMemory';

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
  const source = filmstripSource(projectId || '', recording);
  const tiles = filmstripTiles(start, end, count, recording.duration);
  const timesKey = JSON.stringify(tiles.map((t) => t.requested));
  const identity = `${source}:${timesKey}`;
  const [error, setError] = useState('');
  useSyncExternalStore(filmstripMemory.subscribe, filmstripMemory.snapshot);
  const native = !!projectId && !!recording.sourcePath;
  const ready = recording.availability === 'ready';
  useEffect(() => {
    const api = window.virtualCut?.project;
    if (!native || !ready || !api || hidden) return;
    const times: number[] = JSON.parse(timesKey);
    filmstripMemory.touch(source, times, overview);
    const missing = times.filter((at) => !filmstripMemory.get(source, at));
    if (!missing.length || suspended) return;
    let alive = true;
    const request = crypto.randomUUID();
    const timer = setTimeout(() => {
      void api
        .filmstrip(projectId!, recording.id, missing, request)
        .then((frames) => {
          if (alive) filmstripMemory.put(source, frames, overview, times);
        })
        .catch(() => {
          if (alive) setError(identity);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
      void api.cancelFilmstrip(projectId!, request).catch(() => {});
    };
  }, [
    identity,
    source,
    timesKey,
    native,
    ready,
    projectId,
    recording.id,
    suspended,
    hidden,
    overview,
  ]);
  const frames = tiles.map((tile) =>
    ready ? filmstripMemory.get(source, tile.requested) : undefined,
  );
  const complete = frames.length > 0 && frames.every(Boolean);
  return {
    native,
    tiles,
    frames,
    status: complete
      ? ''
      : error === identity
        ? 'Filmstrip unavailable. Try changing the zoom to retry.'
        : suspended
          ? 'Filmstrip updates when paused'
          : 'Loading filmstrip…',
  };
}
