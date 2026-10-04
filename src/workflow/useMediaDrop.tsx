import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { DroppedImport } from '../../electron/project-contracts';
import type { useProjectWorkspace } from './useProjectWorkspace';
import { ImportPanel } from './ProjectPanel';
import s from './Workflow.module.css';
import { background } from './background';

export function useMediaDrop(w: ReturnType<typeof useProjectWorkspace>, enabled: boolean) {
  const [hover, setHover] = useState(false),
    [offer, setOffer] = useState<{ identity: string; value: DroppedImport } | null>(null),
    [message, setMessage] = useState('');
  const staging = useRef(false),
    token = useRef(''),
    generation = useRef(0);
  const identity = `${w.snapshot?.project.id || ''}:${w.snapshot?.activeBatchId || ''}`;
  const drop = offer?.identity === identity ? offer.value : null;
  useEffect(() => {
    // File drops outside Media must not trigger Chromium's default navigation.
    const prevent = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', prevent);
    return () => {
      document.removeEventListener('dragover', prevent);
      document.removeEventListener('drop', prevent);
    };
  }, []);
  useEffect(
    () => () => {
      generation.current++;
      if (token.current) background(window.virtualCut?.project.discardDrop(token.current));
      token.current = '';
    },
    [identity],
  );
  const close = () => {
    if (token.current) background(window.virtualCut?.project.discardDrop(token.current));
    token.current = '';
    setOffer(null);
  };
  const handlers = {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      const modal = !!document.querySelector('dialog[open]');
      e.dataTransfer.dropEffect =
        enabled && !!w.snapshot && !w.busy && !drop && !modal ? 'copy' : 'none';
      setHover(enabled && !modal);
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(false);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      setHover(false);
      if (!enabled || drop || staging.current || document.querySelector('dialog[open]')) return;
      if (!w.snapshot) {
        setMessage('Open or create a project before dropping recordings.');
        return;
      }
      if (w.busy) {
        setMessage('Wait for the current action, then drop the files again.');
        return;
      }
      const p = w.snapshot;
      const version = generation.current;
      staging.current = true;
      setMessage('Checking dropped files…');
      void window
        .virtualCut!.project.stageDrop(
          p.project.id,
          p.activeBatchId,
          Array.from(e.dataTransfer.files),
        )
        .then((result) => {
          if (version !== generation.current) {
            background(window.virtualCut!.project.discardDrop(result.token));
            return;
          }
          token.current = result.token;
          setOffer({ identity, value: result });
          setMessage('');
        })
        .catch((e) => setMessage(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          staging.current = false;
        });
    },
  };
  return {
    handlers,
    content: (
      <>
        {enabled && message && (
          <p role="status" className={s.dropMessage}>
            {message}
          </p>
        )}
        {enabled && hover && (
          <div className={s.dropOverlay} role="status">
            <strong>
              {w.snapshot && !w.busy && !drop
                ? `Drop videos into ${w.snapshot.batches.find((b) => b.id === w.snapshot!.activeBatchId)?.name}`
                : 'Open a project and finish the current action first'}
            </strong>
            <span>One or many files · originals stay in place</span>
          </div>
        )}
        {drop && w.snapshot && (
          <ImportPanel
            key={drop.token || 'invalid-drop'}
            workspace={w}
            kind="files"
            drop={drop}
            onClose={close}
          />
        )}
      </>
    ),
  };
}
