import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { ProjectSnapshot, RecentProject } from '../../electron/project-contracts';
import { mergeEdits, editorial } from '../../electron/project-edits';
import { loadModel, storedModel, modelKey, type Model } from './model';

const changed = (a: Model, b: Model) =>
  a.selectedRecordingId !== b.selectedRecordingId ||
  editorial(a) !== editorial(b) ||
  a.recordings.some((r) => r.position !== b.recordings.find((x) => x.id === r.id)?.position);
const edited = (a: Model, b: Model) => editorial(a) !== editorial(b);
export function useProjectWorkspace() {
  const [model, rawSetModel] = useState(loadModel);
  const modelRef = useRef(model),
    base = useRef(model),
    session = useRef<ProjectSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null),
    [recents, setRecents] = useState<RecentProject[]>([]);
  const [saveState, setSaveState] = useState('Sample'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [quiet, setQuiet] = useState(false);
  const saving = useRef<Promise<void> | null>(null),
    working = useRef(false);
  const activity = useRef(false);
  const [playbackActive, setPlaybackState] = useState(false);
  const setPlaybackActive = useCallback((active: boolean) => {
    // The ref also guards a timer that was queued just before playback began.
    activity.current = active;
    setPlaybackState(active);
  }, []);
  const setModel = useCallback((action: SetStateAction<Model>) => {
    const value = typeof action === 'function' ? action(modelRef.current) : action;
    modelRef.current = value;
    rawSetModel(value);
    if (session.current && edited(value, base.current)) setSaveState('Unsaved changes');
  }, []);
  const apply = useCallback((value: ProjectSnapshot, replace = false, ancestor = base.current) => {
    const same = session.current?.project.id === value.project.id;
    const next =
      replace || !same ? value.model : mergeEdits(ancestor, modelRef.current, value.model);
    base.current = value.model;
    session.current = value;
    setSnapshot(value);
    modelRef.current = next;
    rawSetModel(next);
    setSaveState(edited(next, value.model) ? 'Unsaved changes' : 'Saved');
  }, []);
  const flush = useCallback(
    async (captureLatest = true) => {
      while (saving.current) {
        await saving.current;
        // Explicit Save, project operations and close must also capture navigation
        // that arrived while an earlier automatic write was in flight.
        if (!captureLatest) return;
      }
      if (!captureLatest && activity.current) return;
      const task = (async () => {
        // Take one navigation snapshot. Playback may advance while native storage
        // responds; only new editorial changes justify another immediate write.
        let first = true;
        while (
          session.current &&
          (captureLatest || !activity.current) &&
          (first ? changed(modelRef.current, base.current) : edited(modelRef.current, base.current))
        ) {
          first = false;
          const id = session.current.project.id;
          const sent = modelRef.current;
          if (edited(sent, base.current)) setSaveState('Saving…');
          const value = await window.virtualCut!.project.save(id, base.current, sent);
          if (session.current?.project.id !== id) return;
          apply(value, false, sent);
          setError('');
        }
      })();
      saving.current = task;
      try {
        await task;
      } catch (e) {
        setSaveState('Not saved');
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        saving.current = null;
      }
    },
    [apply],
  );
  const editKey = editorial(model);
  const navigationKey = JSON.stringify([
    model.selectedRecordingId,
    model.recordings.map((r) => [r.id, r.position]),
  ]);
  const projectId = snapshot?.project.id;
  useEffect(() => {
    // Automatic writes wait for both transport and edits to settle. A held scrub
    // or stalled decoder remains active even if no position events arrive.
    if (playbackActive) return;
    const timer = setTimeout(() => {
      if (activity.current) return;
      if (projectId) void flush(false).catch(() => {});
      else {
        try {
          localStorage.setItem(modelKey, storedModel(modelRef.current));
        } catch {
          setError('Sample changes could not be saved.');
        }
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [editKey, navigationKey, playbackActive, projectId, flush]);
  useEffect(() => {
    const api = window.virtualCut?.project;
    if (!api) return;
    let alive = true;
    void api
      .recent()
      .then(async (list) => {
        if (!alive) return;
        setRecents(list);
        const current = await api.current();
        if (current && alive) apply(current, true);
        // Opening projects is explicit. Recents makes a missing/offline project
        // recoverable without silently opening a different project on startup.
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    const timer = setInterval(() => {
      if (!session.current || saving.current || working.current) return;
      const id = session.current.project.id;
      void api
        .current()
        .then((value) => {
          if (
            alive &&
            value &&
            session.current?.project.id === id &&
            !saving.current &&
            !working.current
          )
            apply(value);
        })
        .catch((e) => {
          if (alive) setError(String(e));
        });
    }, 1000);
    const off = api.onCloseRequested(() => {
      window.dispatchEvent(new Event('virtual-cut-pause-workspace'));
      void flush()
        .then(() => api.finishClose())
        .catch(() => {});
    });
    return () => {
      alive = false;
      clearInterval(timer);
      off();
    };
  }, [apply, flush]);
  const run = useCallback(
    async (fn: () => Promise<ProjectSnapshot | null | void>, quiet = false) => {
      if (working.current) return null;
      working.current = true;
      window.dispatchEvent(new Event('virtual-cut-pause-workspace'));
      setBusy(true);
      setQuiet(quiet);
      setError('');
      try {
        await flush();
        const ancestor = base.current;
        const value = await fn();
        if (value) apply(value, !quiet, ancestor);
        setRecents(await window.virtualCut!.project.recent());
        return value;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        working.current = false;
        setBusy(false);
      }
    },
    [flush, apply],
  );
  const sample = async () => {
    await run(async () => {
      await window.virtualCut!.project.close();
      session.current = null;
      setSnapshot(null);
      const value = loadModel();
      base.current = value;
      modelRef.current = value;
      rawSetModel(value);
      setSaveState('Sample');
    });
  };
  const checkpoint = async () => {
    if (!session.current) return;
    const value = await run(
      () => window.virtualCut!.project.checkpoint(session.current!.project.id),
      true,
    );
    if (value && !changed(modelRef.current, base.current)) setSaveState('Manual save made');
  };
  return {
    model,
    setModel,
    setPlaybackActive,
    snapshot,
    recents,
    saveState,
    error,
    busy,
    run,
    flush,
    sample,
    checkpoint,
    quiet,
    blocking: busy && !quiet,
  };
}
