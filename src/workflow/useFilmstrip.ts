import { useEffect, useRef, useState } from 'react';
import type { FilmstripFrame } from '../../electron/project-contracts';
import type { Recording } from './model';

export function useFilmstrip(
  recording: Recording,
  projectId: string | undefined,
  start: number,
  end: number,
  count: number,
  suspended: boolean,
  hidden: boolean,
) {
  const identity = `${projectId}:${recording.id}:${recording.url}:${start}:${end}:${count}`;
  const token = useRef('');
  const [result, setResult] = useState<{
    identity: string;
    frames: FilmstripFrame[];
    error?: string;
  }>();
  const native = !!projectId && !!recording.sourcePath;
  useEffect(() => {
    const api = window.virtualCut?.project;
    if (!native || !api || suspended || hidden) return;
    let alive = true;
    const request = crypto.randomUUID();
    token.current = request;
    const timer = setTimeout(() => {
      const times = Array.from(
        { length: count },
        (_, i) => start + ((i + 0.5) / count) * (end - start),
      );
      void api
        .filmstrip(projectId!, recording.id, times, request)
        .then((frames) => {
          if (alive) setResult({ identity, frames });
        })
        .catch(() => {
          if (alive)
            setResult({
              identity,
              frames: [],
              error: 'Filmstrip unavailable. Try changing the zoom to retry.',
            });
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
      void api.cancelFilmstrip(projectId!, request).catch(() => {});
    };
  }, [identity, native, projectId, recording.id, start, end, count, suspended, hidden]);
  useEffect(
    () => () => {
      if (projectId && token.current)
        void window.virtualCut?.project
          .cancelFilmstrip(projectId, token.current, true)
          .catch(() => {});
    },
    [projectId, recording.id],
  );
  return {
    native,
    frames: result?.identity === identity ? result.frames : [],
    status:
      result?.identity === identity && result.error
        ? result.error
        : result?.identity === identity && result.frames.length
          ? ''
          : suspended
            ? 'Filmstrip updates when paused'
            : 'Loading filmstrip…',
  };
}
