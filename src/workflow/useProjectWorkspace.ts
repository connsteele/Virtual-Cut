import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { ProjectSnapshot, RecentProject } from '../../electron/project-contracts';
import { mergeEdits, editorial } from '../../electron/project-edits';
import { loadModel, storedModel, modelKey, type Model } from './model';

const changed = (a: Model, b: Model) =>
  a.selectedRecordingId !== b.selectedRecordingId ||
  editorial(a) !== editorial(b) ||
  a.recordings.some((r) => r.position !== b.recordings.find((x) => x.id === r.id)?.position);
export function useProjectWorkspace() {
  const [model, rawSetModel] = useState(loadModel);
  const modelRef = useRef(model),
    base = useRef(model),
    session = useRef<ProjectSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null),
    [recents, setRecents] = useState<RecentProject[]>([]);
  const [saveState, setSaveState] = useState('Sample'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const saving = useRef<Promise<void> | null>(null),
    working = useRef(false);
  const setModel = useCallback((action: SetStateAction<Model>) => {
    const value = typeof action === 'function' ? action(modelRef.current) : action;
    modelRef.current = value;
    rawSetModel(value);
    if (session.current && changed(value, base.current)) setSaveState('Saving…');
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
    setSaveState(changed(next, value.model) ? 'Saving…' : 'Saved');
  }, []);
  const flush = useCallback(async () => {
    if (saving.current) return saving.current;
    const task = (async () => {
      while (session.current && changed(modelRef.current, base.current)) {
        const id = session.current.project.id;
        const sent = modelRef.current;
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
  }, [apply]);
  useEffect(() => {
    if (!snapshot) {
      try {
        localStorage.setItem(modelKey, storedModel(model));
      } catch {
        setError('Sample changes could not be saved.');
      }
      return;
    }
    const timeout = setTimeout(() => {
      void flush().catch(() => {});
    }, 250);
    return () => clearTimeout(timeout);
  }, [model, snapshot, flush]);
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
    async (fn: () => Promise<ProjectSnapshot | null | void>) => {
      if (working.current) return null;
      working.current = true;
      window.dispatchEvent(new Event('virtual-cut-pause-workspace'));
      setBusy(true);
      setError('');
      try {
        await flush();
        const value = await fn();
        if (value) apply(value, true);
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
  return { model, setModel, snapshot, recents, saveState, error, busy, run, flush, sample };
}
