import { retainedMemory } from './useFilmstrip';
import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Link2 } from 'lucide-react';
import type { RetainedClip } from '../../electron/export-contracts';
import type { useProjectWorkspace } from './useProjectWorkspace';
import { Player, type Transport } from './Player';
import { Button } from './ui';
import { markerColor, time, type Recording } from './model';
import s from './CompletedLibrary.module.css';
import { background } from './background';

type Workspace = ReturnType<typeof useProjectWorkspace>;
export function CompletedLibrary({
  workspace: w,
  active,
}: {
  workspace: Workspace;
  active: boolean;
}) {
  const [query, setQuery] = useState(''),
    [folder, setFolder] = useState(''),
    [selected, setSelected] = useState<RetainedClip>(),
    [attempted, setAttempted] = useState<RetainedClip>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState('');
  const [preview, setPreview] = useState<Recording>();
  const [previewStatus, setPreviewStatus] = useState('');
  const [selectedMarker, setSelectedMarker] = useState<{ clip: string; id: string }>();
  const visited = useRef(new Set<string>());
  const prepared = useRef<{ url: string; token: string } | null>(null);
  const request = useRef(0),
    transport = useRef<Transport>(null);
  const p = w.snapshot!,
    clips = p.library || [],
    folders = [...new Set(clips.map((c) => c.folder))].sort();
  useEffect(() => {
    retainedMemory.sync(p.project.id, []);
    visited.current.clear();
    return () => retainedMemory.sync('', []);
  }, [p.project.id]);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(() => {
    if (!active) {
      request.current++;
      setLoading('');
      const pending = prepared.current;
      prepared.current = null;
      if (pending)
        void window
          .virtualCut!.project.releaseRetained(p.project.id, pending.token)
          .catch(() => {});
    }
  }, [active, p.project.id]);
  useEffect(() => {
    setPreviewStatus('');
    if (!active || !selected) return;
    let alive = true;
    const ready = prepared.current?.url === selected.url ? prepared.current : null;
    prepared.current = null;
    const token = ready?.token || crypto.randomUUID();
    const api = window.virtualCut!.project;
    if (ready)
      return () => {
        void api.releaseRetained(p.project.id, token).catch(() => {});
      };
    setPreview(undefined);
    setPreviewStatus('Preparing filmstrip and game waveform…');
    void api
      .inspectRetained(p.project.id, selected.exportId, token)
      .then((value) => {
        if (alive) {
          setPreview(value);
          setPreviewStatus('');
          visited.current.add(selected.exportId);
          if (visited.current.size > 6)
            visited.current.delete(visited.current.values().next().value!);
        }
      })
      .catch((e) => {
        if (alive)
          setPreviewStatus(
            `Preview details unavailable: ${e instanceof Error ? e.message : String(e)}`,
          );
      });
    return () => {
      alive = false;
      void api.releaseRetained(p.project.id, token).catch(() => {});
    };
  }, [active, selected, p.project.id]);
  const visible = clips.filter(
    (c) =>
      (!folder || c.folder === folder) &&
      [
        c.name,
        c.note,
        c.context,
        c.source,
        c.folder,
        ...c.markers.flatMap((m) => [m.name, m.note || '', m.topic]),
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const open = async (clip: RetainedClip) => {
    const token = ++request.current;
    setError('');
    setAttempted(clip);
    setLoading(clip.exportId);
    window.dispatchEvent(new Event('virtual-cut-pause-workspace'));
    try {
      const value = await window.virtualCut!.project.retainedMedia(p.project.id, clip.exportId);
      if (token !== request.current) return;
      // Keep the existing viewer during verified revisit preparation, then swap
      // the video and its ready timing data together. No pending placeholder frame.
      if (visited.current.has(value.exportId)) {
        const previewToken = crypto.randomUUID();
        try {
          const details = await window.virtualCut!.project.inspectRetained(
            p.project.id,
            value.exportId,
            previewToken,
          );
          if (token !== request.current) {
            await window.virtualCut!.project.releaseRetained(p.project.id, previewToken);
            return;
          }
          prepared.current = { url: value.url!, token: previewToken };
          setPreview(details);
        } catch (e) {
          await window
            .virtualCut!.project.releaseRetained(p.project.id, previewToken)
            .catch(() => {});
          throw e;
        }
      } else setPreview(undefined);
      setSelected(value);
    } catch (e) {
      if (token === request.current) {
        setSelected(undefined);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (token === request.current) setLoading('');
    }
  };
  const relink = (clip: RetainedClip) =>
    background(
      w
        .run(() => window.virtualCut!.project.relinkExport(p.project.id, clip.exportId), true)
        .then((value) => {
          if (value) {
            setFolder('');
            background(open(clip));
          }
        }),
    );
  const record: Recording | undefined = selected
    ? {
        id: selected.exportId,
        poster: '',
        frames: [],
        base: 0,
        duration: selected.duration,
        codec: selected.video,
        fps: selected.fps,
        width: selected.width,
        height: selected.height,
        position: 0,
        sample: false,
        fullResolution: true,
        context: selected.context,
        retained: true,
        sourcePath: selected.output,
        availability: 'pending',
        ...(preview?.id === selected.exportId ? preview : {}),
        // Inspection supplies transient timing and waveform data; verified media
        // grants and the user's title always remain authoritative.
        url: selected.url!,
        title: selected.name,
      }
    : undefined;
  return (
    <section
      className={s.root}
      aria-label="Completed Library"
      onKeyDown={(event) => {
        if (
          event.repeat ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          event.defaultPrevented ||
          !!loading ||
          !selected ||
          (event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]') ||
          document.querySelector('dialog[open]')
        )
          return;
        const key = event.key.toLowerCase();
        if (
          ['j', 'k', 'l', ' '].includes(key) &&
          !(key === ' ' && (event.target as HTMLElement).closest('button'))
        ) {
          event.preventDefault();
          event.stopPropagation();
          transport.current?.command(key);
        }
      }}
    >
      <div className={s.toolbar}>
        <h2>Library</h2>
        <input
          aria-label="Search completed clips"
          placeholder="Search names, markers, notes or source…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Library folder"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
        >
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f || 'Destination root'}
            </option>
          ))}
        </select>
        <span>{visible.length} completed clips</span>
      </div>
      <div className={s.columns}>
        <div className={s.list}>
          {visible.map((c) => (
            <article
              key={c.exportId}
              className={selected?.exportId === c.exportId ? s.selected : ''}
            >
              <button
                data-navigate-item
                className={s.pick}
                aria-label={`Preview completed clip: ${c.name}`}
                aria-disabled={loading === c.exportId}
                aria-busy={loading === c.exportId}
                onClick={() => {
                  if (loading !== c.exportId) background(open(c));
                }}
              >
                <strong>{c.name}</strong>
                <span>
                  {time(c.duration)} · {c.folder || 'Destination root'}
                </span>
                <small>
                  {new Date(c.completedAt).toLocaleString()} ·{' '}
                  {!c.available
                    ? 'Video offline or changed'
                    : !c.metadataAvailable
                      ? 'Metadata offline or changed'
                      : 'Verified'}
                </small>
              </button>
              <div className={s.actions}>
                <Button
                  aria-label={`Show completed clip: ${c.name}`}
                  disabled={!c.available}
                  onClick={() =>
                    background(
                      w.run(
                        () =>
                          window.virtualCut!.project.revealExport(
                            p.project.id,
                            c.exportId,
                            'video',
                          ),
                        true,
                      ),
                    )
                  }
                >
                  <FolderOpen size={16} />
                </Button>
                <Button aria-label={`Relink completed clip: ${c.name}`} onClick={() => relink(c)}>
                  <Link2 size={16} />
                  Relink…
                </Button>
              </div>
            </article>
          ))}
          {!visible.length && (
            <p>
              {clips.length
                ? 'No clips match this search.'
                : 'File accepted clips from Review to build your Library.'}
            </p>
          )}
        </div>
        <div className={s.detail}>
          {error ? (
            <div className={s.unavailable} role="alert">
              <strong>Completed preview unavailable</strong>
              <p>{error}</p>
              {w.error && w.error !== error && <p>{w.error}</p>}
              {attempted && (
                <Button primary onClick={() => relink(attempted)}>
                  Relink completed video…
                </Button>
              )}
            </div>
          ) : (
            w.error && <p role="alert">{w.error}</p>
          )}
          {loading && <p role="status">Verifying the completed file…</p>}
          {record && selected && (
            <>
              <div className={s.viewer}>
                <Player
                  key={selected.exportId}
                  ref={transport}
                  recording={record}
                  projectId={p.project.id}
                  audioStatus={previewStatus}
                  markers={selected.markers}
                  clips={[]}
                  showClips={false}
                  onActivityChange={w.setPlaybackActive}
                  trimEnabled={false}
                  selectedMarkerId={
                    selectedMarker?.clip === selected.exportId ? selectedMarker.id : undefined
                  }
                  onMarkerSelect={(id) => setSelectedMarker({ clip: selected.exportId, id })}
                  onMarkerDeselect={() => setSelectedMarker(undefined)}
                />
              </div>
              <details className={s.facts}>
                <summary>Clip details &amp; markers</summary>
                <p>
                  <strong>Source</strong> {selected.source}
                </p>
                <p>
                  <strong>Finished file</strong> {selected.output}
                </p>
                {selected.note && <p className={s.note}>{selected.note}</p>}
                {selected.context && (
                  <details>
                    <summary>Recording context</summary>
                    <p className={s.note}>{selected.context}</p>
                  </details>
                )}
                <h3>Markers</h3>
                <div className={s.markers}>
                  {[...selected.markers]
                    .sort((a, b) => a.time - b.time)
                    .map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setSelectedMarker({ clip: selected.exportId, id: m.id })}
                        onDoubleClick={() => transport.current?.seek(m.time)}
                        aria-pressed={
                          selectedMarker?.clip === selected.exportId && selectedMarker.id === m.id
                        }
                        title="Select marker; double-click to seek"
                        style={{ borderLeftColor: markerColor(m) }}
                      >
                        <strong>{m.name}</strong>
                        <span>
                          {time(m.time)}
                          {m.end != null ? ` – ${time(m.end)}` : ''} · {m.category}
                        </span>
                        {m.note && <span className={s.note}>{m.note}</span>}
                      </button>
                    ))}
                  {!selected.markers.length && <p>No markers in this completed cut.</p>}
                </div>
              </details>
            </>
          )}
          {!record && !loading && !error && (
            <p>
              Choose a completed clip to preview its retained video and annotations. Originals can
              stay offline.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
