import { useRef, useState } from 'react';
import { FolderOpen, Link2 } from 'lucide-react';
import type { RetainedClip } from '../../electron/export-contracts';
import type { useProjectWorkspace } from './useProjectWorkspace';
import { Player, type Transport } from './Player';
import { Button } from './ui';
import { markerColor, time, type Recording } from './model';
import s from './CompletedLibrary.module.css';
type Workspace = ReturnType<typeof useProjectWorkspace>;
export function CompletedLibrary({ workspace: w }: { workspace: Workspace }) {
  const [query, setQuery] = useState(''),
    [folder, setFolder] = useState(''),
    [selected, setSelected] = useState<RetainedClip>(),
    [attempted, setAttempted] = useState<RetainedClip>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState('');
  const request = useRef(0),
    transport = useRef<Transport>(null);
  const p = w.snapshot!,
    clips = p.library || [],
    folders = [...new Set(clips.map((c) => c.folder))].sort();
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
      if (token === request.current) setSelected(value);
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
    void w
      .run(() => window.virtualCut!.project.relinkExport(p.project.id, clip.exportId), true)
      .then((value) => {
        if (value) {
          setFolder('');
          void open(clip);
        }
      });
  const record: Recording | undefined = selected
    ? {
        id: selected.exportId,
        title: selected.name,
        url: selected.url!,
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
        availability: 'ready',
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
                disabled={loading === c.exportId}
                onClick={() => void open(c)}
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
                    void w.run(
                      () =>
                        window.virtualCut!.project.revealExport(p.project.id, c.exportId, 'video'),
                      true,
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
                  markers={selected.markers}
                  clips={[]}
                  showClips={false}
                  onActivityChange={w.setPlaybackActive}
                  trimEnabled={false}
                  onMarkerSelect={(id) => {
                    const marker = selected.markers.find((m) => m.id === id);
                    if (marker) transport.current?.seek(marker.time);
                  }}
                />
              </div>
              <div className={s.facts}>
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
                  {selected.markers.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => transport.current?.seek(m.time)}
                      style={{ borderLeftColor: markerColor(m) }}
                    >
                      <strong>{m.name}</strong>
                      <span>
                        {time(m.time)} · {m.category}
                      </span>
                      {m.note && <span className={s.note}>{m.note}</span>}
                    </button>
                  ))}
                  {!selected.markers.length && <p>No markers in this completed cut.</p>}
                </div>
              </div>
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
