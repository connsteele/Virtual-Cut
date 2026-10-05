import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Settings, ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import type {
  TranscriptApi,
  TranscriptCommand,
  TranscriptFilter,
  TranscriptPage,
  TranscriptSegment,
  TranscriptSession,
} from '../../electron/transcript-contracts';
import { correctionId, cueCandidate, reviewedCue } from '../../electron/transcript-edits';
import { readTranscriptView, saveTranscriptView } from '../../electron/transcript-view';
import type { TranscriptView } from '../../electron/transcript-view';
import { TranscriptionOptions, initialTranscriptionOptions } from './TranscriptionOptions';
import { Button, Field } from './ui';
import s from './TranscriptWindow.module.css';
import { TranscriptCue } from './TranscriptCue';
import { SpeechSetup } from './SpeechSetup';
import { background } from './background';
import { useWindowFocus } from './useWindowFocus';

const viewStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};
const time = (seconds: number) => {
  const total = Math.floor(seconds),
    ms = Math.floor((seconds - total) * 1000);
  return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};
const filters: [TranscriptFilter, string][] = [
  ['all', 'All'],
  ['pending', 'Needs review'],
  ['cues', 'Cues'],
  ['accepted', 'Accepted'],
  ['rejected', 'Rejected'],
];
export function TranscriptWindow() {
  const api = window.virtualCut!.transcript;
  const [session, setSession] = useState<TranscriptSession | null>(null);
  const [sourceId, setSourceId] = useState(''),
    [transcriptId, setTranscriptId] = useState('');
  const [page, setPage] = useState<TranscriptPage>(),
    [pageIndex, setPageIndex] = useState(0),
    [search, setSearch] = useState('');
  const [loadedPageKey, setLoadedPageKey] = useState('');
  const [filter, setFilter] = useState<TranscriptFilter>('all');
  const [follow, setFollow] = useState(true);
  const [focusedWord, setFocusedWord] = useState<{ segment: number; word?: number }>();
  const [options, setOptions] = useState(initialTranscriptionOptions);
  const [transcriptionReady, setTranscriptionReady] = useState(false);
  const [exportId, setExportId] = useState(''),
    [exportFormat, setExportFormat] = useState<'srt' | 'json'>('srt'),
    [exportOpen, setExportOpen] = useState(false);
  const exportMenu = useRef<HTMLDivElement>(null);
  const [runtime, setRuntime] = useState<Awaited<ReturnType<TranscriptApi['runtime']>>>();
  const [setup, setSetup] = useState(false),
    [startOpen, setStartOpen] = useState(false),
    [original, setOriginal] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ projectId: '', sourceId: '', time: 0 });
  const [selection, setSelection] = useState<{
    transcriptId: string;
    segment: TranscriptSegment;
    wordIndex?: number;
    text: string;
  }>();
  const identity = useRef('');
  const followOwner = useRef('');
  const followLookup = useRef<{ owner: string } | undefined>(undefined);
  const reading = useRef<{ owner: string; view: TranscriptView } | undefined>(undefined);
  const restore = useRef<{ identity: string; scroll: number } | undefined>(undefined);
  const remember = useCallback(() => {
    const storage = viewStorage();
    if (reading.current && storage)
      saveTranscriptView(storage, reading.current.owner, {
        ...reading.current.view,
        scroll: window.scrollY,
      });
  }, []);
  const acceptSession = useCallback(
    (value: TranscriptSession | null) => {
      const nextIdentity = `${value?.viewSessionId || ''}:${value?.projectId || ''}:${value?.sourceId || ''}`;
      if (identity.current !== nextIdentity) {
        remember();
        identity.current = nextIdentity;
        const storage = viewStorage();
        const saved =
          value?.viewSessionId && storage
            ? readTranscriptView(
                storage,
                value.viewSessionId,
                value.projectId,
                value.sourceId,
                value.transcripts.map((t) => t.id),
              )
            : undefined;
        restore.current = { identity: nextIdentity, scroll: saved?.scroll || 0 };
        setTranscriptId(saved?.transcriptId || '');
        setPageIndex(saved?.page || 0);
        setSearch(saved?.search || '');
        setFilter(saved?.filter || 'all');
        setFollow(saved?.follow ?? true);
        setOriginal(saved?.original ?? false);
        setFocusedWord(saved?.focus);
        setExportId('');
        setSelection(undefined);
        setError('');
        setNotice('');
      }
      setSession((previous) =>
        JSON.stringify(value) === JSON.stringify(previous) ? previous : value,
      );
    },
    [remember],
  );
  useEffect(() => {
    window.addEventListener('beforeunload', remember);
    return () => window.removeEventListener('beforeunload', remember);
  }, [remember]);
  const refreshSession = async () => {
    const value = await api.session(sourceId || undefined);
    acceptSession(value);
  };
  useEffect(() => {
    let alive = true,
      polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const value = await api.session(sourceId || undefined);
        if (alive) acceptSession(value);
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        polling = false;
      }
    };
    background(poll());
    const timer = setInterval(() => background(poll()), 1200);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api, sourceId, acceptSession]);
  useEffect(() => api.onSource(setSourceId), [api]);
  useEffect(() => {
    void api
      .runtime()
      .then(setRuntime)
      .catch((e) => setError(String(e)));
    return api.onPosition(setPosition);
  }, [api]);
  // Setup files can be moved or deleted in Explorer; look again whenever this window returns.
  useWindowFocus(useCallback(() => background(api.runtime().then(setRuntime)), [api]));
  const refreshRuntime = useCallback(
    async (refresh?: boolean) => setRuntime(await api.runtime(refresh)),
    [api],
  );
  const selected =
    session?.transcripts.find((t) => t.id === transcriptId) ||
    session?.transcripts.find((t) => t.state === 'complete') ||
    session?.transcripts[0];
  const currentId = selected?.id || '';
  const projectId = session?.projectId || '';
  const editRevision = JSON.stringify(session?.edits);
  const pageKey = JSON.stringify([identity.current, currentId, pageIndex, search, filter]);
  reading.current =
    session?.viewSessionId && currentId
      ? {
          owner: session.viewSessionId,
          view: {
            projectId,
            sourceId: session.sourceId,
            transcriptId: currentId,
            page: pageIndex,
            search,
            filter,
            follow,
            original,
            scroll: 0,
            focus: focusedWord,
          },
        }
      : undefined;
  const usablePage =
    loadedPageKey === pageKey && page?.transcript.id === currentId ? page : undefined;
  // Chip counts cover the whole transcript, so the previous page's counts stay while loading.
  const counts = page?.transcript.id === currentId ? page.counts : undefined;
  // Position updates share one lookup. Only a reader/context change invalidates it.
  followOwner.current =
    follow &&
    !search &&
    filter === 'all' &&
    !selection &&
    position.projectId === projectId &&
    position.sourceId === session?.sourceId
      ? JSON.stringify([identity.current, projectId, currentId, session?.sourceId])
      : '';
  useEffect(() => {
    const pending = restore.current;
    if (!pending || !usablePage) return;
    const frame = requestAnimationFrame(() => {
      if (restore.current === pending && identity.current === pending.identity) {
        window.scrollTo(0, pending.scroll);
        restore.current = undefined;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [usablePage]);
  useEffect(() => {
    let alive = true;
    if (!projectId || !currentId) return;
    const timer = setTimeout(
      () => {
        void api
          .page(projectId, currentId, pageIndex, search, filter)
          .then((value) => {
            if (alive) {
              setPage(value);
              setLoadedPageKey(pageKey);
            }
          })
          .catch((e) => {
            if (alive) setError(String(e));
          });
      },
      search ? 200 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [
    api,
    projectId,
    currentId,
    pageIndex,
    search,
    filter,
    selected?.state,
    editRevision,
    session?.revision,
    pageKey,
  ]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelection(undefined);
        setExportOpen(false);
        return;
      }
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.defaultPrevented ||
        (event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')
      )
        return;
      const value = event.key.toLowerCase();
      if (session && ['j', 'k', 'l'].includes(value)) {
        event.preventDefault();
        void api
          .transport(session.projectId, session.sourceId, value as 'j' | 'k' | 'l')
          .catch((e) => setError(String(e)));
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [api, session]);
  useEffect(() => {
    if (!exportOpen) return;
    const outside = (event: PointerEvent) => {
      if (!exportMenu.current?.contains(event.target as Node)) setExportOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [exportOpen]);
  useEffect(() => {
    if (
      !follow ||
      search ||
      filter !== 'all' ||
      selection ||
      !usablePage ||
      restore.current ||
      position.projectId !== projectId ||
      position.sourceId !== session?.sourceId
    )
      return;
    if (
      position.time >= (usablePage.followStart ?? 0) &&
      position.time < (usablePage.followEnd ?? Infinity)
    ) {
      const current = document.querySelector('[data-active-word="true"]');
      const rect = current?.getBoundingClientRect();
      if (rect && (rect.top < 100 || rect.bottom > window.innerHeight - 100))
        current?.scrollIntoView({ block: 'center' });
      return;
    }
    const owner = followOwner.current;
    if (followLookup.current?.owner === owner) return;
    const request = { owner };
    followLookup.current = request;
    void api
      .pageAt(projectId, currentId, position.time)
      .then((index) => {
        if (followOwner.current === owner && followLookup.current === request) setPageIndex(index);
      })
      .catch((e) => {
        if (followOwner.current === owner && followLookup.current === request) setError(String(e));
      })
      .finally(() => {
        if (followLookup.current === request) followLookup.current = undefined;
      });
  }, [
    api,
    currentId,
    projectId,
    position,
    session?.sourceId,
    follow,
    search,
    filter,
    selection,
    usablePage,
  ]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await refreshSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function seek(segment: TranscriptSegment, wordIndex?: number, edit = false) {
    if (!session || !selected) return;
    const word = wordIndex == null ? undefined : segment.words[wordIndex];
    const correction = session.edits.find(
      (e) => e.id === correctionId(selected.id, segment.id, wordIndex),
    );
    setFocusedWord({ segment: segment.id, word: wordIndex });
    if (edit) {
      setFollow(false);
      setSelection({
        transcriptId: selected.id,
        segment,
        wordIndex,
        text: correction?.text ?? word?.text ?? segment.text,
      });
    } else if (
      selection &&
      (selection.transcriptId !== selected.id ||
        selection.segment.id !== segment.id ||
        selection.wordIndex !== wordIndex)
    ) {
      setSelection(undefined);
    }
    const target = word?.start ?? segment.start;
    setPosition({ projectId: session.projectId, sourceId: session.sourceId, time: target });
    void api.seek(session.projectId, session.sourceId, target).catch((e) => setError(String(e)));
  }
  function command(
    segment: TranscriptSegment,
    type: TranscriptCommand['action'],
    text?: string,
    wordIndex?: number,
    values: Partial<TranscriptCommand> = {},
  ) {
    if (!session || !selected) return Promise.resolve();
    const expected = type.endsWith('cue')
      ? reviewedCue(session.decisions, selected, segment)
      : session.edits.find((e) => e.id === correctionId(selected.id, segment.id, wordIndex));
    return api.command({
      ...values,
      projectId: session.projectId,
      sourceId: session.sourceId,
      transcriptId: selected.id,
      segmentId: segment.id,
      wordIndex,
      text,
      action: type,
      expected: JSON.stringify(expected || null),
    });
  }
  const hasSelection = selection && selection.transcriptId === currentId;
  return (
    <main className={s.window}>
      <h1 className={s.screenReaderTitle}>Transcription</h1>
      {!session ? (
        <p>Open a project in the main window to read or generate transcripts.</p>
      ) : (
        <>
          <div className={s.tools} role="toolbar" aria-label="Transcript tools">
            <select
              aria-label="Recording"
              title="Recording"
              value={session.sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setSelection(undefined);
              }}
            >
              {session.recordings.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
            {selected && (
              <select
                aria-label="Select transcript"
                title="Transcript"
                value={currentId}
                onChange={(e) => {
                  setTranscriptId(e.target.value);
                  setPageIndex(0);
                  setSelection(undefined);
                }}
              >
                {session.transcripts.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.role === 'mic' ? 'Microphone notes' : 'Game dialogue'} ·{' '}
                    {t.language || 'Auto'} · {t.state} · {new Date(t.created).toLocaleString()}
                  </option>
                ))}
              </select>
            )}
            {selected && (
              <div className={s.find}>
                <Search size={16} aria-hidden />
                <input
                  aria-label="Search transcript"
                  placeholder="Search speech and corrections"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPageIndex(0);
                    setFollow(false);
                  }}
                />
                <label title="Show the original recognition instead of corrections">
                  <input
                    type="checkbox"
                    checked={original}
                    onChange={(e) => setOriginal(e.target.checked)}
                  />
                  Original
                </label>
              </div>
            )}
            {selected && (
              <Button
                aria-label="Follow playback"
                aria-pressed={follow}
                onClick={() => {
                  setFollow(!follow);
                  if (!follow) {
                    setFilter('all');
                    setSearch('');
                    setSelection(undefined);
                  }
                }}
              >
                Follow
              </Button>
            )}
            {selected && (
              <div className={s.menuAnchor} ref={exportMenu}>
                <Button
                  aria-haspopup="dialog"
                  aria-expanded={exportOpen}
                  title="Export this transcript as SRT or JSON"
                  disabled={selected.state !== 'complete'}
                  onClick={() => setExportOpen(!exportOpen)}
                >
                  Export <ChevronDown size={14} />
                </Button>
                {exportOpen && (
                  <section className={s.menu} role="dialog" aria-label="Export transcript">
                    <Field label="Format">
                      <select
                        aria-label="Export format"
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value as 'srt' | 'json')}
                      >
                        <option value="srt">SRT · corrected phrases for subtitles</option>
                        <option value="json">JSON · original words and corrections</option>
                      </select>
                    </Field>
                    {!!session.outputs.length && (
                      <Field label="Timing">
                        <select
                          aria-label="Export transcript timing"
                          value={exportId}
                          onChange={(e) => setExportId(e.target.value)}
                        >
                          <option value="">Whole source</option>
                          {session.outputs.map((o) => (
                            <option key={o.id} value={o.id}>
                              Completed clip · {o.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    <Button
                      primary
                      disabled={busy}
                      onClick={() => {
                        setExportOpen(false);
                        background(
                          action(async () => {
                            const file = await api.export(
                              projectId,
                              currentId,
                              exportFormat,
                              exportId || undefined,
                            );
                            if (file) setNotice(`Saved ${file}`);
                          }),
                        );
                      }}
                    >
                      Export transcript
                    </Button>
                  </section>
                )}
              </div>
            )}
            <Button
              title="Speech engine"
              aria-label="Speech engine"
              aria-expanded={setup}
              onClick={() => setSetup(!setup)}
            >
              <Settings size={18} />
            </Button>
            <Button primary onClick={() => setStartOpen(!startOpen)} disabled={!session.sourceId}>
              Transcribe
            </Button>
          </div>
          {selected && (
            <div className={s.filters} role="group" aria-label="Transcript filter">
              {filters.map(([value, label]) => (
                <button
                  key={value}
                  className={s.filter}
                  data-filter={value}
                  aria-pressed={filter === value}
                  onClick={() => {
                    setFilter(value);
                    setPageIndex(0);
                    setFollow(false);
                  }}
                >
                  {label}
                  <span>{counts?.[value] ?? '–'}</span>
                </button>
              ))}
            </div>
          )}
          {startOpen && (
            <section className={s.card} aria-label="Start transcription">
              <TranscriptionOptions
                value={options}
                onChange={setOptions}
                onReadyChange={setTranscriptionReady}
              />
              <p>
                Local speech recognition runs once for each selected audio track. Existing matching
                results are reused; originals and corrections are preserved.{' '}
                {session.batches.find((b) => b.id === session.batchId)?.name} supplies the game
                context.
              </p>
              <p className={s.muted}>
                Speaker detection is deferred. Microphone speech and game dialogue stay separate.
              </p>
              <Button
                primary
                disabled={busy || !runtime?.configured || !transcriptionReady}
                onClick={() =>
                  background(
                    action(() =>
                      api.start(session.projectId, session.sourceId, session.batchId, options),
                    ),
                  )
                }
              >
                Start transcription
              </Button>
              {!runtime?.configured && (
                <Button onClick={() => setSetup(true)}>Set up the speech engine</Button>
              )}
              {runtime?.removed && (
                <p className={s.error} role="alert">
                  {runtime.removed} It may have been moved or deleted.
                </p>
              )}
            </section>
          )}
        </>
      )}
      {setup && (
        <section className={s.card} aria-label="Speech engine settings">
          <h2>Speech engine</h2>
          <SpeechSetup api={api} runtime={runtime} onRuntimeChanged={refreshRuntime} />
        </section>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {session?.jobs
        .filter((j) => j.state !== 'succeeded')
        .map((job) => (
          <section className={s.job} key={job.id}>
            <div>
              <strong>{job.state}</strong> · {job.message}
              {job.device && <small> · {job.device === 'cuda' ? 'NVIDIA GPU' : 'CPU'}</small>}
              {job.elapsedMs != null && <small> · {(job.elapsedMs / 1000).toFixed(1)} s</small>}
            </div>
            {job.deviceMessage && <p>GPU fallback: {job.deviceMessage}</p>}
            {['running', 'queued'].includes(job.state) && <progress max={1} value={job.progress} />}
            {['running', 'queued'].includes(job.state) && (
              <Button
                disabled={busy}
                onClick={() =>
                  background(action(() => api.job(session.projectId, job.id, 'pause')))
                }
              >
                Pause
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() =>
                background(
                  action(() =>
                    api.job(
                      session.projectId,
                      job.id,
                      ['running', 'queued'].includes(job.state) ? 'cancel' : 'retry',
                    ),
                  ),
                )
              }
            >
              {['running', 'queued'].includes(job.state)
                ? 'Cancel'
                : job.message.startsWith('Paused')
                  ? 'Resume from start'
                  : 'Retry'}
            </Button>
          </section>
        ))}
      {selected && session && (
        <>
          <details className={s.help}>
            <summary>
              {selected.wordCount} words ·{' '}
              {selected.device === 'cuda' ? 'NVIDIA GPU' : selected.device.toUpperCase()} ·{' '}
              {selected.context.gameName || 'No game specified'}
              {selected.context.vocabulary ? ' · vocabulary hints used' : ''}
              {' · Help'}
            </summary>
            <p>Speech model: {selected.model}</p>
            <p>
              Click a word to seek. Double-click to correct; Escape closes the editor. J/K/L
              controls playback when you are not typing. Dotted words have low recognition
              confidence.
            </p>
            <p>
              Spoken microphone cues: Marker, Note, Split, Clip start and Clip end. Marker is
              recommended to avoid confusion with the name Mark; guarded legacy Mark cues still
              work. Every proposed action requires review.
            </p>
          </details>
          {selected.deviceMessage && <p className={s.muted}>{selected.deviceMessage}</p>}
          {selected.state !== 'complete' && (
            <p>
              Recognition is incomplete. Corrections and cue decisions become available when it
              finishes.
            </p>
          )}
          <div
            className={s.segments}
            aria-label="Transcript phrases"
            onWheel={() => setFollow(false)}
          >
            {usablePage?.segments.map((segment) => {
              const phraseEdit = session.edits.find(
                (e) => e.id === correctionId(currentId, segment.id),
              );
              const cue = cueCandidate(selected, segment);
              const active =
                position.projectId === projectId && position.sourceId === session.sourceId;
              return (
                <article className={s.segment} key={segment.id}>
                  <div className={s.phraseHeading}>
                    <button onClick={() => seek(segment)}>{time(segment.start)}</button>
                    <Button
                      disabled={busy || selected.state !== 'complete'}
                      onClick={() => (
                        setFollow(false),
                        setSelection({
                          transcriptId: currentId,
                          segment,
                          text: phraseEdit?.text ?? segment.text,
                        })
                      )}
                    >
                      Edit phrase
                    </Button>
                  </div>
                  <div className={s.words}>
                    {phraseEdit && !original ? (
                      <button
                        className={s.phrase}
                        onClick={() => seek(segment)}
                        onDoubleClick={() => seek(segment, undefined, true)}
                      >
                        {phraseEdit.text}
                        <small> · phrase timing</small>
                      </button>
                    ) : segment.words.length ? (
                      segment.words.map((word, index) => {
                        const correction = session.edits.find(
                          (e) => e.id === correctionId(currentId, segment.id, index),
                        );
                        const focused =
                          focusedWord?.segment === segment.id && focusedWord.word === index;
                        return (
                          <button
                            key={index}
                            className={`${active && position.time >= word.start && position.time < word.end ? s.active : ''} ${focused ? s.selected : ''} ${word.probability < 0.5 ? s.uncertain : ''}`}
                            data-active-word={
                              active && position.time >= word.start && position.time < word.end
                                ? 'true'
                                : undefined
                            }
                            title={`${time(word.start)} · confidence ${Math.round(word.probability * 100)}%${correction ? ` · original: ${word.text.trim()}` : ''}`}
                            onClick={() => seek(segment, index)}
                            onDoubleClick={() => seek(segment, index, true)}
                          >
                            {!original && correction ? correction.text : word.text}
                          </button>
                        );
                      })
                    ) : (
                      <button onClick={() => seek(segment)}>{segment.text}</button>
                    )}
                  </div>
                  {cue && (
                    <TranscriptCue
                      key={`${currentId}:${segment.id}:${JSON.stringify(session.edits)}`}
                      segment={segment}
                      transcript={selected}
                      session={session}
                      busy={busy}
                      onSeek={(time) => {
                        setFollow(false);
                        background(action(() => api.seek(projectId, session.sourceId, time)));
                      }}
                      onCommand={(type, values) => {
                        setFollow(false);
                        background(
                          action(() => command(segment, type, values.text, undefined, values)),
                        );
                      }}
                    />
                  )}
                </article>
              );
            })}
            {usablePage && !usablePage.segments.length && (
              <p>
                {filter !== 'all'
                  ? 'No matching cues.'
                  : search
                    ? 'No matching phrases.'
                    : 'No speech recognized in this track.'}
              </p>
            )}
          </div>
          <nav className={s.pagination} aria-label="Transcript pages">
            <Button
              aria-label="Previous transcript page"
              disabled={pageIndex === 0}
              onClick={() => {
                setFollow(false);
                setPageIndex(pageIndex - 1);
              }}
            >
              <ChevronLeft size={18} />
            </Button>
            <span>
              Page {pageIndex + 1} · {usablePage?.total || 0} phrases
            </span>
            <Button
              aria-label="Next transcript page"
              disabled={!usablePage || (pageIndex + 1) * 60 >= usablePage.total}
              onClick={() => {
                setFollow(false);
                setPageIndex(pageIndex + 1);
              }}
            >
              <ChevronRight size={18} />
            </Button>
          </nav>
          {hasSelection && (
            <section className={s.editor} aria-label="Transcript correction">
              <p className={s.muted}>
                Linked clips:{' '}
                {session.clips
                  .filter((c) => c.start < selection.segment.end && c.end > selection.segment.start)
                  .map((c) => c.name)
                  .join(', ') || 'No clip at this phrase'}
              </p>
              <h2>
                {selection.wordIndex == null ? 'Phrase correction' : 'Word correction'} ·{' '}
                {time(
                  selection.wordIndex == null
                    ? selection.segment.start
                    : selection.segment.words[selection.wordIndex].start,
                )}
              </h2>
              <p className={s.muted}>
                Original:{' '}
                {selection.wordIndex == null
                  ? selection.segment.text
                  : selection.segment.words[selection.wordIndex].text}
              </p>
              <textarea
                aria-label="Corrected transcript text"
                value={selection.text}
                onChange={(e) => setSelection({ ...selection, text: e.target.value })}
                maxLength={10000}
              />
              <p className={s.muted}>
                {selection.wordIndex == null
                  ? 'Phrase edits keep the original phrase anchor. Individual replacement words have no invented timing.'
                  : 'Correct a proper noun or misheard word. To change the number of words, use Edit phrase.'}{' '}
                Undo is available in the main editor.
              </p>
              <Button
                primary
                disabled={busy || selected.state !== 'complete'}
                onClick={() =>
                  background(
                    action(() =>
                      command(selection.segment, 'correct', selection.text, selection.wordIndex),
                    ),
                  )
                }
              >
                Save correction
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  background(
                    action(() =>
                      command(selection.segment, 'restore', undefined, selection.wordIndex),
                    ),
                  )
                }
              >
                <RotateCcw size={14} /> Restore original
              </Button>
              <Button onClick={() => setSelection(undefined)}>Close edit</Button>
            </section>
          )}
        </>
      )}
      {session && !selected && (
        <div className={s.empty}>
          <h2>Speech, ready to explore</h2>
          <p>
            Choose Transcribe to generate timed text for this recording. Game dialogue and
            microphone notes have separate transcripts.
          </p>
        </div>
      )}
    </main>
  );
}
