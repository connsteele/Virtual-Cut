import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Image,
  ImageOff,
  Layers,
  Maximize,
  NotebookPen,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { Brand } from '../components/Brand';
import { pages, type PageId } from '../workspace';
import { useProjectWorkspace } from './useProjectWorkspace';
import {
  ProjectPanel,
  BatchTools,
  RecordingTools,
  ImportPanel,
  SaveHistory,
  RecordingActions,
} from './ProjectPanel';
import { ExportPanel, ExportHistory } from './ExportPanel';
import {
  colors,
  markerColors,
  markerColor,
  markerColorName,
  initialModel,
  invalidate,
  time,
  short,
  uid,
  type Category,
  type Clip,
  type Entry,
  type Marker,
  type MarkerColor,
  type Model,
  type Recording,
} from './model';
import { Player, type Transport } from './Player';
import { SourceFolders } from './SourceFolders';
import { MediaLayout } from './MediaLayout';
import { useMediaDrop } from './useMediaDrop';
import { inSourceFolder } from './sourceFolderTree';
import { mediaSorts, sortMedia, type MediaSort } from './mediaOrder';
import { Library } from './Library';
import { ReviewSignals, HoldReason } from './ReviewSignals';
import { clipColor } from './clipLayout';
import type { MediaJob } from '../../electron/project-contracts';
import { Button, Field, Modal, Thumbnail } from './ui';
import s from './Workflow.module.css';
function currentAudioStatus(jobs: MediaJob[], recording: Recording) {
  const latest = new Map<number, MediaJob>();
  const mode = recording.monitor || 'game';
  const tracks = new Set(
    mode === 'mic'
      ? [recording.micTrack]
      : mode === 'both'
        ? [recording.gameTrack, recording.micTrack]
        : [recording.gameTrack],
  );
  for (const job of jobs) {
    if (job.sourceId !== recording.id || job.kind !== 'audio' || job.track == null) continue;
    if (!tracks.has(job.track)) continue;
    const previous = latest.get(job.track);
    if (!previous || job.updated > previous.updated) latest.set(job.track, job);
  }
  return [...latest.values()].find((job) =>
    ['queued', 'running', 'failed', 'interrupted'].includes(job.state),
  )?.message;
}
function MarkerEditor({
  marks,
  onChange,
  onDelete,
  onSeek,
  onAdd,
  terms,
  canAdd = true,
  selectedId,
  onSelect,
  confirm,
  onConfirm,
}: {
  marks: Marker[];
  onChange: (id: string, patch: Partial<Marker>) => void;
  onDelete: (id: string) => void;
  onSeek: (t: number) => void;
  onAdd: () => void;
  terms: Model['terms'];
  canAdd?: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  confirm: string;
  onConfirm: (id: string) => void;
}) {
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    confirmation.current?.scrollIntoView({
      block: 'nearest',
      behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth',
    });
  }, [confirm]);
  return (
    <section className={s.markerEditor}>
      <h3>Markers</h3>
      {marks.map((m) => (
        <div
          className={`${s.markerRow} ${s.markerCard} ${selectedId === m.id ? s.selected : ''}`}
          key={m.id}
          data-marker-card={m.id}
          data-selected={selectedId === m.id}
          tabIndex={0}
          onClick={() => onSelect(m.id)}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest('button,input,textarea,select')) return;
            onSelect(m.id);
            onSeek(m.time);
          }}
          onFocus={() => onSelect(m.id)}
          onKeyDown={(e) => {
            if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onSelect(m.id);
            }
          }}
        >
          <div className={s.tools}>
            <button
              className={s.markerLabel}
              style={{ color: markerColor(m) }}
              onClick={() => {
                onSelect(m.id);
                onSeek(m.time);
              }}
            >
              ◆{' '}
              <span>
                {m.category} · {time(m.time)}
              </span>
            </button>
            <select
              aria-label="Marker color"
              value={markerColorName(m)}
              style={{ color: markerColor(m) }}
              onChange={(e) => onChange(m.id, { color: e.target.value as MarkerColor })}
            >
              {Object.entries(markerColors).map(([color, hex]) => (
                <option key={color} style={{ color: hex, backgroundColor: '#121a19' }}>
                  {color}
                </option>
              ))}
            </select>
            <Button aria-label={`Delete marker: ${m.name}`} onClick={() => onConfirm(m.id)}>
              <Trash2 size={15} />
            </Button>
          </div>
          <input
            aria-label="Marker name"
            value={m.name}
            onChange={(e) => onChange(m.id, { name: e.target.value })}
          />
          <textarea
            aria-label="Marker note"
            placeholder="Note (optional)"
            rows={2}
            value={m.note || ''}
            onChange={(e) => onChange(m.id, { note: e.target.value })}
          />
          <div className={s.pair}>
            <select
              aria-label="Marker category"
              value={m.category}
              onChange={(e) => onChange(m.id, { category: e.target.value as Category })}
            >
              {Object.keys(colors).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              aria-label="Linked glossary term"
              value={m.topic}
              onChange={(e) => onChange(m.id, { topic: e.target.value })}
            >
              <option value="">No term</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          {confirm === m.id && (
            <div ref={confirmation} className={s.confirm} role="alert" data-delete-confirm>
              <span>Delete this marker?</span>
              <Button
                onClick={() => {
                  onDelete(m.id);
                  onConfirm('');
                }}
              >
                Delete
              </Button>
              <Button onClick={() => onConfirm('')}>Cancel</Button>
            </div>
          )}
        </div>
      ))}
      {!marks.length && <p className={s.muted}>No markers in this clip.</p>}
      <Button
        onClick={onAdd}
        disabled={!canAdd}
        title={!canAdd ? 'Wait for playable footage to add a timed marker' : undefined}
      >
        <Plus size={15} /> Marker
      </Button>
    </section>
  );
}
function FolderBranch({
  paths,
  parent = '',
  onChoose,
}: {
  paths: string[];
  parent?: string;
  onChoose: (path: string) => void;
}) {
  const names = [
    ...new Set(
      paths
        .filter((p) => !parent || p.startsWith(parent + '/'))
        .map((p) => p.slice(parent ? parent.length + 1 : 0).split('/')[0]),
    ),
  ];
  return (
    <>
      {names.map((name) => {
        const path = parent ? parent + '/' + name : name;
        return paths.some((p) => p.startsWith(path + '/')) ? (
          <details key={path} open>
            <summary>{name}</summary>
            <Button onClick={() => onChoose(path)}>Use {name}</Button>
            <div className={s.branch}>
              <FolderBranch paths={paths} parent={path} onChoose={onChoose} />
            </div>
          </details>
        ) : (
          <Button key={path} onClick={() => onChoose(path)}>
            <FolderOpen size={14} />
            {name}
          </Button>
        );
      })}
    </>
  );
}
function FolderPicker({
  model,
  clips,
  onClose,
  onApply,
}: {
  model: Model;
  clips: string[];
  onClose: () => void;
  onApply: (path: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [parent, setParent] = useState(model.clips.find((c) => c.id === clips[0])?.folder || '_Review'),
    [creating, setCreating] = useState(false),
    [name, setName] = useState(''),
    [error, setError] = useState('');
  return (
    <Modal
      title={`Destination for ${clips.length} clip${clips.length === 1 ? '' : 's'}`}
      onClose={onClose}
    >
      <Field label="Find a folder">
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </Field>
      <div className={s.folderList}>
        <FolderBranch
          paths={model.folders.filter((f) => f.toLowerCase().includes(query.toLowerCase()))}
          onChoose={setParent}
        />
      </div>
      <p>
        {parent}
        {creating && name ? '/' + name : ''}
      </p>
      <Button onClick={() => setCreating(!creating)}>
        <FolderPlus size={16} /> New folder here
      </Button>
      {creating && (
        <Field label="New folder name">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <div className={s.toolbar}>
        <span className={s.muted}>Destination plan only · no files move</span>
        <Button
          primary
          onClick={() => {
            const n = name.trim();
            if (
              creating &&
              (!n ||
                /^[.]|[<>:"/\\|?*]|[. ]$/.test(n) ||
                /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(n))
            ) {
              setError('Use a valid Windows folder name.');
              return;
            }
            onApply(parent + (creating ? '/' + n : ''));
          }}
        >
          Assign folder
        </Button>
      </div>
    </Modal>
  );
}
function ReviewLayout({ children, held }: { children: ReactNode; held?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = panel.current!;
    const container = el.closest<HTMLElement>('[data-scroll]')!;
    const card = el.closest('article')!;
    const heading = [...card.children].filter((child) => child !== el.parentElement);
    const fit = () => {
      const headingHeight = heading.reduce(
        (sum, child) => sum + child.getBoundingClientRect().height,
        0,
      );
      // Reserve the whole shared transport/marker strip and a little scroll padding.
      // A fixed chrome allowance avoids thumbnail reflow feeding back into its own width.
      const stageHeight = Math.max(180, container.clientHeight - headingHeight - 290);
      const width = Math.min(el.clientWidth * 0.59, (stageHeight * 16) / 9);
      el.style.setProperty('--review-video-width', `${Math.max(400, Math.floor(width))}px`);
      const player = el.querySelector<HTMLElement>('[aria-label="Footage viewer"]');
      const stage = el.querySelector<HTMLElement>('[data-video-stage]');
      if (player && stage) {
        const chrome = player.getBoundingClientRect().height - stage.getBoundingClientRect().height;
        const available = container.clientHeight - headingHeight - chrome - 32;
        const height = Math.min((stage.clientWidth * 9) / 16, Math.max(80, available));
        el.style.setProperty('--review-stage-height', `${Math.floor(height)}px`);
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    observer.observe(el);
    heading.forEach((child) => observer.observe(child));
    fit();
    return () => observer.disconnect();
  }, [held]);
  return (
    <div ref={panel} className={s.reviewPreview}>
      {children}
    </div>
  );
}
function Expansion({ children }: { children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = panel.current!,
      card = el.closest('article')!,
      container = el.closest('[data-scroll]')!;
    const reduce = document.hidden || matchMedia('(prefers-reduced-motion:reduce)').matches;
    const reveal = (immediate = false) => {
      if (!el.isConnected) return;
      const a = card.getBoundingClientRect(),
        b = container.getBoundingClientRect();
      const finalHeight = a.height - el.getBoundingClientRect().height + el.scrollHeight;
      const offset =
        finalHeight > b.height - 24
          ? a.top - b.top - 8
          : a.top + finalHeight > b.bottom
            ? a.top + finalHeight - b.bottom + 12
            : a.top < b.top
              ? a.top - b.top - 8
              : 0;
      if (offset)
        container.scrollBy({ top: offset, behavior: reduce || immediate ? 'instant' : 'smooth' });
    };
    const animation = reduce
      ? null
      : el.animate(
          [
            { height: '0px', opacity: 0 },
            { height: el.scrollHeight + 'px', opacity: 1 },
          ],
          { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)' },
        );
    // Refit after metadata, thumbnail layout or window dimensions settle.
    // Observing size (not scroll position) leaves ordinary user scrolling alone.
    let revealTimer: ReturnType<typeof setTimeout>;
    const readyAt = performance.now() + (reduce ? 0 : 240);
    const schedule = () => {
      clearTimeout(revealTimer);
      revealTimer = setTimeout(
        () => {
          const unpainted = animation?.currentTime === 0;
          animation?.finish();
          reveal(unpainted);
        },
        Math.max(80, readyAt - performance.now()),
      );
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    observer.observe(container);
    schedule();
    return () => {
      observer.disconnect();
      clearTimeout(revealTimer);
      animation?.cancel();
    };
  }, []);
  return (
    <div ref={panel} className={s.expansion}>
      {children}
    </div>
  );
}
export function Workbench({ onFoundation }: { onFoundation: () => void }) {
  const workspace = useProjectWorkspace();
  const { model, setModel, snapshot: project } = workspace;
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [exportClipId, setExportClipId] = useState(''),
    [exportsOpen, setExportsOpen] = useState(false);
  const [importing, setImporting] = useState(false),
    [savesOpen, setSavesOpen] = useState(false),
    [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [handleMode, setHandleMode] = useState(false);
  const trimming = useRef(false);
  const [page, setPage] = useState<PageId>('cut'),
    [rid, setRid] = useState('r1'),
    [cid, setCid] = useState('c1'),
    [opening, setOpening] = useState(false),
    [thumbs, setThumbs] = useState(true),
    [follow, setFollow] = useState(
      () => localStorage.getItem('virtual-cut.selection-follows') !== 'false',
    ),
    [legend, setLegend] = useState(
      () => localStorage.getItem('virtual-cut.marker-legend') !== 'false',
    ),
    [deleteClipId, setDeleteClipId] = useState(''),
    [mid, setMid] = useState(''),
    [renameMarkerId, setRenameMarkerId] = useState(''),
    [deleteMarkerId, setDeleteMarkerId] = useState(''),
    [drawer, setDrawer] = useState(''),
    [agent, setAgent] = useState('Copilot'),
    [notice, setNotice] = useState(''),
    [dialog, setDialog] = useState(''),
    [folderIds, setFolderIds] = useState<string[]>([]),
    [reviewFilter, setReviewFilter] = useState('Remaining'),
    [expanded, setExpanded] = useState(''),
    [reviewTree, setReviewTree] = useState(false),
    [folderFilter, setFolderFilter] = useState(''),
    [sourceFolderFilter, setSourceFolderFilter] = useState(''),
    [checked, setChecked] = useState<string[]>([]),
    [mediaList, setMediaList] = useState(false),
    [pool, setPool] = useState<string[]>(['c1', 'c3']),
    [sequenceName, setSequenceName] = useState('Character observations'),
    [sequenceMode, setSequenceMode] = useState('Selects'),
    [eid, setEid] = useState('e1'),
    [playingSequence, setPlayingSequence] = useState(false),
    [handles, setHandles] = useState(0),
    [target, setTarget] = useState('tl1'),
    [newTarget, setNewTarget] = useState(false),
    [skipDuplicates, setSkipDuplicates] = useState(true),
    [notes, setNotes] = useState(() => {
      try {
        return localStorage.getItem('virtual-cut.scratchpad.v1') || '';
      } catch {
        return '';
      }
    });
  const mediaDrop = useMediaDrop(workspace, page === 'media');
  const [mediaSort, setMediaSort] = useState<MediaSort>(() => {
    const saved = localStorage.getItem('virtual-cut.media-sort');
    return saved && Object.hasOwn(mediaSorts, saved) ? (saved as MediaSort) : 'date-asc';
  });
  const transport = useRef<Transport>(null),
    dragging = useRef('');
  const markerRecord = useRef(''),
    markerSeek = useRef<number | null>(null);
  function selectClip(id: string) {
    setCid(id);
    setMid('');
    markerSeek.current = null;
  }
  function selectMarker(id: string, recordId = r.id) {
    setMid(id);
    markerRecord.current = recordId;
    markerSeek.current = model.markers[recordId]?.find((m) => m.id === id)?.time ?? null;
  }
  useLayoutEffect(() => {
    if (!renameMarkerId) return;
    const card = [...document.querySelectorAll<HTMLElement>('[data-marker-card]')].find(
      (el) => el.dataset.markerCard === renameMarkerId,
    );
    const input = card?.querySelector<HTMLInputElement>('input[aria-label="Marker name"]');
    if (input) {
      input.focus({ preventScroll: true });
      input.select();
      card?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      setRenameMarkerId('');
    }
  }, [renameMarkerId, model.markers]);
  useEffect(() => {
    const id = mid || cid;
    if (!id || page !== 'cut') return;
    const selector = mid ? '[data-marker-card]' : '[data-cut-clip]';
    const card = [...document.querySelectorAll<HTMLElement>(selector)].find(
      (el) => (mid ? el.dataset.markerCard : el.dataset.cutClip) === id,
    );
    const container = card?.closest<HTMLElement>('aside');
    if (
      !card ||
      !container ||
      (container.contains(document.activeElement) &&
        document.activeElement?.matches('input,textarea,select'))
    )
      return;
    const rect = card.getBoundingClientRect(),
      area = container.getBoundingClientRect();
    if (rect.top < area.top || rect.bottom > area.bottom)
      card.scrollIntoView({
        block: 'center',
        behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth',
      });
  }, [cid, mid, page]);
  useEffect(() => {
    if (!deleteClipId && !deleteMarkerId) return;
    document
      .querySelector<HTMLElement>('[data-delete-confirm] button')
      ?.focus({ preventScroll: true });
  }, [deleteClipId, deleteMarkerId]);
  useEffect(() => {
    const pause = () => transport.current?.command('pause');
    window.addEventListener('virtual-cut-pause-workspace', pause);
    return () => window.removeEventListener('virtual-cut-pause-workspace', pause);
  }, []);
  useEffect(() => {
    if (dialog || folderIds.length) transport.current?.command('pause');
  }, [dialog, folderIds]);
  const recordings = project
    ? model.recordings.filter((x) => x.batchIds?.includes(project.activeBatchId))
    : model.recordings;
  const activeSourceFolder = recordings.some((x) => inSourceFolder(x, sourceFolderFilter))
    ? sourceFolderFilter
    : '';
  const mediaRecords = sortMedia(
    recordings.filter((x) => inSourceFolder(x, activeSourceFolder)),
    mediaSort,
  );
  const r =
    recordings.find((r) => r.id === model.selectedRecordingId) ||
    recordings.find((r) => r.id === rid) ||
    recordings[0] ||
    ({
      id: '',
      title: '',
      url: '',
      poster: '',
      frames: [],
      base: 0,
      duration: 0,
      position: 0,
      sample: false,
      context: '',
    } as Recording);
  const clips = model.clips.filter((c) => c.rid === r.id),
    c = mid ? undefined : clips.find((c) => c.id === cid);
  const e = model.sequence.find((e) => e.id === eid) || model.sequence[0];
  useEffect(() => {
    try {
      localStorage.setItem('virtual-cut.scratchpad.v1', notes);
    } catch {
      setNotice('Scratch notes could not be saved.');
    }
  }, [notes]);
  useEffect(() => {
    localStorage.setItem('virtual-cut.selection-follows', String(follow));
    localStorage.setItem('virtual-cut.marker-legend', String(legend));
  }, [follow, legend]);
  const projectKey = project?.project.id || 'sample',
    batchKey = project?.activeBatchId || 'sample';
  const projectContext = useRef(projectKey + batchKey);
  useEffect(() => {
    if (projectContext.current === projectKey + batchKey) return;
    projectContext.current = projectKey + batchKey;
    setExpanded('');
    setChecked([]);
    setFolderFilter('');
    setSourceFolderFilter('');
    setCid('');
    setMid('');
    setDeleteClipId('');
    setDeleteMarkerId('');
    setPlayingSequence(false);
    setPool([]);
  }, [projectKey, batchKey]);
  async function history(direction: 'undo' | 'redo') {
    if (!project) return;
    transport.current?.command('pause');
    await workspace.run(
      () => window.virtualCut!.project.history(project.project.id, direction),
      true,
    );
  }
  function inspectReview(clip: Clip, field = '') {
    transport.current?.command('pause');
    setExpanded(clip.id);
    updateRecording(clip.rid, { position: clip.start });
    if (field)
      setTimeout(() => {
        const card = document.querySelector(`[data-card="${clip.id}"]`);
        const element = card?.querySelector<HTMLElement>(
          `[data-review-field="${field}"] input, [data-review-field="${field}"] textarea, [data-review-field="${field}"] button`,
        );
        element?.focus({ preventScroll: true });
        element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 280);
  }
  function removeClip(id: string) {
    setModel((m) => ({
      ...m,
      clips: m.clips.filter((c) => c.id !== id),
      links: m.links.filter((l) => l.from !== id && l.to !== id),
      sequence: m.sequence.filter((e) => e.cid !== id),
    }));
    setChecked((ids) => ids.filter((x) => x !== id));
    setPool((ids) => ids.filter((x) => x !== id));
    if (cid === id) setCid('');
    setDeleteClipId('');
  }
  function updateRecording(id: string, patch: Partial<Recording>) {
    setModel((m) => ({
      ...m,
      recordings: m.recordings.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }
  function updateClip(id: string, patch: Partial<Clip>, invalidateReview = true) {
    setModel((m) => ({
      ...m,
      clips: m.clips.map((c) =>
        c.id === id ? { ...(invalidateReview ? invalidate(c) : c), ...patch } : c,
      ),
    }));
  }
  function editMarker(id: string, patch: Partial<Marker>, recordId = r.id) {
    setModel((m) => ({
      ...m,
      markers: {
        ...m.markers,
        [recordId]: (m.markers[recordId] || []).map((x) => (x.id === id ? { ...x, ...patch } : x)),
      },
      clips: m.clips.map((c) => (c.rid === recordId ? invalidate(c) : c)),
    }));
  }
  function deleteMarker(id: string, recordId = r.id) {
    setModel((m) => ({
      ...m,
      markers: { ...m.markers, [recordId]: (m.markers[recordId] || []).filter((x) => x.id !== id) },
      clips: m.clips.map((c) => (c.rid === recordId ? invalidate(c) : c)),
      links: m.links.filter((l) => l.from !== id && l.to !== id),
    }));
    if (mid === id) setMid('');
    setDeleteMarkerId('');
  }
  function addMarker(recordId = r.id) {
    if (project && !canEdit) return;
    const position = transport.current?.current() || 0,
      id = uid();
    setModel((m) => ({
      ...m,
      markers: {
        ...m.markers,
        [recordId]: [
          ...(m.markers[recordId] || []),
          {
            id,
            time: position,
            name: 'New marker',
            category: 'Context' as const,
            color: 'Blue' as const,
            topic: '',
          },
        ].sort((a, b) => a.time - b.time),
      },
      clips: m.clips.map((c) => (c.rid === recordId ? invalidate(c) : c)),
    }));
    setMid(id);
    markerRecord.current = recordId;
    markerSeek.current = position;
    transport.current?.command('pause');
    setRenameMarkerId(id);
  }
  function selectRecord(id: string) {
    transport.current?.command('pause');
    setRid(id);
    setMid('');
    setDeleteClipId('');
    setDeleteMarkerId('');
    markerSeek.current = null;
    setModel((m) => ({ ...m, selectedRecordingId: id }));
    const position = model.recordings.find((r) => r.id === id)?.position || 0;
    setCid(
      model.clips.find((c) => c.rid === id && c.start <= position && c.end > position)?.id ||
        model.clips.find((c) => c.rid === id)?.id ||
        '',
    );
  }
  function addClip() {
    if (!r.duration) return;
    const start = Math.min(r.duration - 0.1, transport.current?.current() || 0),
      id = uid();
    setModel((m) => ({
      ...m,
      clips: [
        ...m.clips,
        {
          id,
          rid: r.id,
          name: 'New clip',
          originalName: r.title,
          originalFolder: model.clips.find((x) => x.rid === r.id)?.originalFolder || '_Review',
          start,
          end: Math.min(r.duration, start + Math.max(1, r.duration * 0.15)),
          include: true,
          folder: '_Review',
        },
      ],
    }));
    selectClip(id);
  }
  function trim(edge: 'start' | 'end') {
    if (!canEdit) return;
    if (!c) {
      setNotice('Select a clip to trim.');
      return;
    }
    const t = transport.current?.current() || 0;
    if ((edge === 'start' && t < c.end - 0.02) || (edge === 'end' && t > c.start + 0.02))
      updateClip(c.id, { [edge]: t });
    else setNotice('The out point must follow the in point.');
  }
  function split() {
    if (!canEdit) return;
    const t = transport.current?.current() || 0,
      clip = c;
    if (!clip || t <= clip.start + 0.02 || t >= clip.end - 0.02) {
      setNotice('Place the playhead inside the selected clip to split it.');
      return;
    }
    const id = uid();
    setModel((m) => ({
      ...m,
      clips: m.clips.flatMap((c) =>
        c.id === clip.id
          ? [
              { ...invalidate(c), end: t },
              { ...invalidate(c), id, name: c.name + ' · Part 2', start: t },
            ]
          : [c],
      ),
    }));
    selectClip(id);
  }
  function addSelect(id: string) {
    const c = model.clips.find((c) => c.id === id);
    if (!c) return;
    const entry = { id: uid(), cid: c.id, rid: c.rid, name: c.name, start: c.start, end: c.end };
    setModel((m) => ({ ...m, sequence: [...m.sequence, entry] }));
    setEid(entry.id);
    setNotice('Added to ' + sequenceName);
  }
  function go(next: PageId) {
    transport.current?.command('pause');
    setPlayingSequence(false);
    setNotice('');
    setPage(next);
    setFolderFilter('');
  }
  async function fullscreen() {
    try {
      await window.virtualCut?.toggleFullscreen();
    } catch {
      setNotice('Fullscreen could not be toggled. Maximize the window using the title bar.');
    }
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat) return;
      if (e.key === 'F11') {
        e.preventDefault();
        void fullscreen();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void workspace.checkpoint();
        return;
      }
      const editing = (e.target as HTMLElement).closest(
        'input:not([type=range]):not([type=checkbox]),textarea,select,[contenteditable=true]',
      );
      if (
        editing &&
        e.key === 'Enter' &&
        editing.matches('input[aria-label="Clip name"],input[aria-label="Marker name"]')
      ) {
        e.preventDefault();
        (editing as HTMLElement).blur();
        return;
      }
      if (document.querySelector('dialog[open]') || editing) return;
      if (e.ctrlKey && !e.shiftKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        if (page === 'review') {
          const cards = [...document.querySelectorAll<HTMLElement>('[data-card]')],
            index = cards.findIndex((el) => el.dataset.card === expanded);
          const card =
            cards[
              Math.max(0, Math.min(cards.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))
            ];
          const clip = model.clips.find((x) => x.id === card?.dataset.card);
          if (clip) inspectReview(clip);
          return;
        }
        if (page !== 'cut' && page !== 'media') {
          const buttons = [...document.querySelectorAll<HTMLElement>('main [data-navigate-item]')],
            index = buttons.indexOf(document.activeElement as HTMLElement);
          const button =
            buttons[
              Math.max(0, Math.min(buttons.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))
            ];
          button?.focus();
          button?.click();
          button?.scrollIntoView({ block: 'nearest' });
          return;
        }
        if (!recordings.length) return;
        const candidates = page === 'media' ? mediaRecords : recordings;
        if (!candidates.length) return;
        const index = candidates.findIndex((x) => x.id === r.id);
        selectRecord(
          candidates[
            Math.max(0, Math.min(candidates.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))
          ].id,
        );
        return;
      }
      if (e.ctrlKey && ['z', 'y'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        void history(e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || !r.id || workspace.busy) return;
      const k = e.key.toLowerCase();
      if (page === 'cut' && k === 'h') {
        e.preventDefault();
        setHandleMode((value) => !value);
        return;
      }
      if (
        (page === 'cut' || page === 'review') &&
        (deleteClipId || deleteMarkerId) &&
        (e.key === 'Enter' || e.key === 'Escape')
      ) {
        e.preventDefault();
        if (e.key === 'Enter') {
          if (deleteMarkerId) deleteMarker(deleteMarkerId, markerRecord.current);
          else removeClip(deleteClipId);
        } else {
          setDeleteClipId('');
          setDeleteMarkerId('');
        }
        return;
      }
      if ((page === 'cut' || page === 'review') && (k === 'r' || e.key === 'Backspace')) {
        const card = [
          ...document.querySelectorAll<HTMLElement>(mid ? '[data-marker-card]' : '[data-cut-clip]'),
        ].find((el) => (mid ? el.dataset.markerCard : el.dataset.cutClip) === (mid || cid));
        if (!card) return;
        e.preventDefault();
        if (k === 'r') {
          const input = card.querySelector<HTMLInputElement>(
            mid ? 'input[aria-label="Marker name"]' : 'input[aria-label="Clip name"]',
          );
          input?.focus();
          input?.select();
        } else if (mid) {
          setDeleteClipId('');
          setDeleteMarkerId(mid);
        } else {
          setDeleteMarkerId('');
          setDeleteClipId(cid);
        }
        return;
      }
      if (
        ['j', 'k', 'l', ' '].includes(k) &&
        !(k === ' ' && (e.target as HTMLElement).closest('button,input[type=checkbox]'))
      ) {
        e.preventDefault();
        transport.current?.command(k);
      }
      if (page === 'cut' && ['q', 'w', 'm', 's'].includes(k)) {
        e.preventDefault();
        if (k === 'm') addMarker();
        else if (k === 's') split();
        else trim(k === 'q' ? 'start' : 'end');
      }
    }
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
  async function openVideo() {
    if (project) {
      setImporting(true);
      return;
    }
    if (!window.virtualCut) {
      setNotice('Use the Electron app to open local footage.');
      return;
    }
    setOpening(true);
    try {
      const video = await window.virtualCut.openVideo();
      if (video) {
        const id = 'local-' + video.id;
        transport.current?.command('pause');
        setModel((m) => ({
          ...m,
          recordings: [
            ...m.recordings.filter((r) => r.sample),
            {
              id,
              title: video.name,
              url: video.url,
              poster: '',
              frames: [],
              base: 0,
              duration: 0,
              position: 0,
              sample: false,
              context: '',
            },
          ],
          clips: m.clips.filter((c) => m.recordings.find((r) => r.id === c.rid)?.sample),
          markers: {
            ...Object.fromEntries(
              Object.entries(m.markers).filter(
                ([id]) => m.recordings.find((r) => r.id === id)?.sample,
              ),
            ),
            [id]: [],
          },
          sequence: m.sequence.filter((e) => m.recordings.find((r) => r.id === e.rid)?.sample),
        }));
        setRid(id);
        setModel((m) => ({ ...m, selectedRecordingId: id }));
        setCid('');
        go('cut');
        setNotice('Local video draft · session only. Exports and source changes are not enabled.');
      }
    } catch {
      setNotice('The video could not be opened. Choose a completed, readable recording.');
    } finally {
      setOpening(false);
    }
  }
  const player = (record: Recording, bounds?: { start: number; end: number }, sequence = false) =>
    project && record.availability !== 'ready' ? (
      <div className={s.empty}>
        <h3>{record.title}</h3>
        <p>
          {record.availability === 'pending'
            ? 'Inspecting this recording…'
            : `Recording ${record.availability}. Open Source & audio to relink, or Jobs to retry.`}
        </p>
      </div>
    ) : (
      <Player
        key={sequence ? eid : page === 'review' ? expanded : page}
        ref={transport}
        onActivityChange={workspace.setPlaybackActive}
        recording={record}
        projectId={project?.project.id}
        bounds={bounds}
        selectedId={mid ? undefined : cid}
        selectedMarkerId={mid}
        onMarkerSelect={(id) => selectMarker(id, record.id)}
        onMarkerDeselect={() => {
          setMid('');
          setDeleteMarkerId('');
          markerSeek.current = null;
        }}
        onAudioChange={(patch) => updateRecording(record.id, patch)}
        audioStatus={currentAudioStatus(project?.jobs || [], record)}
        showClips={page === 'cut' || page === 'selects'}
        handleMode={page === 'cut' && handleMode && canEdit && !workspace.blocking}
        trimEnabled={!workspace.busy}
        onTrimActive={(active) => {
          trimming.current = active;
        }}
        onTrim={(id, edge, value) => {
          // A seek notification can arrive after pointer-up, before React has
          // rendered the new extent. Keep that notification from selecting a
          // different overlapping clip using the previous extent.
          markerSeek.current = value;
          updateClip(id, { [edge]: value });
        }}
        legend={legend}
        onLegend={() => setLegend(!legend)}
        markers={model.markers[record.id] || []}
        clips={model.clips.filter((c) => c.rid === record.id)}
        onPosition={(position) => {
          if (page === 'cut' && record.id === r.id && follow && !trimming.current) {
            const under =
              clips.find((x) => x.id === cid && position >= x.start && position < x.end) ||
              clips.find((x) => position >= x.start && position < x.end);
            if (
              under &&
              (markerSeek.current == null || Math.abs(position - markerSeek.current) > 0.1)
            ) {
              if (under.id !== cid) setMid('');
              setCid(under.id);
            }
          }
          setModel((m) => {
            const current = m.recordings.find((r) => r.id === record.id);
            return !current || Math.abs(current.position - position) < 0.02
              ? m
              : {
                  ...m,
                  recordings: m.recordings.map((r) =>
                    r.id === record.id ? { ...r, position } : r,
                  ),
                };
          });
        }}
        onDuration={(duration) => {
          if (project) return;
          setModel((m) => {
            const current = m.recordings.find((r) => r.id === record.id);
            return !current || current.duration === duration
              ? m
              : {
                  ...m,
                  recordings: m.recordings.map((r) =>
                    r.id === record.id ? { ...r, duration } : r,
                  ),
                };
          });
        }}
        onSelect={selectClip}
        onPlayable={setCanEdit}
        onFrame={(pinned) => updateRecording(record.id, { pinned })}
        autoPlay={sequence && playingSequence}
        onEnded={
          sequence
            ? () => {
                if (!playingSequence) return;
                const i = model.sequence.findIndex((x) => x.id === eid);
                const next = model.sequence[i + 1];
                if (next) {
                  updateRecording(next.rid, { position: Math.max(0, next.start - handles) });
                  setEid(next.id);
                } else setPlayingSequence(false);
              }
            : undefined
        }
      />
    );
  const markerEditor = (recordId: string, clip?: Clip) => (
    <MarkerEditor
      marks={(model.markers[recordId] || []).filter(
        (m) => !clip || (m.time >= clip.start && m.time < clip.end),
      )}
      terms={model.terms}
      canAdd={!project || canEdit}
      selectedId={mid}
      onSelect={(id) => selectMarker(id, recordId)}
      confirm={deleteMarkerId}
      onConfirm={(id) => {
        if (id) {
          selectMarker(id, recordId);
          setDeleteClipId('');
        }
        setDeleteMarkerId(id);
      }}
      onChange={(id, p) => editMarker(id, p, recordId)}
      onDelete={(id) => deleteMarker(id, recordId)}
      onSeek={(t) => {
        transport.current?.command('pause');
        transport.current?.seek(t);
      }}
      onAdd={() => addMarker(recordId)}
    />
  );
  const batchClips = model.clips.filter((c) => recordings.some((r) => r.id === c.rid));
  const readyQueue = batchClips.filter((c) => c.accepted && !c.held && !c.filed);
  const filtered = batchClips
    .filter(
      (c) =>
        reviewFilter === 'All' ||
        (reviewFilter === 'Held' && c.held) ||
        (reviewFilter === 'Done' && c.filed) ||
        (reviewFilter === 'Queue' && c.accepted && !c.held && !c.filed) ||
        (reviewFilter === 'Remaining' && (!c.accepted || c.held) && !c.filed),
    )
    .filter(
      (c) => !folderFilter || c.folder === folderFilter || c.folder.startsWith(folderFilter + '/'),
    );
  const effective = (e: Entry) => ({
    ...e,
    start: Math.max(0, e.start - handles),
    end: Math.min(model.recordings.find((r) => r.id === e.rid)?.duration || e.end, e.end + handles),
  });
  const currentTarget = model.targets.find((t) => t.id === target) ||
    model.targets[0] || { id: '', name: '', duration: 0, items: [] };
  const seen = new Set(
    (newTarget ? [] : currentTarget.items).map(
      (e) => `${e.rid}:${e.start.toFixed(3)}:${e.end.toFixed(3)}`,
    ),
  );
  let skipped = 0;
  const handoff = model.sequence.map(effective).filter((e) => {
    const k = `${e.rid}:${e.start.toFixed(3)}:${e.end.toFixed(3)}`;
    if (skipDuplicates && seen.has(k)) {
      skipped++;
      return false;
    }
    seen.add(k);
    return true;
  });
  function moveEntry(id: string, by: number) {
    setPlayingSequence(false);
    setModel((m) => {
      const sequence = [...m.sequence],
        i = sequence.findIndex((e) => e.id === id),
        j = i + by;
      if (j >= 0 && j < sequence.length) [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
      return { ...m, sequence };
    });
  }
  function trimEntry(id: string, edge: 'start' | 'end', value: number) {
    setPlayingSequence(false);
    setModel((m) => ({
      ...m,
      sequence: m.sequence.map((e) => {
        const duration = m.recordings.find((r) => r.id === e.rid)!.duration;
        if (
          e.id !== id ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > duration ||
          (edge === 'start' ? value >= e.end - 0.02 : value <= e.start + 0.02)
        )
          return e;
        return { ...e, [edge]: value };
      }),
    }));
  }
  return (
    <div className={s.shell} data-workflow="preview" aria-busy={workspace.busy}>
      <header className={s.header}>
        <div className={s.brand}>
          <Brand />
          <strong>Virtual Cut</strong>
        </div>
        <h1>{pages.find((p) => p.id === page)!.label}</h1>
        <Button onClick={() => setProjectsOpen(true)} aria-label="Projects">
          <FolderOpen size={17} />
          {project?.project.name || 'Fortune’s Weave · sample'}
          <ChevronDown size={13} />
        </Button>
        <div className={s.headerActions}>
          <span
            className={project ? s.saveIndicator : s.badge}
            role={project ? 'status' : undefined}
          >
            {project ? workspace.saveState : 'UI preview'}
          </span>
          {project && (
            <>
              <Button
                disabled={workspace.blocking}
                onClick={() => void workspace.checkpoint()}
                title="Save a manual checkpoint (Ctrl+S)"
              >
                Save
              </Button>
              <Button disabled={workspace.blocking} onClick={() => setSavesOpen(true)}>
                Save history
              </Button>
              <Button
                disabled={workspace.blocking || (!project.canUndo && !workspace.hasPendingEdits)}
                onClick={() => void history('undo')}
                title="Undo (Ctrl+Z)"
              >
                Undo
              </Button>
              <Button
                disabled={workspace.blocking || !project.canRedo}
                onClick={() => void history('redo')}
                title="Redo (Ctrl+Shift+Z)"
              >
                Redo
              </Button>
            </>
          )}
          <Button onClick={openVideo} disabled={opening || workspace.blocking}>
            {opening ? 'Opening…' : project ? 'Import' : 'Open video'}
          </Button>
          <Button onClick={fullscreen} aria-label="Fullscreen (F11)">
            <Maximize size={16} />
          </Button>
          <Button
            aria-expanded={drawer === 'Notes'}
            onClick={() => setDrawer(drawer === 'Notes' ? '' : 'Notes')}
          >
            <NotebookPen size={16} /> Notes
          </Button>
          <Button
            aria-expanded={drawer === 'Agent'}
            onClick={() => setDrawer(drawer === 'Agent' ? '' : 'Agent')}
          >
            <Sparkles size={16} /> Agent
          </Button>
          <Button onClick={() => setDialog('settings')} aria-label="Preview options">
            <RotateCcw size={16} />
          </Button>
        </div>
      </header>
      <div className={s.workspace}>
        <main id="workspace" className={s.page} data-page={page} {...mediaDrop.handlers}>
          {mediaDrop.content}
          {(project || page !== 'library') && (
            <div className={s.toolbar}>
              {project ? (
                <BatchTools workspace={workspace} />
              ) : (
                <>
                  <span className={s.batch}>
                    <Layers size={17} /> {r.sample ? 'Full-resolution demo' : 'Local preview'}
                  </span>
                  <span className={s.muted}>
                    {page === 'review'
                      ? 'User Review'
                      : page === 'selects'
                        ? 'Sequence plan'
                        : r.sample
                          ? 'Six original-resolution videos · local edits'
                          : 'Session draft'}
                  </span>
                </>
              )}
              <span className={s.spacer} />
              {project && <Button onClick={() => setExportsOpen(true)}>Exports</Button>}
              {page === 'cut' && (
                <Button
                  primary
                  disabled={!!project && (!c || r.availability !== 'ready' || workspace.blocking)}
                  onClick={() => (project ? setExportClipId(c!.id) : setDialog('export'))}
                >
                  {project ? 'Export selected clip' : `Export ${clips.length} clips`}
                </Button>
              )}
              {page === 'selects' && (
                <Button
                  primary
                  disabled={!!project}
                  onClick={() => {
                    setPlayingSequence(false);
                    transport.current?.command('pause');
                    setDialog('handoff');
                  }}
                >
                  Resolve handoff
                </Button>
              )}
            </div>
          )}
          {project && !recordings.length && (
            <div className={s.empty}>
              <h2>Bring recordings into this batch</h2>
              <p>
                Use Import files or Import folder above, or drop videos onto the Media page. Your
                project saves automatically.
              </p>
            </div>
          )}
          {page === 'cut' && !!r.id && (
            <div className={`${s.cut} ${thumbs ? s.cutThumbs : ''}`}>
              <aside className={s.rail}>
                <div className={s.tools}>
                  <h3>Batch recordings</h3>
                  <Button onClick={() => setThumbs(!thumbs)} aria-label="Toggle thumbnails">
                    {thumbs ? <ImageOff size={16} /> : <Image size={16} />}
                  </Button>
                </div>
                {recordings.map((x) => (
                  <div
                    data-recording={x.id}
                    className={`${s.source} ${x.id === r.id ? s.selected : ''}`}
                    key={x.id}
                    tabIndex={0}
                    aria-label={`Recording: ${x.title}`}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && ['Enter', ' '].includes(e.key)) {
                        e.preventDefault();
                        selectRecord(x.id);
                      }
                    }}
                    onClick={() => selectRecord(x.id)}
                  >
                    {thumbs && <Thumbnail src={x.pinned || x.poster} alt={x.title} />}
                    <strong>{x.title}</strong>
                    <span>
                      {short(x.duration)} · {model.clips.filter((c) => c.rid === x.id).length} clips
                      · {(model.markers[x.id] || []).length} markers
                    </span>
                    <RecordingActions recording={x} workspace={workspace} />
                  </div>
                ))}
                <p className={s.muted}>Ctrl ↑ / ↓ · Batch</p>
              </aside>
              <div className={s.cutCenter}>
                {player(r)}
                <div className={s.tools}>
                  <Button
                    onClick={() => trim('start')}
                    disabled={!c || !canEdit}
                    title={
                      !canEdit
                        ? 'Wait for playable footage'
                        : !c
                          ? 'Select a clip first'
                          : 'Set selected clip in point (Q)'
                    }
                  >
                    Q · In
                  </Button>
                  <Button
                    onClick={() => trim('end')}
                    disabled={!c || !canEdit}
                    title={
                      !canEdit
                        ? 'Wait for playable footage'
                        : !c
                          ? 'Select a clip first'
                          : 'Set selected clip out point (W)'
                    }
                  >
                    W · Out
                  </Button>
                  <Button
                    onClick={split}
                    disabled={!c || !canEdit}
                    title={
                      !canEdit
                        ? 'Wait for playable footage'
                        : !c
                          ? 'Select a clip first'
                          : 'Split the selected clip (S)'
                    }
                  >
                    S · Split
                  </Button>
                  <Button onClick={addClip} disabled={!r.duration || !canEdit}>
                    <Plus size={15} /> Clip
                  </Button>
                  <Button
                    aria-pressed={handleMode}
                    disabled={!canEdit}
                    title="Drag clip edges to adjust their in and out points (H)"
                    onClick={() => setHandleMode(!handleMode)}
                  >
                    H · Handles
                  </Button>
                  <label className={s.followToggle}>
                    <input
                      type="checkbox"
                      checked={follow}
                      onChange={(e) => {
                        setFollow(e.target.checked);
                        if (e.target.checked) {
                          const t = transport.current?.current() || 0;
                          const under = clips.find((x) => t >= x.start && t < x.end);
                          if (under) selectClip(under.id);
                        }
                      }}
                    />
                    Selection follows playhead
                  </label>
                  <span className={s.spacer} />
                  <span className={s.muted}>
                    {r.keys?.length ? 'Keyframes indexed' : 'Keyframe indexing pending'}
                  </span>
                </div>
              </div>
              <aside className={s.inspector}>
                <h3>Clips</h3>
                {clips.map((x) => (
                  <div
                    className={`${s.clipTile} ${x.id === c?.id && !mid ? s.selected : ''}`}
                    key={x.id}
                    data-cut-clip={x.id}
                    data-selected={x.id === c?.id && !mid}
                    tabIndex={0}
                    aria-label={`Select clip card: ${x.name}`}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('button,input,select,textarea'))
                        return;
                      if (follow) transport.current?.seek(x.start);
                      selectClip(x.id);
                    }}
                    onFocus={() => selectClip(x.id)}
                    onDoubleClick={(event) => {
                      if ((event.target as HTMLElement).closest('button,input,select,textarea'))
                        return;
                      transport.current?.command('pause');
                      selectClip(x.id);
                      transport.current?.seek(x.start);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        ['Enter', ' '].includes(event.key)
                      ) {
                        event.preventDefault();
                        selectClip(x.id);
                      }
                    }}
                  >
                    <div className={s.tools}>
                      <span className={s.clipIdentity}>
                        <i
                          className={s.clipSwatch}
                          style={{ background: clipColor(x.id) }}
                          aria-hidden="true"
                        />
                        <span>{String(clips.indexOf(x) + 1).padStart(2, '0')}</span>
                        <span className={s.clipDuration}>{time(x.end - x.start)}</span>
                      </span>
                      <span className={s.spacer} />
                      <Button
                        aria-label={`Delete clip: ${x.name}`}
                        onClick={() => {
                          selectClip(x.id);
                          setDeleteMarkerId('');
                          setDeleteClipId(x.id);
                        }}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                    <input
                      className={s.clipName}
                      aria-label="Clip name"
                      value={x.name}
                      onFocus={() => selectClip(x.id)}
                      onChange={(e) => updateClip(x.id, { name: e.target.value })}
                    />
                    {deleteClipId === x.id && (
                      <div className={s.confirm} role="alert" data-delete-confirm>
                        <span>Delete this clip? Source footage and markers stay available.</span>
                        <Button onClick={() => removeClip(x.id)}>Delete clip</Button>
                        <Button onClick={() => setDeleteClipId('')}>Cancel</Button>
                      </div>
                    )}
                    <div className={s.pair}>
                      <Field label="In">
                        <input
                          type="number"
                          step="0.083"
                          value={Number(x.start.toFixed(3))}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (v >= 0 && v < x.end - 0.02) updateClip(x.id, { start: v });
                          }}
                        />
                      </Field>
                      <Field label="Out">
                        <input
                          type="number"
                          step="0.083"
                          value={Number(x.end.toFixed(3))}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (v > x.start + 0.02 && v <= r.duration) updateClip(x.id, { end: v });
                          }}
                        />
                      </Field>
                    </div>
                  </div>
                ))}
                {!clips.length && <p className={s.muted}>Choose + Clip to begin a draft.</p>}
                {markerEditor(r.id)}
                <Field label="Capture intent">
                  <textarea
                    value={r.context}
                    onChange={(e) => updateRecording(r.id, { context: e.target.value })}
                  />
                </Field>
                <RecordingTools
                  recording={r}
                  workspace={workspace}
                  onChange={(patch) => updateRecording(r.id, patch)}
                />
              </aside>
            </div>
          )}
          {page === 'media' && !!r.id && (
            <MediaLayout
              folders={
                <>
                  <Button
                    aria-pressed={!activeSourceFolder}
                    onClick={() => setSourceFolderFilter('')}
                  >
                    All recordings
                  </Button>
                  <SourceFolders
                    recordings={recordings}
                    selected={activeSourceFolder}
                    onSelect={setSourceFolderFilter}
                  />
                </>
              }
              browser={
                <>
                  <div className={s.mediaViewTools}>
                    <Button aria-pressed={!mediaList} onClick={() => setMediaList(false)}>
                      Thumbnails
                    </Button>
                    <Button aria-pressed={mediaList} onClick={() => setMediaList(true)}>
                      List
                    </Button>
                    <label className={s.mediaSort}>
                      Sort
                      <select
                        aria-label="Sort media"
                        value={mediaSort}
                        onChange={(e) => {
                          const value = e.target.value as MediaSort;
                          setMediaSort(value);
                          localStorage.setItem('virtual-cut.media-sort', value);
                        }}
                      >
                        {Object.entries(mediaSorts).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {project && (
                    <p className={s.dropHint}>Drop videos here to import into this batch.</p>
                  )}
                  <div className={mediaList ? s.mediaList : s.mediaGrid}>
                    {mediaRecords.map((x) => (
                      <div
                        key={x.id}
                        data-recording={x.id}
                        tabIndex={0}
                        aria-label={`Recording: ${x.title}`}
                        onKeyDown={(e) => {
                          if (e.target === e.currentTarget && ['Enter', ' '].includes(e.key)) {
                            e.preventDefault();
                            selectRecord(x.id);
                          }
                        }}
                        className={`${s.source} ${x.id === r.id ? s.selected : ''}`}
                        onClick={() => selectRecord(x.id)}
                      >
                        <Thumbnail src={x.pinned || x.poster} alt={x.title} />
                        <strong title={x.title}>{x.title}</strong>
                        <time
                          className={s.sourceDate}
                          dateTime={
                            x.sourceModified != null
                              ? new Date(x.sourceModified).toISOString()
                              : undefined
                          }
                          title={`Source file Date modified${x.sourceModified != null ? ': ' + new Date(x.sourceModified).toLocaleString() : ' unavailable'}. Intake: ${x.importedAt != null ? new Date(x.importedAt).toLocaleString() : 'not recorded for this older import'}`}
                        >
                          {x.sourceModified != null
                            ? new Date(x.sourceModified).toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })
                            : 'Date unavailable'}
                        </time>
                        <span>
                          {short(x.duration)} ·{' '}
                          {x.sample ? 'Sample' : x.availability || 'Session video'}
                        </span>
                        <RecordingActions recording={x} workspace={workspace} />
                      </div>
                    ))}
                  </div>
                </>
              }
            >
              {player(r)}
              <RecordingTools
                recording={r}
                workspace={workspace}
                onChange={(patch) => updateRecording(r.id, patch)}
              />
              <details className={s.mediaContext}>
                <summary>Recording context</summary>
                <textarea
                  aria-label="Recording context"
                  value={r.context}
                  onChange={(e) => updateRecording(r.id, { context: e.target.value })}
                />
                <Button primary onClick={() => go('cut')}>
                  Open in Cut
                </Button>
                {!project && (
                  <p className={s.muted}>
                    {r.fullResolution
                      ? 'Original-resolution demo copy. Default audio track is used.'
                      : 'Default audio track is used.'}{' '}
                    Track selection and transcription come later.
                  </p>
                )}
              </details>
            </MediaLayout>
          )}
          {page === 'review' && (
            <>
              <div className={s.toolbar}>
                <div className={s.tools}>
                  {['Remaining', 'Held', 'Queue', 'Done', 'All'].map((f) => (
                    <Button
                      key={f}
                      aria-pressed={reviewFilter === f}
                      onClick={() => {
                        setReviewFilter(f);
                        setFolderFilter('');
                      }}
                    >
                      {f}{' '}
                      {f === 'Queue'
                        ? readyQueue.length
                        : f === 'All'
                          ? batchClips.length
                          : batchClips.filter((c) =>
                              f === 'Remaining'
                                ? (!c.accepted || c.held) && !c.filed
                                : f === 'Held'
                                  ? c.held
                                  : c.filed,
                            ).length}
                    </Button>
                  ))}
                </div>
                <span className={s.spacer} />
                <Button aria-pressed={reviewTree} onClick={() => setReviewTree(!reviewTree)}>
                  <FolderTree size={16} /> Tree
                </Button>
                {checked.length > 0 && (
                  <Button onClick={() => setFolderIds(checked)}>
                    Destination · {checked.length}
                  </Button>
                )}
              </div>
              <div className={s.reviewBody}>
                {reviewTree && (
                  <aside className={s.rail}>
                    <Button onClick={() => setFolderFilter('')}>All destinations</Button>
                    <FolderBranch
                      paths={[...new Set(model.clips.map((c) => c.folder))]}
                      onChoose={setFolderFilter}
                    />
                  </aside>
                )}
                <div className={s.scroll} data-scroll>
                  {[...new Set(filtered.map((c) => c.folder))].map((folder) => (
                    <section key={folder} className={s.folderGroup}>
                      <header>
                        <FolderOpen size={16} />
                        {folder}
                        <span className={s.spacer} />
                        {filtered.filter((c) => c.folder === folder).length} clips
                      </header>
                      {filtered
                        .filter((c) => c.folder === folder)
                        .map((clip) => (
                          <article
                            key={clip.id}
                            className={`${s.reviewCard} ${clip.held ? s.heldCard : ''}`}
                            data-card={clip.id}
                          >
                            <div className={s.cardHeading}>
                              <input
                                type="checkbox"
                                aria-label={`Select ${clip.name}`}
                                checked={checked.includes(clip.id)}
                                onChange={(e) =>
                                  setChecked(
                                    e.target.checked
                                      ? [...checked, clip.id]
                                      : checked.filter((x) => x !== clip.id),
                                  )
                                }
                              />
                              <div>
                                <strong>{clip.name}</strong>
                                <Button
                                  className={s.destination}
                                  onClick={() => setFolderIds([clip.id])}
                                >
                                  <FolderOpen size={14} />
                                  {clip.folder}
                                  <ChevronDown size={12} />
                                </Button>
                              </div>
                              <ReviewSignals
                                model={model}
                                clip={clip}
                                onInspect={(field) => inspectReview(clip, field)}
                                onFolder={() => setFolderIds([clip.id])}
                              />
                              <div className={s.tools}>
                                <span className={s.muted}>{time(clip.end - clip.start)}</span>
                                <Button
                                  aria-expanded={expanded === clip.id}
                                  onClick={() => {
                                    if (expanded === clip.id) setExpanded('');
                                    else inspectReview(clip);
                                  }}
                                >
                                  Details{' '}
                                  {expanded === clip.id ? (
                                    <ChevronUp size={15} />
                                  ) : (
                                    <ChevronDown size={15} />
                                  )}
                                </Button>
                                <Button
                                  className={clip.accepted ? s.acceptedButton : undefined}
                                  aria-pressed={Boolean(clip.accepted)}
                                  onClick={() =>
                                    updateClip(
                                      clip.id,
                                      { accepted: !clip.accepted, held: false },
                                      false,
                                    )
                                  }
                                >
                                  <Check size={15} />
                                  {clip.accepted ? 'Accepted' : 'Accept'}
                                </Button>
                                <Button
                                  aria-pressed={Boolean(clip.held)}
                                  onClick={() =>
                                    updateClip(
                                      clip.id,
                                      {
                                        held: !clip.held,
                                        accepted: false,
                                        filed: false,
                                        holdReason: clip.holdReason || 'Needs context',
                                      },
                                      false,
                                    )
                                  }
                                >
                                  {clip.held ? 'Held' : 'Hold'}
                                </Button>
                              </div>
                            </div>
                            {clip.held && (
                              <HoldReason
                                value={clip.holdReason || 'Needs context'}
                                onChange={(holdReason) =>
                                  updateClip(clip.id, { holdReason }, false)
                                }
                              />
                            )}
                            {expanded === clip.id && (
                              <Expansion>
                                <ReviewLayout held={clip.held}>
                                  {player(
                                    model.recordings.find((r) => r.id === clip.rid)!,
                                    clip,
                                  )}
                                  <div
                                    onDoubleClick={(event) => {
                                      if (
                                        (event.target as HTMLElement).closest(
                                          'button,input,select,textarea,summary,[data-marker-card]',
                                        )
                                      )
                                        return;
                                      transport.current?.command('pause');
                                      transport.current?.seek(clip.start);
                                    }}
                                  >
                                    <div data-review-field="markers">
                                      {markerEditor(clip.rid, clip)}
                                    </div>
                                    <div
                                      data-review-field="name"
                                      title="Double-click to seek to the clip start"
                                    >
                                      <Field label="Clip name">
                                        <input
                                          value={clip.name}
                                          onChange={(e) =>
                                            updateClip(clip.id, { name: e.target.value })
                                          }
                                        />
                                      </Field>
                                    </div>
                                    <div data-review-field="note">
                                      <Field label="Your note">
                                        <textarea
                                          value={clip.note || ''}
                                          onChange={(e) =>
                                            updateClip(clip.id, { note: e.target.value })
                                          }
                                        />
                                      </Field>
                                    </div>
                                    <Button onClick={() => addSelect(clip.id)}>
                                      Add to selects
                                    </Button>
                                    {project && (
                                      <Button onClick={() => setExportClipId(clip.id)}>
                                        Export clip…
                                      </Button>
                                    )}
                                    <details>
                                      <summary>Source context</summary>
                                      <p className={s.muted}>
                                        {model.recordings.find((r) => r.id === clip.rid)?.context}
                                      </p>
                                    </details>
                                  </div>
                                </ReviewLayout>
                              </Expansion>
                            )}
                          </article>
                        ))}
                    </section>
                  ))}
                  {!filtered.length && (
                    <p className={s.empty}>
                      No clips in this view. Choose All to return to the batch.
                    </p>
                  )}
                </div>
              </div>
              <div className={s.toolbar}>
                <span className={s.muted}>
                  {readyQueue.length} accepted and ready{!project && ' · preview plan'}
                </span>
                <span className={s.spacer} />
                <Button
                  primary
                  disabled={!!project}
                  title={project ? 'Filing arrives in Milestone 2' : undefined}
                  onClick={() => setDialog('file')}
                >
                  File queue · {readyQueue.length}
                </Button>
              </div>
            </>
          )}
          <div className={s.library} style={{ display: page === 'library' ? 'flex' : 'none' }}>
            <Library
              sample={!project}
              model={model}
              setModel={setModel}
              onOpen={(rid, time) => {
                updateRecording(rid, { position: time });
                selectRecord(rid);
                const clip = model.clips.find(
                  (c) => c.rid === rid && c.start <= time && c.end > time,
                );
                if (clip) setCid(clip.id);
                go('cut');
              }}
              onSelect={addSelect}
            />
          </div>
          {page === 'selects' && (
            <>
              <div className={s.toolbar}>
                <input
                  aria-label="Sequence name"
                  value={sequenceName}
                  onChange={(e) => setSequenceName(e.target.value)}
                />
                <select
                  aria-label="Sequence mode"
                  value={sequenceMode}
                  onChange={(e) => setSequenceMode(e.target.value)}
                >
                  <option>Selects</option>
                  <option>String-out</option>
                </select>
                <span>
                  {model.sequence.length} items ·{' '}
                  {time(
                    model.sequence.reduce((sum, e) => {
                      const x = effective(e);
                      return sum + x.end - x.start;
                    }, 0),
                  )}
                </span>
              </div>
              <div className={s.selects}>
                <aside className={s.rail}>
                  <h3>From this batch</h3>
                  {model.clips.map((c) => (
                    <label className={s.poolItem} key={c.id}>
                      <input
                        type="checkbox"
                        checked={pool.includes(c.id)}
                        onChange={(e) =>
                          setPool(
                            e.target.checked ? [...pool, c.id] : pool.filter((x) => x !== c.id),
                          )
                        }
                      />
                      <Thumbnail
                        src={model.recordings.find((r) => r.id === c.rid)?.poster || ''}
                        alt=""
                      />
                      <span>
                        {c.name}
                        <small>{time(c.end - c.start)}</small>
                      </span>
                    </label>
                  ))}
                  <div className={s.tools}>
                    <Button primary onClick={() => pool.forEach(addSelect)}>
                      Add checked
                    </Button>
                    <Button onClick={() => setDialog('batch')}>Whole batch</Button>
                  </div>
                  <Field label="Extra handles (seconds)">
                    <input
                      type="number"
                      min="0"
                      max="3"
                      step="0.5"
                      value={handles}
                      onChange={(e) => {
                        setPlayingSequence(false);
                        setHandles(Math.max(0, Math.min(3, Number(e.target.value) || 0)));
                      }}
                    />
                  </Field>
                </aside>
                <div className={s.selectCenter}>
                  {e ? (
                    <div className={s.selectPlayer}>
                      {player(
                        model.recordings.find((r) => r.id === e.rid)!,
                        effective(e),
                        true,
                      )}
                    </div>
                  ) : (
                    <p className={s.empty}>Choose clips from the batch to start.</p>
                  )}
                  <div className={s.tools}>
                    <Button
                      disabled={!model.sequence.length}
                      onClick={() => {
                        transport.current?.command('pause');
                        const first = model.sequence[0];
                        updateRecording(first.rid, { position: effective(first).start });
                        setEid(first.id);
                        setPlayingSequence(true);
                        transport.current?.seek(effective(first).start);
                        transport.current?.command('l');
                      }}
                    >
                      Play sequence
                    </Button>
                    <Button
                      onClick={() => {
                        setPlayingSequence(false);
                        setModel((m) => ({
                          ...m,
                          sequence: [...m.sequence].sort(
                            (a, b) =>
                              m.recordings.find((r) => r.id === a.rid)!.base +
                              a.start -
                              (m.recordings.find((r) => r.id === b.rid)!.base + b.start),
                          ),
                        }));
                      }}
                    >
                      Source order
                    </Button>
                    <Button onClick={() => setDialog('clear')}>Clear</Button>
                  </div>
                  <div className={s.assembly}>
                    {model.sequence.map((x, i) => (
                      <button
                        key={x.id}
                        style={{ flexGrow: x.end - x.start }}
                        onClick={() => {
                          setPlayingSequence(false);
                          updateRecording(x.rid, { position: effective(x).start });
                          setEid(x.id);
                        }}
                        title={x.name}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                  <div className={s.sequenceList}>
                    {model.sequence.map((x, i) => (
                      <article
                        key={x.id}
                        className={`${s.sequenceRow} ${x.id === e?.id ? s.selected : ''}`}
                        draggable
                        onDragStart={() => {
                          dragging.current = x.id;
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          const from = model.sequence.findIndex((x) => x.id === dragging.current);
                          if (from >= 0) moveEntry(dragging.current, i - from);
                        }}
                      >
                        <span>{i + 1}</span>
                        <Thumbnail
                          src={model.recordings.find((r) => r.id === x.rid)?.poster || ''}
                          alt=""
                        />
                        <button
                          onClick={() => {
                            setPlayingSequence(false);
                            setEid(x.id);
                            updateRecording(x.rid, { position: effective(x).start });
                          }}
                        >
                          {x.name}
                        </button>
                        <div className={s.tools}>
                          <Button
                            disabled={i === 0}
                            aria-label="Move earlier"
                            onClick={() => moveEntry(x.id, -1)}
                          >
                            <ArrowUp size={15} />
                          </Button>
                          <Button
                            disabled={i === model.sequence.length - 1}
                            aria-label="Move later"
                            onClick={() => moveEntry(x.id, 1)}
                          >
                            <ArrowDown size={15} />
                          </Button>
                          <Button
                            aria-label="Remove sequence item"
                            onClick={() => {
                              setPlayingSequence(false);
                              setModel((m) => ({
                                ...m,
                                sequence: m.sequence.filter((e) => e.id !== x.id),
                              }));
                            }}
                          >
                            <X size={15} />
                          </Button>
                        </div>
                        <div className={s.sequenceTrim}>
                          <Field label="Source in">
                            <input
                              type="number"
                              step="0.083"
                              value={Number(x.start.toFixed(3))}
                              onChange={(e) => trimEntry(x.id, 'start', Number(e.target.value))}
                            />
                          </Field>
                          <Field label="Source out">
                            <input
                              type="number"
                              step="0.083"
                              value={Number(x.end.toFixed(3))}
                              onChange={(e) => trimEntry(x.id, 'end', Number(e.target.value))}
                            />
                          </Field>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
        {drawer && (
          <aside className={s.drawer}>
            <div className={s.tools}>
              <h2>{drawer}</h2>
              <Button aria-label="Close side panel" onClick={() => setDrawer('')}>
                <X size={18} />
              </Button>
            </div>
            {drawer === 'Notes' ? (
              <>
                <Field label="Workspace notes">
                  <textarea
                    className={s.scratchpad}
                    value={project ? model.scratchpad || '' : notes}
                    onChange={(e) =>
                      project
                        ? setModel((m) => ({ ...m, scratchpad: e.target.value }))
                        : setNotes(e.target.value)
                    }
                  />
                </Field>
                <p className={s.muted}>
                  {project
                    ? 'Saved with this project'
                    : 'Saved on this device · shared across sample workspaces'}
                </p>
                <h3>Linked notes</h3>
                {model.notes.map((n) => (
                  <div key={n.id} className={s.clipTile}>
                    <strong>{n.title}</strong>
                    <textarea
                      aria-label={n.title}
                      value={n.text}
                      onChange={(e) =>
                        setModel((m) => ({
                          ...m,
                          notes: m.notes.map((x) =>
                            x.id === n.id ? { ...x, text: e.target.value } : x,
                          ),
                        }))
                      }
                    />
                  </div>
                ))}
              </>
            ) : (
              <>
                <div className={s.tools}>
                  {['Copilot', 'Agent'].map((x) => (
                    <Button key={x} aria-pressed={agent === x} onClick={() => setAgent(x)}>
                      {x}
                    </Button>
                  ))}
                </div>
                <Field label="Scope">
                  <select>
                    <option>Selected clip</option>
                    <option>Current recording</option>
                    <option>Current batch</option>
                  </select>
                </Field>
                <Field label="Request">
                  <textarea placeholder="Review these markers using the capture intent…" />
                </Field>
                <Button onClick={() => setNotice('Request preview only. No model is connected.')}>
                  Preview request
                </Button>
                <p className={s.muted}>No model connected · no background processing</p>
              </>
            )}
          </aside>
        )}
      </div>
      {(workspace.error || project?.warning) && (
        <div className={s.notice} role="alert">
          {workspace.error || project?.warning}
          {workspace.error && (
            <Button onClick={() => void workspace.flush().catch(() => {})}>Retry saving</Button>
          )}
        </div>
      )}
      {workspace.busy && !workspace.quiet && (
        <div className={s.busyOverlay} role="status">
          Working…
        </div>
      )}
      {importing && project && (
        <ImportPanel workspace={workspace} kind="files" onClose={() => setImporting(false)} />
      )}
      {savesOpen && project && (
        <SaveHistory workspace={workspace} onClose={() => setSavesOpen(false)} />
      )}
      {shortcutsOpen && (
        <Modal title="Keyboard shortcuts" onClose={() => setShortcutsOpen(false)}>
          <table className={s.shortcutTable}>
            <tbody>
              {[
                ['Ctrl+S', 'Manual save checkpoint'],
                ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo'],
                ['Ctrl+↑ / Ctrl+↓', 'Previous / next item in the current page'],
                [
                  'J / K / L',
                  'J: reverse scan · K: play/pause · L: forward/faster (1×, 2×, 4×, 8×, 16×)',
                ],
                ['Space', 'Play / pause'],
                ['Q / W', 'Selected clip in / out at the playhead'],
                ['S', 'Split selected clip'],
                ['H', 'Toggle clip handles on the Cut page; drag an edge to trim'],
                ['M', 'Create a Blue marker and name it'],
                ['R', 'Rename selected clip or marker (selects its name)'],
                ['Backspace', 'Request deletion of selected clip or marker'],
                ['Enter / Escape', 'Confirm / cancel deletion'],
                ['← / →', 'Step a frame when the timeline is focused'],
                ['Shift+← / Shift+→', 'Seek one second when the timeline is focused'],
                ['Alt + wheel', 'Zoom timeline at the cursor; Fit full recording resets it'],
                [
                  'Ctrl + wheel / Alt+Shift + wheel',
                  'Pan the zoomed timeline; buttons and range slider also work with the keyboard',
                ],
                ['F11', 'Fullscreen'],
              ].map(([key, description]) => (
                <tr key={key}>
                  <th>{key}</th>
                  <td>{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Editing shortcuts leave typing fields alone. Enter finishes a name edit. With
            selection-follow off, click a clip card or its timeline bar to select it.
          </p>
        </Modal>
      )}
      {projectsOpen && (
        <ProjectPanel workspace={workspace} onClose={() => setProjectsOpen(false)} />
      )}
      {project && exportClipId && (
        <ExportPanel
          workspace={workspace}
          clipId={exportClipId}
          onClose={() => setExportClipId('')}
          onQueued={() => {
            setExportClipId('');
            setExportsOpen(true);
          }}
        />
      )}
      {project && exportsOpen && (
        <ExportHistory workspace={workspace} onClose={() => setExportsOpen(false)} />
      )}
      {notice && (
        <div className={s.notice} role="status">
          <span>{notice}</span>
          <Button aria-label="Dismiss message" onClick={() => setNotice('')}>
            <X size={14} />
          </Button>
        </div>
      )}
      <footer className={s.footer}>
        <span className={s.muted}>{project ? 'Project workspace' : 'Workflow preview'}</span>
        <nav aria-label="Workspace pages">
          {pages.map((p) => (
            <button
              key={p.id}
              aria-current={page === p.id ? 'page' : undefined}
              onClick={() => go(p.id)}
            >
              <p.icon size={21} />
              {p.label}
            </button>
          ))}
        </nav>
        <div className={s.tools}>
          <Button onClick={() => setShortcutsOpen(true)}>Keyboard shortcuts</Button>
          <span className={s.muted}>F11 · Fullscreen</span>
        </div>
      </footer>
      {folderIds.length > 0 && (
        <FolderPicker
          model={model}
          clips={folderIds}
          onClose={() => setFolderIds([])}
          onApply={(folder) => {
            setModel((m) => ({
              ...m,
              folders: [...new Set([...m.folders, folder])],
              clips: m.clips.map((c) =>
                folderIds.includes(c.id) ? { ...invalidate(c), folder } : c,
              ),
            }));
            setFolderIds([]);
            setChecked([]);
            setFolderFilter('');
          }}
        />
      )}
      {dialog && (
        <Modal
          title={
            {
              settings: 'Preview options',
              export: 'Export plan',
              file: 'File accepted clips',
              handoff: 'Resolve timeline handoff',
              batch: 'Build a batch string-out',
              clear: 'Clear this sequence?',
            }[dialog] || 'Preview'
          }
          onClose={() => setDialog('')}
        >
          {dialog === 'settings' && (
            <>
              <p>Explore the new page layouts with sample footage or one local recording.</p>
              <p className={s.muted}>
                Sample edits are saved locally. Local-video drafts last for this session. No
                original footage, Resolve timeline, or Notion page is changed.
              </p>
              {!project && (
                <>
                  <Button onClick={() => setDialog('reset')}>Reset sample changes</Button>
                  <Button onClick={onFoundation}>Open previous foundation layouts</Button>
                </>
              )}
            </>
          )}
          {dialog === 'reset' && (
            <>
              <p>
                Reset the sample clips, markers, glossary, and simulated timelines? Scratch notes
                are kept.
              </p>
              <Button
                primary
                onClick={() => {
                  transport.current?.command('pause');
                  setModel(initialModel());
                  setRid('r1');
                  setCid('c1');
                  setEid('e1');
                  setTarget('tl1');
                  setExpanded('');
                  setChecked([]);
                  setFolderFilter('');
                  setReviewFilter('Remaining');
                  setPlayingSequence(false);
                  setDialog('');
                  go('cut');
                }}
              >
                Reset sample
              </Button>
            </>
          )}
          {dialog === 'export' && (
            <>
              <p>Game-audio-only export plan</p>
              {clips.map((c) => (
                <div className={s.planRow} key={c.id}>
                  <span>{c.name}</span>
                  <span>
                    {time(c.start)}–{time(c.end)}
                  </span>
                </div>
              ))}
              <p className={s.muted}>
                Preview only. Video export, keyframe snapping, and audio removal are not
                implemented.
              </p>
              <Button
                primary
                onClick={() => {
                  setDialog('');
                  go('review');
                }}
              >
                Continue to User Review
              </Button>
            </>
          )}
          {dialog === 'file' && (
            <>
              {readyQueue.map((c) => (
                <div className={s.planRow} key={c.id}>
                  <span>
                    {c.name}
                    <small>{c.folder}</small>
                  </span>
                  <Check size={15} />
                </div>
              ))}
              <p className={s.muted}>Simulation only · no files move</p>
              <Button
                primary
                disabled={!readyQueue.length}
                onClick={() => {
                  setModel((m) => ({
                    ...m,
                    clips: m.clips.map((c) => (c.accepted && !c.held ? { ...c, filed: true } : c)),
                  }));
                  setDialog('');
                }}
              >
                Simulate filing
              </Button>
            </>
          )}
          {dialog === 'clear' && (
            <Button
              primary
              onClick={() => {
                setPlayingSequence(false);
                setModel((m) => ({ ...m, sequence: [] }));
                setDialog('');
              }}
            >
              Clear sequence
            </Button>
          )}
          {dialog === 'batch' && (
            <>
              <p>Append coverage in source order.</p>
              <Button
                primary
                onClick={() => {
                  model.clips.forEach((c) => addSelect(c.id));
                  setSequenceMode('String-out');
                  setDialog('');
                }}
              >
                All cut clips
              </Button>
              <Button
                onClick={() => {
                  setModel((m) => ({
                    ...m,
                    sequence: [
                      ...m.sequence,
                      ...m.recordings
                        .filter((r) => r.duration > 0)
                        .map((r) => ({
                          id: uid(),
                          rid: r.id,
                          name: r.title + ' · Full recording',
                          start: 0,
                          end: r.duration,
                        })),
                    ],
                  }));
                  setSequenceMode('String-out');
                  setDialog('');
                }}
              >
                Full recordings
              </Button>
            </>
          )}
          {dialog === 'handoff' && (
            <>
              <span className={s.badge}>Simulated Resolve project</span>
              <div className={s.tools}>
                <Button aria-pressed={!newTarget} onClick={() => setNewTarget(false)}>
                  Append to existing
                </Button>
                <Button aria-pressed={newTarget} onClick={() => setNewTarget(true)}>
                  Create new
                </Button>
              </div>
              {newTarget ? (
                <Field label="New timeline name">
                  <input value={sequenceName} onChange={(e) => setSequenceName(e.target.value)} />
                </Field>
              ) : (
                <Field label="Matched timeline">
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    {model.targets.map((t) => (
                      <option value={t.id} key={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <p className={s.muted}>
                Match by saved project and timeline identity; confirm the name.
              </p>
              <label className={s.tools}>
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                />{' '}
                Skip identical source ranges already included
              </label>
              <div className={s.planRow}>
                <span>{time(newTarget ? 0 : currentTarget.duration)} existing</span>
                <span>+ {time(handoff.reduce((n, e) => n + e.end - e.start, 0))} appended</span>
              </div>
              <p>
                {handoff.length} items to add · {skipped} exact duplicates skipped
              </p>
              {handoff.map((e) => (
                <div className={s.planRow} key={e.id}>
                  <span>{e.name}</span>
                  <span>
                    {time(e.start)}–{time(e.end)}
                  </span>
                </div>
              ))}
              <p className={s.muted}>No connection to your running Resolve.</p>
              <Button
                primary
                disabled={!handoff.length}
                onClick={() => {
                  const id = newTarget ? uid() : currentTarget.id;
                  setModel((m) => {
                    const previous = newTarget
                      ? { id, name: sequenceName || 'Untitled selects', duration: 0, items: [] }
                      : currentTarget;
                    const next = {
                      ...previous,
                      duration:
                        previous.duration + handoff.reduce((n, e) => n + e.end - e.start, 0),
                      items: [...previous.items, ...handoff],
                    };
                    return { ...m, targets: [...m.targets.filter((t) => t.id !== id), next] };
                  });
                  setTarget(id);
                  setNewTarget(false);
                  setDialog('');
                  setNotice(
                    'Simulated timeline updated. Reopen handoff to check duplicate handling.',
                  );
                }}
              >
                {newTarget ? 'Simulate create' : 'Simulate append'}
              </Button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
