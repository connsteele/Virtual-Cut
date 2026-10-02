import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Settings, Download, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import type {
  TranscriptApi,
  TranscriptCommand,
  TranscriptPage,
  TranscriptSegment,
  TranscriptSession,
} from '../../electron/transcript-contracts';
import { correctionId, cueCandidate, reviewedCue } from '../../electron/transcript-edits';
import { TranscriptionOptions, initialTranscriptionOptions } from './TranscriptionOptions';
import { Button, Field } from './ui';
import s from './TranscriptWindow.module.css';

const time = (seconds: number) => {
  const total = Math.floor(seconds),
    ms = Math.floor((seconds - total) * 1000);
  return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};
export function TranscriptWindow() {
  const api = window.virtualCut!.transcript;
  const [session, setSession] = useState<TranscriptSession | null>(null);
  const [sourceId, setSourceId] = useState(''),
    [transcriptId, setTranscriptId] = useState('');
  const [page, setPage] = useState<TranscriptPage>(),
    [pageIndex, setPageIndex] = useState(0),
    [search, setSearch] = useState('');
  const [options, setOptions] = useState(initialTranscriptionOptions);
  const [exportId, setExportId] = useState('');
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
  const [cueEdit, setCueEdit] = useState<{ segment: number; text: string }>();
  const identity = useRef('');
  const acceptSession = useCallback((value: TranscriptSession | null) => {
    const nextIdentity = `${value?.projectId || ''}:${value?.sourceId || ''}`;
    if (identity.current !== nextIdentity) {
      identity.current = nextIdentity;
      setTranscriptId('');
      setPageIndex(0);
      setSearch('');
      setExportId('');
      setSelection(undefined);
      setCueEdit(undefined);
      setError('');
      setNotice('');
    }
    setSession((previous) =>
      JSON.stringify(value) === JSON.stringify(previous) ? previous : value,
    );
  }, []);
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
    void poll();
    const timer = setInterval(() => void poll(), 1200);
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
  const selected =
    session?.transcripts.find((t) => t.id === transcriptId) ||
    session?.transcripts.find((t) => t.state === 'complete') ||
    session?.transcripts[0];
  const currentId = selected?.id || '';
  const projectId = session?.projectId || '';
  const editRevision = JSON.stringify(session?.edits);
  useEffect(() => {
    let alive = true;
    if (!projectId || !currentId) return;
    const timer = setTimeout(
      () => {
        void api
          .page(projectId, currentId, pageIndex, search)
          .then((value) => {
            if (alive) setPage(value);
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
  }, [api, projectId, currentId, pageIndex, search, selected?.state, editRevision]);
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
  function seek(segment: TranscriptSegment, wordIndex?: number) {
    if (!session || !selected) return;
    const word = wordIndex == null ? undefined : segment.words[wordIndex];
    const correction = session.edits.find(
      (e) => e.id === correctionId(selected.id, segment.id, wordIndex),
    );
    setSelection({
      transcriptId: selected.id,
      segment,
      wordIndex,
      text: correction?.text ?? word?.text ?? segment.text,
    });
    const target = word?.start ?? segment.start;
    setPosition({ projectId: session.projectId, sourceId: session.sourceId, time: target });
    void api.seek(session.projectId, session.sourceId, target).catch((e) => setError(String(e)));
  }
  function command(
    segment: TranscriptSegment,
    type: TranscriptCommand['action'],
    text?: string,
    wordIndex?: number,
  ) {
    if (!session || !selected) return Promise.resolve();
    const expected = type.endsWith('cue')
      ? reviewedCue(session.decisions, selected, segment)
      : session.edits.find((e) => e.id === correctionId(selected.id, segment.id, wordIndex));
    return api.command({
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
  const usablePage = page?.transcript.id === currentId ? page : undefined;
  const hasSelection = selection && selection.transcriptId === currentId;
  return (
    <main className={s.window}>
      <header className={s.header}>
        <div>
          <span className={s.brand}>VIRTUAL CUT</span>
          <h1>Transcript</h1>
        </div>
        <Button
          title="Local transcription setup"
          aria-label="Local transcription setup"
          onClick={() => setSetup(!setup)}
        >
          <Settings size={20} />
        </Button>
      </header>
      {!session ? (
        <p>Open a project in the main window to read or generate transcripts.</p>
      ) : (
        <>
          <div className={s.toolbar}>
            <Field label="Recording">
              <select
                value={session.sourceId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setTranscriptId('');
                  setPageIndex(0);
                  setSelection(undefined);
                }}
              >
                {session.recordings.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </Field>
            <Button onClick={() => setStartOpen(!startOpen)} disabled={!session.sourceId}>
              Transcribe…
            </Button>
          </div>
          {startOpen && (
            <section className={s.card} aria-label="Start transcription">
              <TranscriptionOptions value={options} onChange={setOptions} />
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
                disabled={busy || !runtime?.configured}
                onClick={() =>
                  void action(() =>
                    api.start(session.projectId, session.sourceId, session.batchId, options),
                  )
                }
              >
                Start transcription
              </Button>
              {!runtime?.configured && (
                <Button onClick={() => setSetup(true)}>Set up local speech recognition</Button>
              )}
            </section>
          )}
        </>
      )}
      {setup && (
        <section className={s.card} aria-label="Local speech runtime">
          <h2>Local speech recognition</h2>
          <p>
            {runtime?.configured
              ? 'Runtime and model files found.'
              : 'Choose an installed Python runtime, faster-whisper libraries and a downloaded model.'}{' '}
            No audio is uploaded.
          </p>
          {(['python', 'libraries', 'model'] as const).map((part) => (
            <div className={s.setupRow} key={part}>
              <Button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api.configure(part);
                    setRuntime(await api.runtime());
                  })
                }
              >
                Choose {part}…
              </Button>
              <span>{runtime?.settings[part]}</span>
            </div>
          ))}
          <Field label="Recognition device">
            <select
              value={runtime?.settings.device || 'cpu'}
              disabled={busy}
              onChange={(e) =>
                void action(async () => {
                  await api.configure('device', e.target.value as 'cpu' | 'cuda');
                  setRuntime(await api.runtime());
                })
              }
            >
              <option value="cpu">CPU · lower memory use</option>
              <option value="cuda">NVIDIA CUDA · requires compatible CUDA libraries</option>
            </select>
          </Field>
          <p className={s.muted}>
            The worker exits after each job. The downloaded model remains on disk. Changing settings
            applies to the next job.
          </p>
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
              {job.elapsedMs != null && <small> · {(job.elapsedMs / 1000).toFixed(1)} s</small>}
            </div>
            {['running', 'queued'].includes(job.state) && <progress max={1} value={job.progress} />}
            {['running', 'queued'].includes(job.state) && (
              <Button
                disabled={busy}
                onClick={() => void action(() => api.job(session.projectId, job.id, 'pause'))}
              >
                Pause
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() =>
                void action(() =>
                  api.job(
                    session.projectId,
                    job.id,
                    ['running', 'queued'].includes(job.state) ? 'cancel' : 'retry',
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
          <div className={s.toolbar}>
            <Field label="Recognition">
              <select
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
            </Field>
            <Button
              title="Export original words and corrections as JSON"
              disabled={busy || selected.state !== 'complete'}
              onClick={() =>
                void action(async () => {
                  const file = await api.export(
                    projectId,
                    currentId,
                    'json',
                    exportId || undefined,
                  );
                  if (file) setNotice(`Saved ${file}`);
                })
              }
            >
              <Download size={16} /> JSON
            </Button>
            <Button
              title="Export corrected phrases as source-timed subtitles"
              disabled={busy || selected.state !== 'complete'}
              onClick={() =>
                void action(async () => {
                  const file = await api.export(projectId, currentId, 'srt', exportId || undefined);
                  if (file) setNotice(`Saved ${file}`);
                })
              }
            >
              SRT
            </Button>
          </div>
          {!!session.outputs.length && (
            <Field label="Export transcript timing">
              <select value={exportId} onChange={(e) => setExportId(e.target.value)}>
                <option value="">Whole source</option>
                {session.outputs.map((o) => (
                  <option key={o.id} value={o.id}>
                    Completed clip · {o.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className={s.search}>
            <Search size={18} />
            <input
              aria-label="Search transcript"
              placeholder="Search original speech and corrections"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPageIndex(0);
              }}
            />
            <label>
              <input
                type="checkbox"
                checked={original}
                onChange={(e) => setOriginal(e.target.checked)}
              />{' '}
              Original
            </label>
          </div>
          <p className={s.muted}>
            {selected.wordCount} words · {selected.model} · {selected.device} ·{' '}
            {selected.context.gameName || 'No game specified'}
            {selected.context.vocabulary ? ' · vocabulary hints used' : ''}. Click a word to seek.
            Dotted words have low recognition confidence.
          </p>
          {selected.state !== 'complete' && (
            <p>
              Recognition is incomplete. Corrections and cue decisions become available when it
              finishes.
            </p>
          )}
          <div className={s.segments} aria-label="Transcript phrases">
            {usablePage?.segments.map((segment) => {
              const phraseEdit = session.edits.find(
                (e) => e.id === correctionId(currentId, segment.id),
              );
              const cue = cueCandidate(selected, segment),
                decision = cue ? reviewedCue(session.decisions, selected, segment) : undefined;
              const active =
                position.projectId === projectId && position.sourceId === session.sourceId;
              return (
                <article className={s.segment} key={segment.id}>
                  <div className={s.phraseHeading}>
                    <button onClick={() => seek(segment)}>{time(segment.start)}</button>
                    <Button
                      disabled={busy || selected.state !== 'complete'}
                      onClick={() =>
                        setSelection({
                          transcriptId: currentId,
                          segment,
                          text: phraseEdit?.text ?? segment.text,
                        })
                      }
                    >
                      Edit phrase
                    </Button>
                  </div>
                  <div className={s.words}>
                    {phraseEdit && !original ? (
                      <button className={s.phrase} onClick={() => seek(segment)}>
                        {phraseEdit.text}
                        <small> · phrase timing</small>
                      </button>
                    ) : segment.words.length ? (
                      segment.words.map((word, index) => {
                        const correction = session.edits.find(
                          (e) => e.id === correctionId(currentId, segment.id, index),
                        );
                        const focused =
                          hasSelection &&
                          selection.segment.id === segment.id &&
                          selection.wordIndex === index;
                        return (
                          <button
                            key={index}
                            className={`${active && position.time >= word.start && position.time < word.end ? s.active : ''} ${focused ? s.selected : ''} ${word.probability < 0.5 ? s.uncertain : ''}`}
                            title={`${time(word.start)} · confidence ${Math.round(word.probability * 100)}%${correction ? ` · original: ${word.text.trim()}` : ''}`}
                            onClick={() => seek(segment, index)}
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
                    <div className={s.cue}>
                      <strong>
                        {cue.kind === 'cut'
                          ? 'Split'
                          : cue.kind === 'note'
                            ? 'Timed note'
                            : 'Point marker'}{' '}
                        candidate
                      </strong>{' '}
                      · {decision?.status || 'Needs review'}
                      {!decision && (
                        <>
                          <p>
                            Check the audio and timing. This cue is tentative.
                            {cue.kind === 'cut' &&
                              ` Accepting splits at ${time(cue.time)}. For instructions such as “before the transition,” choose the intended cut in the main editor.`}
                          </p>
                          <input
                            aria-label={`Cue text ${segment.id}`}
                            value={cueEdit?.segment === segment.id ? cueEdit.text : cue.text}
                            onChange={(e) =>
                              setCueEdit({ segment: segment.id, text: e.target.value })
                            }
                          />
                          <Button
                            disabled={busy || selected.state !== 'complete'}
                            onClick={() =>
                              void action(() =>
                                command(
                                  segment,
                                  'accept-cue',
                                  cueEdit?.segment === segment.id ? cueEdit.text : cue.text,
                                ),
                              )
                            }
                          >
                            Accept{' '}
                            {cue.kind === 'cut'
                              ? 'split'
                              : cue.kind === 'note'
                                ? 'timed note'
                                : 'marker'}
                          </Button>
                          <Button
                            disabled={busy || selected.state !== 'complete'}
                            onClick={() => void action(() => command(segment, 'reject-cue'))}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {usablePage && !usablePage.segments.length && (
              <p>{search ? 'No matching phrases.' : 'No speech recognized in this track.'}</p>
            )}
          </div>
          <nav className={s.pagination} aria-label="Transcript pages">
            <Button
              aria-label="Previous transcript page"
              disabled={pageIndex === 0}
              onClick={() => setPageIndex(pageIndex - 1)}
            >
              <ChevronLeft size={18} />
            </Button>
            <span>
              Page {pageIndex + 1} · {usablePage?.total || 0} phrases
            </span>
            <Button
              aria-label="Next transcript page"
              disabled={!usablePage || (pageIndex + 1) * 60 >= usablePage.total}
              onClick={() => setPageIndex(pageIndex + 1)}
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
                  void action(() =>
                    command(selection.segment, 'correct', selection.text, selection.wordIndex),
                  )
                }
              >
                Save correction
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void action(() =>
                    command(selection.segment, 'restore', undefined, selection.wordIndex),
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
