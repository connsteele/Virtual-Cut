import { clipMarkers, markerIntersects, relativeMarker } from './marker-ranges.js';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { ProjectStore, type NativeSource } from './project-store.cjs';
import {
  TranscriptionRuntime,
  validateTranscriptionOptions,
  TRANSCRIPTION_PIPELINE,
} from './transcription-runtime.cjs';
import { ScreenTextRuntime } from './screen-text-runtime.cjs';
import { effectiveContext } from './project-context.js';
import type {
  TranscriptionOptions,
  TranscriptSummary,
  TranscriptSession,
} from './transcript-contracts.js' with { 'resolution-mode': 'import' };
import { projectStorageUsage } from './project-storage.cjs';
import {
  planProjectDeletion,
  executeProjectDeletion,
  type DeletionPlan,
} from './project-deletion.cjs';
import { identify, inspectMedia, launchTool } from './media-inspection.cjs';
import { VideoAccess, videoExtensions } from './media.cjs';
import { FilmstripCache, filmstripFile, sweepKeyframes, writeTileFile } from './filmstrip.cjs';
import { inspectRetainedOutput } from './retained-preview.cjs';
import { audioCopyArgs, decodedAudioHash, packetHash, playableAudio } from './audio-copy.cjs';
import type { MediaJob, RecentProject, ImportAudio } from './project-contracts.js' with {
  'resolution-mode': 'import',
};
import type { Model } from './workflow-types.js' with { 'resolution-mode': 'import' };
import { markerColorName } from './workflow-types.js';
import { mergeEdits, validateEdits } from './project-edits.js';
import {
  destinationPlan,
  destinationFolders,
  destinationLocation,
  destinationSelection,
  prepareDestination,
} from './destination-plan.cjs';
import { destinationSignature } from './review-plan.js';
import {
  SNAP_FOLLOW,
  chooseSnap,
  onFrame,
  readBlacks,
  snapArgs,
  snapFromBlacks,
  snapWindow,
  type SplitSnap,
} from './split-snap.js';
import {
  isPass,
  jobLanes,
  laneOf,
  nextJob,
  pictureHold,
  pictureUse,
  pictureYields,
  rank,
  type JobLane,
  type PictureConditions,
} from './job-lanes.js';
import {
  VISUAL_VERSION,
  buildEvents,
  gpuDecoder,
  joinFrames,
  joinStills,
  summarize,
  visualHeight,
  type VisualUse,
} from './visual-events.js';
import { cpuWorkers, gpuReads, runPass, type PassProgress } from './visual-pass.cjs';
import {
  LineJoiner,
  SCREEN_TEXT_VERSION,
  keyframeArgs,
  readSize,
  unchangedSpans,
} from './screen-text.js';
import { readKeyframes } from './screen-text-pass.cjs';
import {
  isNativeProxy,
  isProxyHeight,
  proxyFileName,
  proxyFormat,
  proxyState,
  type NativeProxy,
  type ProxyHeight,
} from './proxy-record.js';
import { isProxySettings, proxySettings, type ProxySettings } from './proxy-settings.js';
import {
  joinSegments,
  makeSegment,
  nvencWorks,
  proxyBytesEstimate,
  proxyPlan,
  proxyProblem,
  readProxy,
  removeFiles,
  type ProxyEncode,
} from './proxy-make.cjs';
import type { DestinationPlan } from './review-plan.js' with { 'resolution-mode': 'import' };
import { reconcileReview, reviewKey } from './review-state.cjs';
import { Diagnostics, errorCode } from './diagnostics.cjs';
import { exportClip as writeClip, verifyPublished, fileHash, annotation } from './clip-export.cjs';
import type {
  ExportContainer,
  ExportContainerChoice,
  ExportInput,
  ExportPlan,
  ExportRecord,
  FilingPlan,
  RetainedClip,
  SubtitleRole,
  TranscriptOutputs,
} from './export-contracts.js' with { 'resolution-mode': 'import' };
import { subtitleSummary, transcriptOutputs, writeSubtitleSidecars } from './subtitle-sidecar.cjs';
import { BatchRecords } from './batch-records.cjs';
import { batchOf } from './batch-record.js';
import { dropLines } from './dropped-lines.js';
import {
  cleanHeardAs,
  heardAsEdits,
  heardAsRules,
  hintVocabulary,
  validHeardAs,
  type HeardAs,
} from './heard-as.js';

async function waveform(file: string, sampleRate: number) {
  const handle = await open(file, 'r');
  try {
    const count = Math.floor((await handle.stat()).size / 4),
      bins = Math.min(2048, count),
      peaks = Array<number>(bins).fill(0);
    if (!count) throw new Error('Waveform data is empty.');
    const buffer = Buffer.alloc(65536);
    let sample = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      for (let offset = 0; offset + 4 <= bytesRead; offset += 4, sample++) {
        const bin = Math.min(bins - 1, Math.floor((sample * bins) / count)),
          value = Math.abs(buffer.readFloatLE(offset));
        if (Number.isFinite(value)) peaks[bin] = Math.max(peaks[bin], Math.min(1, value));
      }
    }
    return { peaks: peaks.map((n) => Math.round(n * 10000) / 10000), duration: count / sampleRate };
  } finally {
    await handle.close();
  }
}

export class ProjectService {
  readonly transcription: TranscriptionRuntime;
  readonly screenText: ScreenTextRuntime;
  /** The agent's first pass beside the exported state, per batch (VC-182). */
  readonly batchRecords: BatchRecords;
  transcriptSession(sourceId?: string): TranscriptSession | null {
    const s = this.store;
    if (!s) return null;
    const source =
      s.data.model.recordings.find((r) => r.id === sourceId) ||
      s.data.model.recordings.find((r) => r.id === s.data.model.selectedRecordingId) ||
      s.data.model.recordings[0];
    const transcripts = source ? s.transcripts.list(source.id) : [];
    const transcriptIds = new Set(transcripts.map((t) => t.id));
    return {
      clips: s.data.model.clips
        .filter((c) => c.rid === source?.id)
        .map((c) => ({
          id: c.id,
          name: c.name,
          start: c.start,
          end: c.end,
          ...(c.color ? { color: c.color } : {}),
          ...(c.note ? { note: c.note } : {}),
        })),
      markers: (source ? s.data.model.markers[source.id] || [] : []).map((m) => ({
        id: m.id,
        name: m.name,
        time: m.time,
        ...(m.end != null ? { end: m.end } : {}),
        color: markerColorName(m),
        note: m.note || '',
      })),
      outputs: s
        .exports()
        .filter((e) => e.state === 'verified' && e.plan.sourceId === source?.id && e.verification)
        .map((e) => ({
          id: e.plan.id,
          name: e.plan.name,
          start: e.verification!.actual.start,
          end: e.verification!.actual.end,
        })),
      projectId: s.data.project.id,
      revision: s.data.revision,
      sourceId: source?.id || '',
      title: source?.title || '',
      position: source?.position || 0,
      recordings: s.data.model.recordings.map((r) => ({ id: r.id, title: r.title })),
      batches: s.data.batches.map((b) => ({ id: b.id, name: b.name })),
      batchId: source?.batchIds?.includes(s.data.activeBatchId)
        ? s.data.activeBatchId
        : source?.batchIds?.[0] || s.data.activeBatchId,
      transcripts,
      edits: (s.data.model.transcriptEdits || []).filter((e) => transcriptIds.has(e.transcriptId)),
      decisions: s.data.model.cueDecisions || [],
      proposals: source ? s.proposals.list(source.id) : [],
      jobs: s
        .jobs()
        .filter((j) => j.kind === 'transcribe' && (!source || j.sourceId === source.id))
        .map((j) => ({
          id: j.id,
          sourceId: j.sourceId,
          state: j.state,
          progress: j.progress,
          message: j.message,
          elapsedMs: j.elapsedMs,
          device: j.device,
          deviceMessage: j.deviceMessage,
        })),
    };
  }
  requestTranscription(
    id: string,
    sourceId: string,
    batchId: string,
    options: TranscriptionOptions,
    origin: 'user' | 'background' = 'user',
  ) {
    const s = this.require(id);
    validateTranscriptionOptions(options);
    const r = s.data.model.recordings.find((r) => r.id === sourceId);
    if (!r || !r.batchIds?.includes(batchId) || r.availability !== 'ready')
      throw new Error('Choose an inspected recording in this batch.');
    if (!this.transcription.configured) throw new Error(this.transcription.problem);
    const effective = effectiveContext(s.data.model.contexts, batchId);
    const heardAs = cleanHeardAs(effective.game?.heardAs);
    const context = {
      gameId: effective.game?.id,
      gameName: effective.game?.name,
      // VC-164 hints carry the game's spellings, including each Heard as row's (VC-194).
      vocabulary: options.vocabulary ? hintVocabulary(effective.game) : '',
      brief: effective.brief,
      ...(heardAs.length ? { heardAs } : {}),
    };
    const contextId = s.transcripts.registerContext(context);
    const runtimeSignature = JSON.stringify({
      ...this.transcription.settings,
      device: options.device || this.transcription.settings.device,
      pipeline: TRANSCRIPTION_PIPELINE,
    });
    for (const role of options.roles) {
      const track = role === 'game' ? r.gameTrack : r.micTrack;
      if (track == null || !r.audioTracks?.some((t) => t.index === track))
        throw new Error(
          `Choose this recording’s ${role === 'mic' ? 'microphone' : 'game'} audio track before transcribing.`,
        );
    }
    for (const role of options.roles) {
      const track = (role === 'game' ? r.gameTrack : r.micTrack)!;
      const previous = s
        .jobs()
        .find(
          (j) =>
            j.kind === 'transcribe' &&
            j.sourceId === sourceId &&
            j.track === track &&
            j.role === role &&
            j.runtimeSignature === runtimeSignature &&
            j.transcription?.contextId === contextId &&
            j.transcription?.language === options.language &&
            j.transcription?.vocabulary === options.vocabulary &&
            ['queued', 'running', 'succeeded'].includes(j.state),
        );
      if (previous) continue;
      s.putJob({
        id: randomUUID(),
        sourceId,
        kind: 'transcribe',
        origin,
        role,
        runtimeSignature,
        track,
        transcription: {
          ...options,
          device: options.device || this.transcription.settings.device,
          batchId,
          contextId,
        },
        state: 'queued',
        progress: 0,
        message: 'Waiting for local speech recognition',
        updated: new Date().toISOString(),
      });
    }
    this.pump();
  }
  async pauseTranscription(id: string, jobId: string) {
    const before = this.require(id)
      .jobs()
      .find((j) => j.id === jobId);
    if (!before || before.kind !== 'transcribe' || !['queued', 'running'].includes(before.state))
      throw new Error('Choose an active transcription job.');
    await this.job(id, jobId, 'cancel');
    const s = this.require(id),
      job = s.jobs().find((j) => j.id === jobId)!;
    if (job.state === 'cancelled')
      s.putJob({
        ...job,
        state: 'interrupted',
        message: 'Paused · worker stopped. Resume restarts this track.',
        updated: new Date().toISOString(),
      });
  }
  async storageUsage(id: string) {
    const store = this.require(id);
    return projectStorageUsage(store.data.project, store.sources(), store.exports());
  }
  private deletions = new Map<string, DeletionPlan>();
  async deletionPlan(id: string) {
    if (this.store?.data.project.id === id)
      throw new Error('Save and close this project before deleting it.');
    const known = await this.recent();
    const project = known.find((p) => p.id === id);
    if (!project) throw new Error('Choose a recent project.');
    const plan = await planProjectDeletion(project, known);
    this.deletions.clear();
    this.deletions.set(plan.token, plan);
    return {
      token: plan.token,
      id: plan.id,
      name: plan.name,
      file: plan.file,
      files: plan.files,
      retained: plan.retained,
      retainedDetails: plan.retainedDetails,
    };
  }
  async deleteProject(id: string, token: string, cleanup: boolean) {
    if (typeof cleanup !== 'boolean') throw new Error('Choose a deletion option.');
    const plan = this.deletions.get(token);
    if (!plan || plan.id !== id || this.store?.data.project.id === id)
      throw new Error('Check the deletion preview again.');
    const known = await this.recent();
    const fresh = await planProjectDeletion({ id, file: plan.file, name: plan.name }, known);
    const selected = (p: DeletionPlan) => p.files.filter((f) => cleanup || f.kind === 'project');
    if (JSON.stringify(selected(fresh)) !== JSON.stringify(selected(plan)))
      throw new Error('Project files or ownership changed. Check deletion again.');
    const result = await executeProjectDeletion(plan, cleanup);
    this.deletions.delete(token);
    const temporary = path.join(this.profile, 'projects.json.tmp');
    await writeFile(temporary, JSON.stringify(known.filter((p) => p.id !== id)));
    await rename(temporary, path.join(this.profile, 'projects.json'));
    return result;
  }
  private filingPlans = new Map<string, { plan: FilingPlan; records: ExportRecord[] }>();
  private destinationCache: { key: string; at: number; plan: DestinationPlan } | null = null;
  private filmstripCache = Object.assign(new FilmstripCache(), {
    onMissing: (sourceId: string) => this.wantFilmstrip(sourceId),
  });
  // Filmstrips are made in the background, one recording at a time, only while the media lane
  // has nothing to start (VC-145); any media job that starts stops the current pass, which is
  // retried later.
  private filmstripBuild: {
    sourceId: string;
    controller: AbortController;
    finished: Promise<void>;
  } | null = null;
  // Recordings opened without a tile file go first.
  private filmstripNext = new Set<string>();
  // Tile files known to exist.
  private filmstripSettled = new Set<string>();
  // Tile files whose pass failed; retried when the project is next opened.
  private filmstripFailed = new Set<string>();
  private retainedDetails = new Map<string, Awaited<ReturnType<typeof inspectRetainedOutput>>>();
  private retainedDetailsProject = '';
  private retainedPreview?: {
    token: string;
    controller: AbortController;
    value?: Awaited<ReturnType<typeof inspectRetainedOutput>>;
  };
  releaseRetained(id?: string, token?: string) {
    if (id) this.require(id);
    if (token && this.retainedPreview?.token !== token) return;
    const retained = this.retainedPreview?.value?.source.id;
    if (retained) this.filmstripCache.forget(retained);
    this.retainedPreview?.controller.abort();
    this.retainedPreview = undefined;
  }
  async inspectRetained(id: string, exportId: string, token: string) {
    const store = this.require(id);
    if (typeof token !== 'string' || !/^[a-f\d-]{36}$/i.test(token))
      throw new Error('Invalid preview request.');
    const record = store
      .exports()
      .find(
        (e) => e.plan.id === exportId && e.state === 'verified' && e.filing?.state === 'complete',
      );
    if (!record?.output) throw new Error('Choose a completed Library clip.');
    this.releaseRetained();
    const task = {
      token,
      controller: new AbortController(),
      value: undefined as Awaited<ReturnType<typeof inspectRetainedOutput>> | undefined,
    };
    this.retainedPreview = task;
    await verifyPublished(record, task.controller.signal);
    if (task.controller.signal.aborted) throw new Error('Cancelled');
    if (this.retainedDetailsProject !== id) {
      this.retainedDetails.clear();
      this.retainedDetailsProject = id;
    }
    const cacheKey = JSON.stringify([exportId, record.output, record.verification?.sha256]);
    const value =
      this.retainedDetails.get(cacheKey) ||
      (await inspectRetainedOutput(
        record.output,
        exportId,
        this.tool('ffprobe'),
        this.tool('ffmpeg'),
        task.controller.signal,
      ));
    if (task.controller.signal.aborted || this.store !== store) throw new Error('Cancelled');
    this.retainedDetails.delete(cacheKey);
    this.retainedDetails.set(cacheKey, value);
    // Bounded indices/peaks only. Never retain output bytes or decoded video surfaces.
    while (
      this.retainedDetails.size > 6 ||
      JSON.stringify([...this.retainedDetails.values()]).length > 8 * 1024 * 1024
    ) {
      this.retainedDetails.delete(this.retainedDetails.keys().next().value!);
    }
    task.value = value;
    return value.recording;
  }
  filmstrip(id: string, sourceId: string, times: number[], token: string) {
    const store = this.require(id);
    const retained = this.retainedPreview?.value;
    const source =
      store.sources().find((s) => s.id === sourceId) ||
      (retained?.source.id === sourceId ? retained.source : undefined);
    const r =
      store.data.model.recordings.find((r) => r.id === sourceId) ||
      (retained?.recording.id === sourceId ? retained.recording : undefined);
    if (!source || !r || r.availability !== 'ready')
      throw new Error('Choose an available recording.');
    if (
      typeof token !== 'string' ||
      !/^[a-f\d-]{36}$/i.test(token) ||
      !Array.isArray(times) ||
      times.length < 1 ||
      times.length > 32 ||
      times.some((t) => !Number.isFinite(t) || t < 0 || t > r.duration)
    )
      throw new Error('Invalid filmstrip request.');
    // Completed outputs carry their session index; project sources keep theirs natively.
    const keys = r.retained ? r.keys : store.frameIndex(sourceId)?.keys;
    if (!keys?.length) throw new Error('Keyframe index is unavailable.');
    return this.filmstripCache.request(
      this.tool('ffmpeg'),
      source,
      r.sourceStart || 0,
      keys,
      times,
      token,
      r.retained ? undefined : filmstripFile(store.data.project.cache, source),
    );
  }
  /** Frame and keyframe timestamps for one project recording, read on demand. */
  frameIndex(id: string, sourceId: string) {
    const store = this.require(id);
    if (typeof sourceId !== 'string' || !sourceId || sourceId.length > 200)
      throw new Error('Choose a recording.');
    return store.frameIndex(sourceId);
  }
  /**
   * The Split snap suggestion for one heard Split (VC-165), measured with FFmpeg on the 5 s
   * before the word. Read only: nothing is stored in the project, and the card decides.
   * Requests run one at a time and are remembered per file revision.
   */
  splitSnap(id: string, sourceId: string, spoken: number): Promise<SplitSnap | null> {
    const store = this.require(id);
    const source = store.sources().find((s) => s.id === sourceId);
    const r = store.data.model.recordings.find((r) => r.id === sourceId);
    if (!source || !r || r.availability !== 'ready')
      throw new Error('Choose an available recording.');
    if (!Number.isFinite(spoken) || spoken < 0 || spoken > r.duration)
      throw new Error('Choose a Split inside this recording.');
    const key = `${source.fingerprint}:${spoken.toFixed(3)}`;
    const known = this.snaps.get(key);
    if (known) return known;
    // The picture pass (VC-180) already found every black screen with the same rule.
    const stored = store.pictureEvents(sourceId, false);
    if (stored) {
      const snap = snapFromBlacks(
        spoken,
        r.duration,
        stored.events.flatMap((e) => (e.kind === 'black' ? [e] : [])),
      );
      return Promise.resolve(
        snap && { ...snap, time: onFrame(snap.time, store.frameIndex(sourceId)?.frameTimes) },
      );
    }
    const offset = r.sourceStart || 0;
    const decode = async (from: number, to: number) => {
      const lines: string[] = [];
      await launchTool(
        this.tool('ffmpeg'),
        snapArgs(source.file, offset + from, to - from),
        AbortSignal.timeout(60_000),
        (line) => {
          if (line.startsWith('lavfi.black_')) lines.push(line);
        },
      );
      return readBlacks(lines, offset);
    };
    const run = this.snapQueue.then(async () => {
      const window = snapWindow(spoken, r.duration);
      const blacks = await decode(window.start, window.end);
      let follow: number | null = null;
      // A black still on screen when decoding stopped: follow it to the frame where it ends.
      if (blacks.at(-1)?.end == null && blacks.length) {
        const to = Math.min(r.duration, window.end + SNAP_FOLLOW);
        // Overlap the window so the remaining black still lasts the detector's 0.1 s.
        const from = Math.max(window.start, window.end - 0.5);
        follow = to > window.end ? ((await decode(from, to))[0]?.end ?? null) : null;
      }
      const snap = chooseSnap(spoken, blacks, window.start, follow);
      if (!snap) return null;
      const frames = store.frameIndex(sourceId)?.frameTimes;
      return { ...snap, time: onFrame(snap.time, frames) };
    });
    this.snapQueue = run.catch(() => undefined);
    this.snaps.set(key, run);
    run.catch(() => this.snaps.delete(key));
    while (this.snaps.size > 500) this.snaps.delete(this.snaps.keys().next().value!);
    return run;
  }
  private snaps = new Map<string, Promise<SplitSnap | null>>();
  private snapQueue: Promise<unknown> = Promise.resolve();
  cancelFilmstrip(id: string, token: string, release = false) {
    this.require(id);
    this.filmstripCache.cancel(token, release === true);
  }
  store: ProjectStore | null = null;
  /** Native changes the renderer did not request directly, such as job progress. */
  onChange?: () => void;
  private grants = new Map<string, { access: VideoAccess; url: string }>();
  // One running job per lane (VC-145): transcription never holds up media work.
  private active: Record<
    JobLane,
    { job: MediaJob; controller: AbortController; finished: Promise<void> } | null
  > = { speech: null, media: null };
  /** Stops the running jobs that match, in every lane, and waits for them to settle. */
  private async stopJobs(match: (job: MediaJob) => boolean = () => true) {
    const stopping = jobLanes
      .map((lane) => this.active[lane])
      .filter((a) => a !== null && match(a.job));
    for (const a of stopping) a!.controller.abort();
    await Promise.all(stopping.map((a) => a!.finished));
  }
  private switching = false;
  constructor(
    private profile: string,
    private toolsDirectory = '',
    private diagnostics?: Diagnostics,
  ) {
    this.transcription = new TranscriptionRuntime(profile, toolsDirectory);
    this.screenText = new ScreenTextRuntime(profile, toolsDirectory);
    this.batchRecords = new BatchRecords(profile);
    this.batchRecords.log = (event, details) => diagnostics?.record(event, details);
  }
  async logToolVersions() {
    for (const tool of ['ffmpeg', 'ffprobe'] as const) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const output = await launchTool(this.tool(tool), ['-version'], controller.signal);
        const version = /version\s+((?:N-)?\d[\w.+-]*)/i.exec(output)?.[1];
        this.diagnostics?.record('tool-version', { tool, version });
      } catch (e) {
        this.diagnostics?.record('operation-failed', { kind: tool, errorCode: errorCode(e) });
      } finally {
        clearTimeout(timer);
      }
    }
  }
  async recent(): Promise<RecentProject[]> {
    try {
      const p = JSON.parse(await readFile(path.join(this.profile, 'projects.json'), 'utf8'));
      return Array.isArray(p)
        ? p.filter(
            (x) =>
              typeof x.id === 'string' && typeof x.name === 'string' && typeof x.file === 'string',
          )
        : [];
    } catch {
      return [];
    }
  }
  async remember() {
    const p = this.store!.data.project;
    const list = [
      { id: p.id, name: p.name, file: p.file },
      ...(await this.recent()).filter((x) => x.id !== p.id),
    ].slice(0, 20);
    await mkdir(this.profile, { recursive: true });
    const temporary = path.join(this.profile, 'projects.json.tmp');
    await writeFile(temporary, JSON.stringify(list));
    await rename(temporary, path.join(this.profile, 'projects.json'));
  }
  require(id?: string) {
    if (!this.store) throw new Error('Open a project first.');
    if (id) this.store.assert(id);
    return this.store;
  }
  async open(file: string, creation?: { name: string; destination: string; cache: string }) {
    if (this.store?.file === file) return this.snapshot();
    // Open/validate the new project before releasing the old one.
    const next = new ProjectStore(file, creation);
    try {
      await mkdir(next.data.project.cache, { recursive: true });
    } catch {
      next.close();
      throw new Error(
        'The preview cache is unavailable. Reconnect its drive before opening this project.',
      );
    }
    try {
      await this.close();
    } catch (e) {
      next.close();
      throw e;
    }
    this.store = next;
    next.changed = () => this.onChange?.();
    for (const job of next
      .jobs()
      .filter((j) => j.kind === 'transcribe' && !['queued', 'running'].includes(j.state))) {
      const source = next.sources().find((s) => s.id === job.sourceId);
      if (
        !source ||
        !/^[a-f\d-]{36}$/i.test(job.id) ||
        !/^[a-f\d-]{36}$/i.test(source.id) ||
        !/^[a-f\d]+$/i.test(source.fingerprint)
      )
        continue;
      const wav = path.join(
        next.data.project.cache,
        `${source.id}-${source.fingerprint}-asr-${job.id}.partial.wav`,
      );
      const info = await lstat(wav).catch(() => null);
      if (info?.isFile() && !info.isSymbolicLink() && info.nlink === 1)
        await unlink(wav).catch(() => {});
    }
    await next.loadCopies();
    this.reconcileExports();
    process.env.VIRTUAL_CUT_MEDIA_TEMP = next.data.project.cache;
    await this.refreshAvailability();
    await this.remember();
    const selected =
      next.data.model.recordings.find((r) => r.id === next.data.model.selectedRecordingId) ||
      next.data.model.recordings[0];
    if (
      selected?.availability === 'ready' &&
      !next.jobs().some((j) => j.sourceId === selected.id && j.state === 'interrupted')
    )
      this.queueAudio(selected.id);
    this.pump();
    return this.snapshot();
  }
  async close() {
    this.switching = true;
    try {
      this.releaseRetained();
      this.retainedDetails.clear();
      await this.stopFilmstrips();
      this.filmstripNext.clear();
      this.filmstripSettled.clear();
      this.filmstripFailed.clear();
      await this.filmstripCache.close();
      await this.stopJobs();
      if (this.pictureTimer) clearInterval(this.pictureTimer);
      this.pictureTimer = undefined;
      this.pictureProgress.clear();
      this.textProgress.clear();
      await this.store?.checkpoint('auto', true);
      this.store?.close();
      this.store = null;
      this.grants.clear();
      this.filingPlans.clear();
    } finally {
      this.switching = false;
    }
  }
  /** The FFmpeg or FFprobe this app runs; the look tool (VC-172) decodes with the same one. */
  tool(name: 'ffmpeg' | 'ffprobe') {
    const bundled = path.join(this.toolsDirectory, name + '.exe');
    return (
      process.env[name === 'ffmpeg' ? 'VIRTUAL_CUT_FFMPEG' : 'VIRTUAL_CUT_FFPROBE'] ||
      (existsSync(bundled) ? bundled : name)
    );
  }
  private async grant(file: string) {
    const cached = this.grants.get(file);
    if (cached) return cached.url;
    const projectId = this.store?.data.project.id;
    const access = new VideoAccess((details) =>
      this.diagnostics?.record('media-read-failed', {
        projectId,
        ...details,
      }),
    );
    const video = await access.select(file);
    this.grants.set(file, { access, url: video.url });
    return video.url;
  }
  private audioFile(source: NativeSource, index: number) {
    const prefix = `${source.id}-${source.fingerprint}-audio-${index}`;
    const name = source.audioPreviews?.[index];
    // Only native cache basenames are accepted, including in an edited project file.
    // Copies made before lossless previews (AAC) have no kind and are made again.
    const valid =
      !!source.audioCopies?.[index] &&
      name?.startsWith(prefix + '-') &&
      /^[a-f0-9-]{36}\.m4a$/.test(name.slice(prefix.length + 1));
    // A missing or older copy resolves to a name that is never written, so it is remade.
    return path.join(this.require().data.project.cache, valid ? name! : prefix + '-pending.m4a');
  }
  respond(request: Request): Promise<Response> | null {
    for (const grant of this.grants.values())
      if (grant.url === request.url) return grant.access.respond(request);
    return null;
  }
  playbackDetails(sourceId: string) {
    const file =
      this.store?.sources().find((source) => source.id === sourceId)?.file ||
      this.store?.exports().find((entry) => entry.plan.id === sourceId)?.output;
    return file ? this.grants.get(file)?.access.diagnostics() || {} : {};
  }
  async refreshAvailability() {
    const store = this.require();
    let dirty = false;
    for (const s of store.sources()) {
      const r = store.data.model.recordings.find((r) => r.id === s.id);
      if (!r) continue;
      const previous = r.availability;
      try {
        const info = await stat(s.file);
        r.availability =
          info.size === s.bytes && info.mtimeMs === s.modified
            ? r.duration
              ? 'ready'
              : previous === 'failed'
                ? 'failed'
                : 'pending'
            : 'changed';
      } catch {
        r.availability = 'missing';
      }
      if (previous !== r.availability) {
        this.releaseRetained();
        this.filmstripCache.forget(s.id);
        dirty = true;
        this.grants.delete(s.file);
      }
    }
    if (dirty) store.write();
  }
  /** A recording's proxy as the windows see it (Sprint 15): from the native record, the file in
   * the cache and any queued or running proxy job. Ready proxies get a playback address. */
  private async proxyFor(store: ProjectStore, source: NativeSource | undefined, jobs: MediaJob[]) {
    if (!source) return { state: 'none' as const };
    const job = jobs.find(
      (j) =>
        j.sourceId === source.id && j.kind === 'proxy' && ['queued', 'running'].includes(j.state),
    );
    const file = isNativeProxy(source.proxy)
      ? path.join(store.data.project.cache, source.proxy.file)
      : undefined;
    const info = file ? await stat(file).catch(() => null) : null;
    const proxy = proxyState(source.proxy, source.fingerprint, info, job);
    if (proxy.state === 'ready' && file)
      try {
        proxy.url = await this.grant(file);
      } catch {
        return { ...proxy, state: 'missing' as const, url: undefined };
      }
    return proxy;
  }
  async snapshot() {
    await this.refreshAvailability();
    const store = this.require();
    const priorReview = JSON.stringify(store.data.model.clips);
    reconcileReview(store.data.model);
    if (priorReview !== JSON.stringify(store.data.model.clips)) store.write();
    const snapshot = store.snapshot();
    snapshot.destinations = structuredClone(await this.checkedDestinations());
    for (const item of snapshot.exports) {
      // The window needs only which roles were kept, not the frozen transcript data.
      if (item.companionTranscripts)
        item.companionTranscripts = {
          requested: item.companionTranscripts.requested,
          items: [],
          included: item.companionTranscripts.items.map((h) => h.transcript.role),
        };
      try {
        item.current = item.inputHash === this.exportInput(item.plan.clipId, false).hash;
      } catch {
        item.current = false;
      }
    }
    snapshot.library = await this.retainedClips();
    snapshot.transcriptRoles = {};
    for (const t of store.transcripts.list())
      if (
        t.state === 'complete' &&
        t.fingerprint === store.sources().find((x) => x.id === t.sourceId)?.fingerprint
      ) {
        const roles = (snapshot.transcriptRoles[t.sourceId] ||= []);
        if (!roles.includes(t.role)) roles.push(t.role);
      }
    for (const clip of snapshot.model.clips) {
      clip.filed =
        !clip.held &&
        snapshot.exports.some(
          (e) =>
            e.plan.clipId === clip.id &&
            e.current &&
            e.filing?.state === 'complete' &&
            e.state === 'verified' &&
            snapshot.library!.some(
              (c) => c.exportId === e.plan.id && c.available && c.metadataAvailable,
            ),
        );
      if (clip.filed) snapshot.destinations.rows.find((row) => row.clipId === clip.id)!.issues = [];
    }
    for (const r of snapshot.model.recordings) {
      const source = store.sources().find((s) => s.id === r.id);
      r.sourceModified = source?.modified;
      r.importedAt = source?.importedAt;
      if (source && r.availability === 'ready') {
        try {
          r.url = await this.grant(source.file);
        } catch {
          r.availability = 'missing';
          r.url = '';
        }
      } else r.url = '';
      for (const track of r.audioTracks || []) {
        const audio = source && this.audioFile(source, track.index);
        if (audio && existsSync(audio)) track.previewUrl = await this.grant(audio);
      }
      r.proxy = await this.proxyFor(store, source, snapshot.jobs);
      // A stable media-pool poster is separate from the in-memory timeline.
      const prefix = path.join(store.data.project.cache, `${r.id}-${source?.fingerprint}`);
      const legacyPoster = `${prefix}-frame-4.jpg`;
      const poster = existsSync(legacyPoster) ? legacyPoster : `${prefix}-frame-0.jpg`;
      r.frames = [];
      r.poster = existsSync(poster) ? await this.grant(poster) : '';
    }
    snapshot.filmstrips = this.filmstripStates(store);
    snapshot.pictures = store.pictureSummaries();
    snapshot.screenText = store.screenTextSummaries();
    snapshot.screenTextEngine = this.screenText.problem;
    if (!existsSync(store.data.project.destination))
      snapshot.warning =
        'The destination folder is offline. Your saved project is still available.';
    return snapshot;
  }
  async save(id: string, before: Model, after: Model) {
    const store = this.require(id),
      previous = store.data.model;
    const accepting = after.clips.filter(
      (c) => c.accepted && !before.clips.find((b) => b.id === c.id)?.accepted,
    );
    if (accepting.length) {
      const revision = store.data.revision;
      const candidate = validateEdits(mergeEdits(before, after, previous));
      const plan = await destinationPlan(
        store.data.project.destination,
        candidate,
        store.sources().map((s) => s.file),
      );
      const rejected = plan.rows.find(
        (r) => accepting.some((c) => c.id === r.clipId) && r.issues.length,
      );
      if (rejected)
        throw new Error('Review the destination plan before accepting: ' + rejected.issues[0]);
      if (revision !== store.data.revision)
        throw new Error(
          'The project changed while checking destinations. Check again before accepting.',
        );
    }
    store.save(before, after);
    for (const r of store.data.model.recordings) {
      const old = previous.recordings.find((x) => x.id === r.id);
      if (
        r.availability === 'ready' &&
        old &&
        (r.gameTrack !== old.gameTrack ||
          r.micTrack !== old.micTrack ||
          r.monitor !== old.monitor ||
          (r.id === store.data.model.selectedRecordingId && r.id !== previous.selectedRecordingId))
      )
        this.queueAudio(r.id);
    }
    this.pump();
    return this.snapshot();
  }
  private async checkedDestinations(force = false) {
    const s = this.require();
    const key = s.data.project.id + s.data.project.destination + destinationSignature(s.data.model);
    if (
      !force &&
      this.destinationCache?.key === key &&
      Date.now() - this.destinationCache.at < 3000
    )
      return this.destinationCache.plan;
    const plan = await destinationPlan(
      s.data.project.destination,
      s.data.model,
      s.sources().map((source) => source.file),
    );
    const held = plan.rows.filter((r) => r.issues.length).map((r) => [r.clipId, r.issues]);
    const priorHeld = this.destinationCache?.plan.rows
      .filter((r) => r.issues.length)
      .map((r) => [r.clipId, r.issues]);
    if (JSON.stringify(held) !== JSON.stringify(priorHeld))
      this.diagnostics?.record('destination-holds', {
        projectId: s.data.project.id,
        count: held.length,
      });
    this.destinationCache = { key, plan, at: Date.now() };
    return plan;
  }
  async destinationPlan(id: string) {
    this.require(id);
    return this.checkedDestinations(true);
  }
  async destinationLocation(id: string, folder: string) {
    const s = this.require(id);
    if (typeof folder !== 'string') throw new Error('Choose a destination folder.');
    return destinationLocation(s.data.project.destination, folder);
  }
  async selectDestination(id: string, selected: string) {
    return destinationSelection(this.require(id).data.project.destination, selected);
  }
  async acceptReview(id: string, clipId: string) {
    const s = this.require(id);
    await this.refreshAvailability();
    reconcileReview(s.data.model);
    const before = structuredClone(s.data.model),
      after = structuredClone(before);
    const clip = after.clips.find((c) => c.id === clipId);
    if (!clip) throw new Error('Choose a clip in this project.');
    clip.accepted = true;
    clip.held = false;
    return this.save(id, before, after);
  }
  async destinationFolders(id: string, folder: string) {
    const s = this.require(id);
    if (typeof folder !== 'string') throw new Error('Choose a destination folder.');
    return destinationFolders(s.data.project.destination, folder);
  }
  async checkpoint(id: string) {
    await this.require(id).checkpoint('manual');
    return this.snapshot();
  }
  /**
   * VC-194: what a game's Heard as rows would correct in this project's finished transcripts of
   * that game, and, with `apply`, the corrections made as one edit (Undo takes them all back).
   */
  async heardAs(id: string, gameId: string, rows: HeardAs[], apply = false) {
    const s = this.require(id);
    if (typeof gameId !== 'string' || !gameId || gameId.length > 200 || !validHeardAs(rows))
      throw new Error('Choose a game with valid heard-as spellings.');
    const rules = heardAsRules(cleanHeardAs(rows)).rules;
    // A transcript is the game's when it was made for the game, or made with no game set while
    // its recording is now in a batch whose game is this one (transcribed before the game was set).
    const ofGame = new Set(
      s.data.model.recordings
        .filter((r) =>
          (r.batchIds || []).some(
            (b) => effectiveContext(s.data.model.contexts, b).game?.id === gameId,
          ),
        )
        .map((r) => r.id),
    );
    const recordings = new Set(s.data.model.recordings.map((r) => r.id));
    const edits: import('./transcript-contracts.js').TranscriptEdit[] = [];
    const heard = new Set<string>();
    let transcripts = 0,
      own = 0;
    for (const transcript of s.transcripts.list())
      if (
        transcript.state === 'complete' &&
        recordings.has(transcript.sourceId) &&
        (transcript.context.gameId === gameId ||
          (!transcript.context.gameId && ofGame.has(transcript.sourceId)))
      ) {
        const found = heardAsEdits(
          s.data.model,
          transcript,
          s.transcripts.segments(transcript.id, -1, false, true),
          rules,
        );
        own += found.own;
        if (found.edits.length) transcripts++;
        for (const edit of found.edits) {
          edits.push(edit);
          heard.add(edit.heardAs!.replace(/^./u, (c) => c.toLocaleUpperCase()));
        }
      }
    const preview = { transcripts, words: edits.length, own, heard: [...heard] };
    if (!apply) return { preview };
    if (edits.length) {
      const model = s.data.model;
      s.save(model, { ...model, transcriptEdits: [...(model.transcriptEdits || []), ...edits] });
    }
    return { preview, snapshot: await this.snapshot() };
  }
  async autosave(id: string) {
    await this.require(id).checkpoint('auto');
    return this.snapshot();
  }
  async sourceLocation(id: string, sourceId: string) {
    const s = this.require(id);
    const source = s.sources().find((item) => item.id === sourceId);
    if (!source || !s.data.model.recordings.some((r) => r.id === sourceId))
      throw new Error('This recording is no longer in the project.');
    if (!(await stat(source.file).catch(() => null))?.isFile())
      throw new Error(
        'The original file is unavailable. Reconnect its drive or relink the recording.',
      );
    return source.file;
  }
  async saveLocation(id: string, saveId: string) {
    const s = this.require(id);
    await s.loadCopies();
    if (!s.snapshot().saves?.some((copy) => copy.id === saveId))
      throw new Error('Choose an available save copy.');
    return path.join(s.file + '.saves', saveId);
  }
  async restore(id: string, saveId: string) {
    this.releaseRetained();
    this.retainedDetails.clear();
    await this.stopFilmstrips();
    this.filmstripCache.clear();
    const store = this.require(id);
    this.switching = true;
    try {
      await this.stopJobs();
      await store.restore(saveId);
      this.reconcileExports();
      await this.refreshAvailability();
      // Cleanup removes disposable previews, not recovery records. Rebuild any
      // missing inspection previews while preserving the restored user's edits.
      for (const r of store.data.model.recordings) {
        const source = store.sources().find((s) => s.id === r.id);
        if (source && r.availability === 'ready') {
          if (
            !existsSync(
              path.join(store.data.project.cache, `${source.id}-${source.fingerprint}-frame-0.jpg`),
            )
          )
            this.enqueue(r.id, 'inspect');
          else this.queueAudio(r.id);
        }
      }
    } finally {
      this.switching = false;
      this.pump();
    }
    return this.snapshot();
  }
  async history(id: string, direction: 'undo' | 'redo') {
    if (!['undo', 'redo'].includes(direction)) throw new Error('Unknown history action.');
    this.require(id).history(direction);
    const selected = this.require().data.model.recordings.find(
      (r) => r.id === this.require().data.model.selectedRecordingId,
    );
    if (selected?.availability === 'ready') this.queueAudio(selected.id);
    return this.snapshot();
  }
  async batch(id: string, name: string) {
    const s = this.require(id);
    if (typeof name !== 'string' || !name.trim() || name.length > 200)
      throw new Error('Give the batch a name.');
    s.transaction(() => {
      const b = { id: randomUUID(), name: name.trim(), created: new Date().toISOString() };
      s.data.batches.push(b);
      s.data.activeBatchId = b.id;
      s.data.revision++;
    });
    return this.snapshot();
  }
  async selectBatch(id: string, batchId: string) {
    const s = this.require(id);
    if (!s.data.batches.some((b) => b.id === batchId)) throw new Error('Batch not found.');
    s.data.activeBatchId = batchId;
    s.write();
    return this.snapshot();
  }
  async removeRecording(id: string, batchId: string, sourceId: string) {
    this.releaseRetained();
    this.retainedDetails.clear();
    if (this.filmstripBuild?.sourceId === sourceId) await this.stopFilmstrips();
    this.filmstripCache.forget(sourceId);
    const s = this.require(id);
    if (!s.data.batches.some((b) => b.id === batchId)) throw new Error('Batch not found.');
    const recording = s.data.model.recordings.find((r) => r.id === sourceId);
    if (!recording?.batchIds?.includes(batchId))
      throw new Error('This recording is no longer in the chosen batch.');
    const otherBatches = recording.batchIds.filter((b) => b !== batchId);
    this.switching = true;
    try {
      // Shared sources remain registered, so their ongoing work can continue.
      if (!otherBatches.length) await this.stopJobs((j) => j.sourceId === sourceId);
      await s.checkpoint('manual');
      s.transaction(() => {
        if (otherBatches.length) recording.batchIds = otherBatches;
        else {
          const model = s.data.model;
          const removedIds = new Set([
            sourceId,
            ...model.clips.filter((c) => c.rid === sourceId).map((c) => c.id),
            ...(model.markers[sourceId] || []).map((m) => m.id),
          ]);
          model.links = model.links.filter(
            (link) => !removedIds.has(link.from) && !removedIds.has(link.to),
          );
          model.recordings = model.recordings.filter((r) => r.id !== sourceId);
          model.clips = model.clips.filter((c) => c.rid !== sourceId);
          model.sequence = model.sequence.filter((e) => e.rid !== sourceId);
          for (const target of model.targets)
            target.items = target.items.filter((e) => e.rid !== sourceId);
          delete model.markers[sourceId];
          delete model.markerBaseline?.[sourceId];
          for (const record of s.exports()) {
            if (record.plan.sourceId !== sourceId || record.state === 'verified') continue;
            s.putExport({
              ...record,
              state: 'cancelled',
              message: 'Recording removed from the project. Restore its save to retry.',
              updated: new Date().toISOString(),
            });
          }
          s.removeSource(sourceId);
        }
        // Recovery includes native registration and batch membership; a manual
        // checkpoint is required instead of a partial editorial undo.
        s.clearHistory();
        const available = s.data.model.recordings.filter((r) =>
          r.batchIds?.includes(s.data.activeBatchId),
        );
        if (!available.some((r) => r.id === s.data.model.selectedRecordingId))
          s.data.model.selectedRecordingId = available[0]?.id || '';
        s.data.revision++;
      });
    } finally {
      this.switching = false;
      this.pump();
    }
    // This action changes project records only. Originals, published exports
    // and previews remain on disk, including media needed by saved checkpoints.
    return this.snapshot();
  }
  async deleteBatch(
    id: string,
    batchId: string,
    targetId?: string,
    mode: 'preserve' | 'remove' = 'preserve',
  ) {
    this.releaseRetained();
    this.retainedDetails.clear();
    const s = this.require(id);
    if (!['preserve', 'remove'].includes(mode)) throw new Error('Choose how to remove this batch.');
    if (!s.data.batches.some((b) => b.id === batchId)) throw new Error('Batch not found.');
    const remaining = s.data.batches.filter((b) => b.id !== batchId);
    if (targetId && !remaining.some((b) => b.id === targetId))
      throw new Error('Choose an existing batch for the remaining recordings.');
    const removed = new Set(
      mode === 'remove'
        ? s.data.model.recordings
            .filter(
              (r) => r.batchIds?.includes(batchId) && !r.batchIds.some((id) => id !== batchId),
            )
            .map((r) => r.id)
        : [],
    );
    const native = s.sources().filter((source) => removed.has(source.id));
    if (this.filmstripBuild && removed.has(this.filmstripBuild.sourceId))
      await this.stopFilmstrips();
    for (const sourceId of removed) this.filmstripCache.forget(sourceId);
    const originals = new Set(
      (
        await Promise.all(
          s.sources().map((source) => realpath(source.file).catch(() => path.resolve(source.file))),
        )
      ).map((file) => file.toLowerCase()),
    );
    this.switching = true;
    let cleanup:
      | { cacheFilesRemoved: number; cacheFilesRetained: number; cacheCleanupIncomplete?: boolean }
      | undefined;
    try {
      await this.stopJobs((j) => removed.has(j.sourceId));
      await s.checkpoint('manual');
      s.transaction(() => {
        const target = remaining.find((b) => b.id === targetId) ||
          remaining[0] || {
            id: randomUUID(),
            name: 'Unbatched',
            created: new Date().toISOString(),
          };
        s.data.batches = remaining.length ? remaining : [target];
        for (const r of s.data.model.recordings) {
          if (!r.batchIds?.includes(batchId)) continue;
          const other = r.batchIds.filter((id) => id !== batchId);
          r.batchIds = other.length ? other : [target.id];
        }
        if (removed.size) {
          s.data.model.recordings = s.data.model.recordings.filter((r) => !removed.has(r.id));
          s.data.model.clips = s.data.model.clips.filter((c) => !removed.has(c.rid));
          s.data.model.sequence = s.data.model.sequence.filter((e) => !removed.has(e.rid));
          for (const target of s.data.model.targets)
            target.items = target.items.filter((e) => !removed.has(e.rid));
          for (const sourceId of removed) {
            delete s.data.model.markers[sourceId];
            delete s.data.model.markerBaseline?.[sourceId];
            s.removeSource(sourceId);
          }
          // Editorial undo must not resurrect records whose native registration
          // was removed. The protective checkpoint is the recovery mechanism.
          s.clearHistory();
        }
        if (s.data.activeBatchId === batchId) s.data.activeBatchId = target.id;
        const records = s.data.model.recordings.filter((r) =>
          r.batchIds?.includes(s.data.activeBatchId),
        );
        if (!records.some((r) => r.id === s.data.model.selectedRecordingId))
          s.data.model.selectedRecordingId = records[0]?.id || '';
        s.data.revision++;
      });
      if (mode === 'remove') {
        cleanup = { cacheFilesRemoved: 0, cacheFilesRetained: 0 };
        try {
          const cache = await realpath(s.data.project.cache);
          const prefixes = native
            .filter(
              (source) =>
                /^[a-f\d-]{36}$/i.test(source.id) && /^[a-f\d]{64}$/i.test(source.fingerprint),
            )
            .map((source) => `${source.id}-${source.fingerprint}`);
          const suffix =
            /^-(?:frame-[0-7](?:\.partial)?\.jpg|filmstrip(?:\.partial)?\.bin|audio-\d+(?:-[a-f\d-]{36})?(?:\.partial)?\.(?:m4a|f32)|asr-[a-f\d-]{36}\.partial\.wav|(?:[a-f\d]{8}-s\d{4}-)?proxy-(?:1080|720)p(?:\.partial)?\.mp4)$/i;
          for (const entry of await readdir(cache, { withFileTypes: true })) {
            if (!entry.isFile() || entry.isSymbolicLink()) continue;
            const prefix = prefixes.find(
              (prefix) =>
                entry.name.startsWith(prefix) && suffix.test(entry.name.slice(prefix.length)),
            );
            if (!prefix) continue;
            const file = path.resolve(cache, entry.name);
            if (path.dirname(file) !== cache || originals.has(file.toLowerCase())) continue;
            try {
              // Never follow a changed cache entry or unlink another hard link.
              const info = await lstat(file);
              if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) {
                cleanup.cacheFilesRetained++;
                continue;
              }
              this.grants.delete(file);
              await unlink(file);
              cleanup.cacheFilesRemoved++;
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code !== 'ENOENT') cleanup.cacheFilesRetained++;
            }
          }
          for (const source of native) this.grants.delete(source.file);
        } catch {
          cleanup.cacheCleanupIncomplete = true;
        }
      }
    } finally {
      this.switching = false;
      this.pump();
    }
    return { ...(await this.snapshot()), cleanup };
  }
  async gather(folder: string): Promise<string[]> {
    const files: string[] = [];
    const cache = this.require().data.project.cache;
    const visit = async (dir: string) => {
      if (path.resolve(dir).toLowerCase() === path.resolve(cache).toLowerCase()) return;
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
        const file = path.join(dir, e.name);
        if (e.isDirectory()) await visit(file);
        else if (videoExtensions.includes(path.extname(file).slice(1).toLowerCase()))
          files.push(file);
        if (files.length > 10000)
          throw new Error('Choose a smaller folder (up to 10,000 recordings per import).');
      }
    };
    await visit(folder);
    return files;
  }
  async importFiles(id: string, batchId: string, files: string[], audio?: ImportAudio) {
    const s = this.require(id);
    const batch = s.data.batches.find((b) => b.id === batchId);
    if (!batch) throw new Error('Choose a batch first.');
    const defaults = audio || batch.audioDefaults || { game: 1, mic: null };
    if (defaults.transcription) {
      validateTranscriptionOptions(defaults.transcription);
      if (!this.transcription.configured)
        throw new Error(
          `${this.transcription.problem} You can also import now and transcribe later.`,
        );
    }
    for (const value of [defaults.game, defaults.mic])
      if (value != null && (!Number.isInteger(value) || value < 1 || value > 64))
        throw new Error('Choose an audio track number from 1 to 64.');
    if (defaults.game != null && defaults.game === defaults.mic)
      throw new Error('Game audio and microphone notes need different tracks.');
    if (defaults.proxy !== undefined && typeof defaults.proxy !== 'boolean')
      throw new Error('Choose whether to make proxies during this import.');
    const proxies = proxySettings(s.data.proxies);
    const makeProxy = defaults.proxy === true && proxies.onImport !== 'never';
    const { proxy: _proxy, ...remembered } = defaults;
    batch.audioDefaults = remembered;
    for (const file of files) {
      if (!videoExtensions.includes(path.extname(file).slice(1).toLowerCase())) continue;
      const sourceId = randomUUID();
      try {
        const native = { ...(await identify(file, sourceId)), importedAt: Date.now() };
        this.require(id);
        const existing = s
          .sources()
          .find(
            (x) =>
              x.file.toLowerCase() === native.file.toLowerCase() &&
              x.fingerprint === native.fingerprint,
          );
        if (existing) {
          const r = s.data.model.recordings.find((r) => r.id === existing.id)!;
          r.batchIds = [...new Set([...(r.batchIds || []), batchId])];
          if (existing.modified !== native.modified) {
            s.putSource({
              ...native,
              id: existing.id,
              importedAt: existing.importedAt,
              audioPreviews: existing.audioPreviews,
              audioCopies: existing.audioCopies,
              proxy: existing.proxy,
            });
            r.availability = r.duration ? 'ready' : 'pending';
            this.grants.delete(existing.file);
          }
          s.write();
          if (defaults.transcription && r.availability === 'ready')
            this.requestTranscription(id, r.id, batchId, defaults.transcription, 'background');
          if (
            makeProxy &&
            r.availability === 'ready' &&
            !(await this.hasProxy(
              s,
              s.sources().find((x) => x.id === existing.id)!,
              proxies.height,
            ))
          )
            this.enqueueProxy(r.id, 'background', proxies.height);
          continue;
        }
        s.transaction(() => {
          s.putSource(native);
          s.data.model.recordings.push({
            id: sourceId,
            title: path.parse(file).name,
            url: '',
            poster: '',
            frames: [],
            base: 0,
            duration: 0,
            position: 0,
            sample: false,
            context: '',
            fullResolution: true,
            sourcePath: native.file,
            batchIds: [batchId],
            availability: 'pending',
            importAudio: makeProxy ? { ...remembered, proxy: true } : remembered,
          });
          s.data.model.markers[sourceId] = [];
          s.data.revision++;
          this.enqueue(sourceId, 'inspect', undefined, 'user');
        });
      } catch (e) {
        s.putJob({
          id: randomUUID(),
          sourceId,
          kind: 'inspect',
          state: 'failed',
          progress: 0,
          message: `${path.basename(file)}: ${e instanceof Error ? e.message : String(e)}`,
          updated: new Date().toISOString(),
        });
      }
    }
    this.pump();
    return this.snapshot();
  }
  private enqueue(
    sourceId: string,
    kind: 'inspect' | 'audio',
    track?: number,
    origin: 'user' | 'background' = 'background',
  ) {
    const s = this.require();
    if (
      s
        .jobs()
        .some(
          (j) =>
            j.sourceId === sourceId &&
            j.kind === kind &&
            j.track === track &&
            ['queued', 'running'].includes(j.state),
        )
    )
      return;
    s.putJob({
      id: randomUUID(),
      sourceId,
      kind,
      origin,
      track,
      state: 'queued',
      progress: 0,
      message: 'Waiting',
      updated: new Date().toISOString(),
    });
  }
  private queueAudio(sourceId: string, origin: 'user' | 'background' = 'background') {
    const s = this.require(),
      r = s.data.model.recordings.find((r) => r.id === sourceId);
    if (!r || r.availability !== 'ready')
      throw new Error('Wait for inspection or relink this recording.');
    const native = s.sources().find((x) => x.id === sourceId)!;
    for (const index of new Set([r.gameTrack, r.micTrack]))
      if (
        index != null &&
        (!r.audioTracks?.find((t) => t.index === index)?.waveform ||
          !existsSync(this.audioFile(native, index)))
      )
        this.enqueue(sourceId, 'audio', index, origin);
    this.pump();
  }
  async prepareAudio(id: string, sourceId: string) {
    this.require(id);
    this.queueAudio(sourceId, 'user');
    return this.snapshot();
  }
  private exportInput(clipId: string, requireAvailable = true) {
    const s = this.require(),
      clip = s.data.model.clips.find((c) => c.id === clipId),
      r = s.data.model.recordings.find((r) => r.id === clip?.rid),
      source = s.sources().find((x) => x.id === clip?.rid);
    if (!clip || !r || !source || (requireAvailable && r.availability !== 'ready'))
      throw new Error('Select an available clip after inspection.');
    if (
      r.gameTrack == null ||
      !r.audioTracks?.some((t) => t.index === r.gameTrack) ||
      r.gameTrack === r.micTrack
    )
      throw new Error('Choose a separate game-audio track in Source & audio setup.');
    const input: ExportInput = {
      clip: structuredClone(clip),
      markers: structuredClone(s.data.model.markers[r.id] || []),
      context: r.context,
      gameTrack: r.gameTrack,
      micTrack: r.micTrack ?? null,
      sourceFile: source.file,
      sourceFingerprint: source.fingerprint,
      sourceBytes: source.bytes,
      sourceModified: source.modified,
      sourceStart: r.sourceStart || 0,
      duration: r.duration,
      captureTime: r.captureTime,
    };
    // Review flags and playback position do not change the export payload.
    const clipPayload = { ...input.clip };
    delete clipPayload.accepted;
    delete clipPayload.acceptedKey;
    delete clipPayload.held;
    delete clipPayload.holdReason;
    delete clipPayload.filed;
    const payload = { ...clipPayload, include: undefined };
    const hash = createHash('sha256')
      .update(JSON.stringify({ ...input, clip: payload }))
      .digest('hex');
    return { input, hash, recording: r };
  }
  /**
   * The Open video viewer has no project cache. When its first audio stream is one
   * browsers cannot play, write a verified lossless copy to `target` and return the
   * time that copy starts at on the video's clock.
   */
  async openedVideoAudio(file: string, target: string, signal: AbortSignal) {
    const data = JSON.parse(
      await launchTool(
        this.tool('ffprobe'),
        [
          '-v',
          'error',
          '-show_entries',
          'stream=index,codec_type,codec_name,start_time',
          '-of',
          'json',
          file,
        ],
        signal,
      ),
    ) as {
      streams?: { index: number; codec_type: string; codec_name?: string; start_time?: string }[];
    };
    const track = data.streams?.find((x) => x.codec_type === 'audio');
    if (!track?.codec_name || playableAudio(track.codec_name)) return null;
    const partial = target + '.partial';
    try {
      await launchTool(
        this.tool('ffmpeg'),
        [
          '-v',
          'error',
          '-nostdin',
          ...audioCopyArgs(file, track.index, track.codec_name, 0),
          '-f',
          'mp4',
          '-y',
          partial,
        ],
        signal,
      );
      const [original, copied] = await Promise.all([
        decodedAudioHash(this.tool('ffmpeg'), file, track.index, signal),
        decodedAudioHash(this.tool('ffmpeg'), partial, 0, signal),
      ]);
      if (original !== copied) throw new Error('The audio copy did not match the original.');
      await rename(partial, target);
    } catch (e) {
      await unlink(partial).catch(() => {});
      throw e;
    }
    return { offset: Number(track.start_time) || 0 };
  }
  /**
   * Game audio browsers cannot play (ALAC, PCM) is exported from its lossless copy, the
   * same FLAC heard while cutting. Other codecs are copied from the original as before.
   */
  private async exportAudio(record: ExportRecord) {
    const s = this.require(),
      native = s.sources().find((x) => x.id === record.plan.sourceId),
      codec = s.data.model.recordings
        .find((r) => r.id === record.plan.sourceId)
        ?.audioTracks?.find((t) => t.index === record.input.gameTrack)?.codec;
    if (!native || playableAudio(codec)) return undefined;
    const copy = native.audioCopies?.[record.input.gameTrack],
      file = this.audioFile(native, record.input.gameTrack),
      info = await stat(file).catch(() => null);
    if (copy?.kind !== 'flac' || info?.size !== copy.bytes || info.mtimeMs !== copy.modified) {
      this.queueAudio(native.id);
      throw new Error(
        'The game audio’s lossless copy is being prepared. Retry this export when audio preparation finishes.',
      );
    }
    return file;
  }
  private reconcileExports() {
    const s = this.require();
    for (let record of s.exports()) {
      if (['queued', 'running'].includes(record.state)) {
        record = {
          ...record,
          state: 'interrupted',
          message: 'Export interrupted. Retry from Jobs.',
          updated: new Date().toISOString(),
        };
        s.putExport(record);
      }
      if (
        !['planned', 'verified'].includes(record.state) &&
        !s.jobs().some((j) => j.id === record.plan.id) &&
        s.sources().some((source) => source.id === record.plan.sourceId)
      )
        s.putJob({
          id: record.plan.id,
          sourceId: record.plan.sourceId,
          kind: 'export',
          state: record.state === 'cancelled' ? 'cancelled' : 'interrupted',
          progress: 0,
          message: record.message,
          updated: record.updated,
        });
    }
  }
  private planClip(clipId: string, choice: ExportContainerChoice): ExportRecord {
    const s = this.require();
    if (!['source', 'mp4', 'mkv'].includes(choice))
      throw new Error('Choose Same as source, MP4 or MKV.');
    const { input, hash, recording } = this.exportInput(clipId),
      { start, end } = input.clip;
    const container = (
      choice === 'source' ? path.extname(input.sourceFile).slice(1).toLowerCase() : choice
    ) as ExportContainer;
    if (!['mp4', 'mkv', 'mov', 'm4v', 'webm'].includes(container))
      throw new Error('This source container is not supported for copying yet. Choose MP4 or MKV.');
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end > input.duration + 0.000001 ||
      end <= start
    )
      throw new Error('Give this clip a valid range within the recording.');
    const keys = [...(s.frameIndex(recording.id)?.keys || [])].sort((a, b) => a - b);
    const lower = keys.filter((t) => t <= start + 0.000001).at(-1),
      upper = keys.find((t) => t >= end - 0.000001) ?? input.duration;
    if (lower == null || upper <= lower)
      throw new Error('Usable outward keyframes are unavailable.');
    const plan: ExportPlan = {
      id: randomUUID(),
      clipId,
      sourceId: input.clip.rid,
      name: input.clip.name,
      sourceName: recording.title,
      gameTrack: input.gameTrack,
      container,
      requested: { start, end },
      planned: { start: lower, end: upper },
      revision: s.data.revision,
      created: new Date().toISOString(),
    };
    return {
      plan,
      annotationVersion: 4,
      markerScope: 'clip',
      input,
      inputHash: hash,
      state: 'planned',
      message: 'Ready to choose an output file.',
      updated: plan.created,
    };
  }
  async exportPlan(id: string, clipId: string, choice: ExportContainerChoice): Promise<ExportPlan> {
    const s = this.require(id),
      record = this.planClip(clipId, choice);
    s.discardExportPlans();
    s.putExport(record);
    return record.plan;
  }
  async startExport(
    id: string,
    planId: string,
    output: string,
    cleanGameConfirmed: boolean,
    transcript?: TranscriptOutputs,
  ) {
    const s = this.require(id),
      record = s.exports().find((e) => e.plan.id === planId),
      outputs = transcriptOutputs(transcript);
    if (!record || !['planned', 'failed', 'cancelled', 'interrupted'].includes(record.state))
      throw new Error('Make a new export plan.');
    if (cleanGameConfirmed !== true)
      throw new Error('Confirm that the selected game track has no microphone mixed into it.');
    if (record.inputHash !== this.exportInput(record.plan.clipId).hash)
      throw new Error(
        'The clip or its annotations changed. Reopen the export dialog to review a new plan.',
      );
    const directory = await realpath(path.dirname(output)),
      resolved = path.join(directory, path.basename(output));
    if (path.extname(resolved).toLowerCase() !== '.' + record.plan.container)
      throw new Error('Use the selected container extension for the output.');
    const cache = await realpath(s.data.project.cache);
    if (resolved.toLowerCase().startsWith(cache.toLowerCase() + path.sep))
      throw new Error('Save finished clips outside the disposable preview cache.');
    if (s.sources().some((x) => path.resolve(x.file).toLowerCase() === resolved.toLowerCase()))
      throw new Error('Choose a new file, separate from every original recording.');
    const next: ExportRecord = {
      ...record,
      output: resolved,
      metadata: resolved + '.vcut.json',
      cleanGameConfirmed: true,
      ...this.transcriptRequest(record, outputs),
      state: 'queued',
      verification: resolved === record.output ? record.verification : undefined,
      started: undefined,
      elapsedMs: undefined,
      message: 'Waiting to export',
      updated: new Date().toISOString(),
    };
    s.putExport(next);
    s.putJob({
      id: planId,
      sourceId: record.plan.sourceId,
      kind: 'export',
      origin: 'user',
      state: 'queued',
      progress: 0,
      message: next.message,
      updated: next.updated,
    });
    this.batchRecords.exported(
      s,
      batchOf(s.data.model, s.data.activeBatchId, record.plan.sourceId),
    );
    this.pump();
    return this.snapshot();
  }
  async exportLocation(id: string, exportId: string, kind: 'video' | 'metadata') {
    const record = this.require(id)
      .exports()
      .find((e) => e.plan.id === exportId);
    if (!record || record.state !== 'verified' || !['video', 'metadata'].includes(kind))
      throw new Error('Choose a verified export.');
    const file = kind === 'video' ? record.output : record.metadata;
    if (!file || !existsSync(file)) throw new Error('The exported file is offline or has moved.');
    return file;
  }
  async filingPlan(id: string, batchId: string): Promise<FilingPlan> {
    const s = this.require(id);
    if (!s.data.batches.some((b) => b.id === batchId)) throw new Error('Choose a batch first.');
    this.destinationCache = null;
    const snapshot = await this.snapshot();
    const plan: FilingPlan = {
      id: randomUUID(),
      batchId,
      root: s.data.project.destination,
      rows: [],
    };
    const records: ExportRecord[] = [];
    for (const clip of snapshot.model.clips.filter(
      (c) =>
        c.accepted &&
        !c.held &&
        !c.filed &&
        snapshot.model.recordings.find((r) => r.id === c.rid)?.batchIds?.includes(batchId),
    )) {
      const row: FilingPlan['rows'][number] = {
        clipId: clip.id,
        name: clip.name,
        path: snapshot.destinations!.rows.find((r) => r.clipId === clip.id)?.path || '',
        folder: clip.folder,
        issues: [...(snapshot.destinations!.rows.find((r) => r.clipId === clip.id)?.issues || [])],
      };
      plan.rows.push(row);
      if (
        s
          .exports()
          .some(
            (e) => e.filing && e.plan.clipId === clip.id && ['queued', 'running'].includes(e.state),
          )
      )
        row.issues.push('This clip is already being filed.');
      try {
        const record = this.planClip(clip.id, 'source');
        const r = s.data.model.recordings.find((r) => r.id === clip.rid)!;
        row.requested = record.plan.requested;
        row.planned = record.plan.planned;
        record.filing = {
          queueId: plan.id,
          batchId,
          reviewKey: clip.acceptedKey!,
          root: await realpath(plan.root),
          folder: clip.folder,
          state: 'queued',
          media: { width: r.width, height: r.height, fps: r.fps },
        };
        record.output = row.path;
        record.metadata = row.path + '.vcut.json';
        records.push(record);
      } catch (e) {
        row.issues.push(e instanceof Error ? e.message : String(e));
      }
    }
    this.filingPlans.clear();
    this.filingPlans.set(plan.id, { plan, records });
    return plan;
  }
  /**
   * What the transcript option asks of this export. Companion history is frozen now, so verifying
   * or retrying later reproduces exactly the same .vcut.json.
   */
  private transcriptRequest(record: ExportRecord, outputs: TranscriptOutputs) {
    const { start, end } = record.plan.planned,
      margin = 5;
    const items = outputs.companion
      ? outputs.roles.flatMap((role) => {
          const found = this.subtitleSource(record, role);
          if (!found) return [];
          const segments = [...found.segments].filter(
            (x) => x.end > start - margin && x.start < end + margin,
          );
          const ids = new Set(segments.map((x) => x.id));
          const edits = (found.model.transcriptEdits || []).filter(
            (e) => e.transcriptId === found.transcript.id && ids.has(e.segmentId),
          );
          return [{ transcript: found.transcript, segments, edits }];
        })
      : [];
    return {
      subtitles: outputs.srt
        ? { requested: outputs.roles, named: true as const, written: [], skipped: [] }
        : undefined,
      companionTranscripts: outputs.companion
        ? { requested: outputs.roles, items: structuredClone(items) }
        : undefined,
    };
  }
  /** The latest finished transcript of this role for the export's recording (one per role). */
  private subtitleSource(record: ExportRecord, role: SubtitleRole) {
    const s = this.require(),
      source = s.sources().find((x) => x.id === record.plan.sourceId),
      transcript = s.transcripts
        .list(record.plan.sourceId)
        .find(
          (t) => t.role === role && t.state === 'complete' && t.fingerprint === source?.fingerprint,
        );
    return transcript
      ? { transcript, segments: s.transcripts.segments(transcript.id), model: s.data.model }
      : undefined;
  }
  private assertFilingCurrent(record: ExportRecord) {
    if (!record.filing) return;
    const s = this.require(),
      clip = s.data.model.clips.find((c) => c.id === record.plan.clipId);
    if (
      !clip?.accepted ||
      clip.held ||
      clip.acceptedKey !== record.filing.reviewKey ||
      reviewKey(s.data.model, clip) !== record.filing.reviewKey ||
      this.exportInput(clip.id).hash !== record.inputHash
    )
      throw new Error(
        'This accepted clip changed or was held. Review and accept the current edits before filing.',
      );
  }
  async fileQueue(id: string, planId: string, confirmed: boolean, transcript?: TranscriptOutputs) {
    const s = this.require(id),
      saved = this.filingPlans.get(planId),
      outputs = transcriptOutputs(transcript);
    if (!saved || !saved.records.length || saved.plan.rows.some((r) => r.issues.length))
      throw new Error('Check an eligible filing plan first.');
    if (confirmed !== true)
      throw new Error(
        'Confirm that each selected game track is clean, with no microphone mixed in.',
      );
    // Consume before any await so two clicks cannot submit the same plan.
    this.filingPlans.delete(planId);
    for (const record of saved.records) this.assertFilingCurrent(record);
    const checked = await this.checkedDestinations(true);
    if (
      saved.records.some((e) => checked.rows.find((r) => r.clipId === e.plan.clipId)?.issues.length)
    )
      throw new Error('A destination changed. Check the filing plan again.');
    for (const record of saved.records) {
      const destination = await prepareDestination(
        s.data.project.destination,
        record.filing!.folder,
        record.filing!.root,
      );
      record.output = path.join(destination.directory, path.basename(record.output!));
      record.metadata = record.output + '.vcut.json';
      const cache = await realpath(s.data.project.cache);
      if (record.output.toLowerCase().startsWith(cache.toLowerCase() + path.sep))
        throw new Error('File finished clips outside the preview cache.');
      this.assertFilingCurrent(record);
    }
    // Filing is a deliberate durable operation, with the accepted plan saved
    // before any job starts. Ordinary transport and edits keep the timed policy.
    await s.checkpoint('manual');
    if (this.store !== s) throw new Error('The project changed. Check a new filing plan.');
    for (const record of saved.records) {
      this.assertFilingCurrent(record);
      if (
        s
          .exports()
          .some(
            (e) =>
              e.filing &&
              e.plan.clipId === record.plan.clipId &&
              ['queued', 'running'].includes(e.state),
          )
      )
        throw new Error('This clip is already being filed. Check the filing plan again.');
    }
    s.transaction(() => {
      for (const record of saved.records) {
        record.cleanGameConfirmed = true;
        Object.assign(record, this.transcriptRequest(record, outputs));
        record.state = 'queued';
        record.message = 'Waiting to file';
        s.putExport(record);
        s.putJob({
          id: record.plan.id,
          sourceId: record.plan.sourceId,
          kind: 'export',
          origin: 'user',
          state: 'queued',
          progress: 0,
          message: record.message,
          updated: record.updated,
        });
      }
    });
    this.batchRecords.exported(s, saved.plan.batchId);
    this.pump();
    return this.snapshot();
  }
  async cancelFiling(id: string, queueId: string) {
    const s = this.require(id),
      records = s.exports().filter((e) => e.filing?.queueId === queueId);
    if (!records.length) throw new Error('Choose a filing queue.');
    s.transaction(() => {
      for (const record of records.filter((e) => e.state === 'queued')) {
        s.putExport({
          ...record,
          state: 'cancelled',
          message: 'Filing cancelled',
          updated: new Date().toISOString(),
        });
        const job = s.jobs().find((j) => j.id === record.plan.id)!;
        s.putJob({
          ...job,
          state: 'cancelled',
          message: 'Filing cancelled',
          updated: new Date().toISOString(),
        });
      }
    });
    await this.stopJobs((j) => records.some((e) => e.plan.id === j.id));
    return this.snapshot();
  }
  private async retainedClips(): Promise<RetainedClip[]> {
    const s = this.require();
    return Promise.all(
      s
        .exports()
        .filter(
          (e) =>
            e.state === 'verified' &&
            e.filing?.state === 'complete' &&
            e.output &&
            e.metadata &&
            e.verification,
        )
        .map(async (e) => {
          const info = await lstat(e.output!).catch(() => null),
            meta = await lstat(e.metadata!).catch(() => null);
          const expectedDate = e.input.sourceModified + e.plan.requested.start * 1000;
          return {
            exportId: e.plan.id,
            name: e.plan.name,
            output: e.output!,
            // The receipt's original folder remains provenance; Library displays
            // the current output location, including a verified relink.
            folder: (() => {
              const relative = path.relative(s.data.project.destination, path.dirname(e.output!));
              return relative === '..' ||
                relative.startsWith('..' + path.sep) ||
                path.isAbsolute(relative)
                ? path.dirname(e.output!)
                : relative.split(path.sep).join('/');
            })(),
            source: e.input.sourceFile,
            completedAt: e.filing!.completedAt!,
            duration: e.verification!.actual.end - e.verification!.actual.start,
            video: e.verification!.videoCodec,
            note: e.input.clip.note || '',
            context: e.input.context,
            markers:
              e.markerScope === 'clip'
                ? clipMarkers(
                    e.input.markers,
                    e.plan.requested,
                    e.verification!.constantFrameDuration ?? 1 / 60,
                  ).map(({ marker, start, end, atIn }) => ({
                    ...marker,
                    time: atIn ? 0 : start - e.verification!.actual.start,
                    ...(end != null ? { end: end - e.verification!.actual.start } : {}),
                  }))
                : e.input.markers
                    .filter((m) =>
                      markerIntersects(m, e.verification!.actual.start, e.verification!.actual.end),
                    )
                    .map((m) =>
                      relativeMarker(m, e.verification!.actual.start, e.verification!.actual.end),
                    ),
            available:
              !!info?.isFile() &&
              !info.isSymbolicLink() &&
              info.size === e.verification!.bytes &&
              Math.abs(info.mtimeMs - expectedDate) <= 2,
            metadataAvailable:
              !!meta?.isFile() &&
              !meta.isSymbolicLink() &&
              meta.size === Buffer.byteLength(annotation(e, e.verification!)) &&
              Math.abs(meta.mtimeMs - expectedDate) <= 2,
            ...e.filing!.media,
          };
        }),
    );
  }
  async retainedMedia(id: string, exportId: string) {
    const s = this.require(id),
      record = s
        .exports()
        .find(
          (e) => e.plan.id === exportId && e.filing?.state === 'complete' && e.state === 'verified',
        );
    if (!record) throw new Error('Choose a completed Library clip.');
    await verifyPublished(record);
    const clip = (await this.retainedClips()).find((e) => e.exportId === exportId)!;
    return { ...clip, url: await this.grant(record.output!) };
  }
  async relinkExport(id: string, exportId: string, file: string) {
    const s = this.require(id),
      record = s
        .exports()
        .find(
          (e) => e.plan.id === exportId && e.filing?.state === 'complete' && e.state === 'verified',
        );
    if (!record?.verification) throw new Error('Choose a completed Library clip.');
    if (
      s
        .sources()
        .some(
          (source) => path.resolve(source.file).toLowerCase() === path.resolve(file).toLowerCase(),
        )
    )
      throw new Error('Choose the completed output, separate from an original recording.');
    if (
      path.extname(file).toLowerCase() !== '.' + record.plan.container ||
      (await lstat(file)).isSymbolicLink() ||
      (await fileHash(file)) !== record.verification.sha256
    )
      throw new Error('This video does not match the retained clip.');
    const next = {
      ...record,
      output: await realpath(file),
      metadata: (await realpath(file)) + '.vcut.json',
    };
    await verifyPublished(next);
    this.grants.delete(record.output!);
    s.putExport(next);
    return this.snapshot();
  }
  async job(id: string, jobId: string, action: 'cancel' | 'retry') {
    const s = this.require(id),
      job = s.jobs().find((j) => j.id === jobId);
    if (!job) throw new Error('Job not found.');
    if (action === 'cancel') {
      const running = this.active[laneOf(job.kind)];
      if (running?.job.id === jobId) {
        running.controller.abort();
        await running.finished;
      } else if (job.state === 'queued') {
        s.putJob({
          ...job,
          state: 'cancelled',
          message: job.kind === 'proxy' ? 'Stopped; the partial proxy was removed' : 'Cancelled',
          updated: new Date().toISOString(),
        });
        if (job.kind === 'proxy') await this.discardProxyProgress(job.id);
      }
      if (job.kind === 'export' && job.state === 'queued') {
        const record = s.exports().find((e) => e.plan.id === jobId)!;
        s.putExport({
          ...record,
          state: 'cancelled',
          message: 'Cancelled',
          updated: new Date().toISOString(),
        });
      }
    } else if (action === 'retry' && ['failed', 'interrupted', 'cancelled'].includes(job.state)) {
      if (!s.sources().some((x) => x.id === job.sourceId))
        throw new Error('Choose the recording again using Import.');
      if (job.kind === 'export') {
        const record = s.exports().find((e) => e.plan.id === jobId);
        if (!record) throw new Error('Make a new export plan.');
        this.assertFilingCurrent(record);
        s.putExport({
          ...record,
          state: 'queued',
          message: 'Waiting to retry',
          started: undefined,
          elapsedMs: undefined,
          updated: new Date().toISOString(),
        });
      }
      s.putJob({
        ...job,
        origin: 'user',
        state: 'queued',
        progress: 0,
        message: 'Waiting to retry',
        started: undefined,
        elapsedMs: undefined,
        updated: new Date().toISOString(),
      });
      this.pump();
    } else throw new Error('That action is unavailable for this job.');
    return this.snapshot();
  }
  async relink(id: string, sourceId: string, file: string) {
    this.releaseRetained();
    this.retainedDetails.clear();
    if (this.filmstripBuild?.sourceId === sourceId) await this.stopFilmstrips();
    this.filmstripCache.forget(sourceId);
    const s = this.require(id),
      old = s.sources().find((x) => x.id === sourceId);
    if (!old) throw new Error('Recording not found.');
    if (s.jobs().some((j) => j.sourceId === sourceId && ['queued', 'running'].includes(j.state)))
      throw new Error('Cancel this recording’s jobs before relinking.');
    const next = await identify(file, sourceId);
    if (old.fingerprint !== next.fingerprint)
      throw new Error(
        'This file does not match the saved recording fingerprint. Import changed footage as a new recording to protect existing timing.',
      );
    s.transaction(() => {
      s.putSource({
        ...next,
        importedAt: old.importedAt,
        audioPreviews: old.audioPreviews,
        audioCopies: old.audioCopies,
        proxy: old.proxy,
      });
      const r = s.data.model.recordings.find((r) => r.id === sourceId)!;
      r.sourcePath = next.file;
      r.availability = r.duration ? 'ready' : 'pending';
      r.error = '';
      s.data.revision++;
    });
    this.grants.delete(old.file);
    if (!s.data.model.recordings.find((r) => r.id === sourceId)?.duration) {
      this.enqueue(sourceId, 'inspect', undefined, 'user');
      this.pump();
    }
    return this.snapshot();
  }
  private pump() {
    if (this.switching || !this.store) return;
    for (const lane of jobLanes) {
      // A picture pass gives way to anything ranked ahead of it and to its pause rules.
      const current = this.active[lane];
      if (current && isPass(current.job)) {
        const why = pictureYields(
          current.job,
          [...this.store.jobs()].reverse(),
          this.running(),
          this.pictureConditions(),
        );
        if (why) current.controller.abort(new PictureYield(why));
      }
      const job = this.nextJob(lane);
      if (!job) continue;
      // Filmstrips go before background picture passes; a pass asked for goes first.
      if (isPass(job) && rank(job) === 3 && (this.filmstripBuild || this.filmstripSource()))
        continue;
      // Filmstrips share the media lane and give way to any media job.
      if (lane === 'media') this.filmstripBuild?.controller.abort();
      const controller = new AbortController();
      const work =
        job.kind === 'visual'
          ? this.runPicture(job, controller.signal)
          : job.kind === 'proxy'
            ? this.runProxy(job, controller.signal)
            : job.kind === 'text'
              ? this.runScreenText(job, controller.signal)
              : this.run(job, controller.signal);
      const finished = work.finally(() => {
        this.active[lane] = null;
        this.pump();
      });
      this.active[lane] = { job, controller, finished };
    }
    this.makeFilmstrips();
    this.notePictureWaits();
  }
  private running() {
    return jobLanes.flatMap((l) => this.active[l]?.job ?? []);
  }
  private nextJob(lane: JobLane) {
    return nextJob(
      lane,
      [...this.store!.jobs()].reverse(),
      this.running(),
      this.pictureConditions(),
    );
  }
  // ---- Picture pass (VC-180) ----
  /** Seconds since the last keyboard or mouse input; main reads Electron's system idle time. */
  idleSeconds: () => number = () => 0;
  private previewIsPlaying = false;
  // Whether NVDEC reads a recording, by source id and fingerprint; tried once per session.
  private pictureGpu = new Map<string, boolean>();
  // Chunks read so far by pass, kept while it waits.
  private pictureProgress = new Map<string, PassProgress>();
  private pictureTimer?: NodeJS.Timeout;
  previewPlaying(playing: boolean) {
    if (typeof playing !== 'boolean') throw new Error('Invalid playback state.');
    if (this.previewIsPlaying === playing) return;
    this.previewIsPlaying = playing;
    this.pump();
  }
  private pictureKey(sourceId: string) {
    const source = this.store?.sources().find((s) => s.id === sourceId);
    return source ? `${source.id}:${source.fingerprint}` : sourceId;
  }
  private pictureConditions(): PictureConditions {
    const idle = !this.previewIsPlaying && this.idleSeconds() >= 300;
    return {
      previewPlaying: this.previewIsPlaying,
      idle,
      gpu: (job) => {
        if (process.env.VIRTUAL_CUT_PICTURE_GPU === '0') return false;
        const codec = this.store?.data.model.recordings.find((r) => r.id === job.sourceId)?.codec;
        if (!gpuDecoder(codec)) return false;
        return this.pictureGpu.get(this.pictureKey(job.sourceId));
      },
    };
  }
  /** Keeps the Jobs line of each waiting pass current, and watches idle time while any wait. */
  private notePictureWaits() {
    const s = this.store;
    if (!s) return;
    const jobs = [...s.jobs()].reverse();
    const passes = jobs.filter((j) => isPass(j) && ['queued', 'running'].includes(j.state));
    const conditions = this.pictureConditions();
    for (const job of passes) {
      if (job.state !== 'queued') continue;
      const message = pictureHold(job, jobs, this.running(), conditions) || 'Waiting';
      if (job.message !== message)
        s.putJob({ ...job, message, use: undefined, updated: new Date().toISOString() });
    }
    if (passes.length && !this.pictureTimer) {
      this.pictureTimer = setInterval(() => this.pump(), 2000);
      this.pictureTimer.unref?.();
    } else if (!passes.length && this.pictureTimer) {
      clearInterval(this.pictureTimer);
      this.pictureTimer = undefined;
    }
  }
  private enqueuePicture(sourceId: string, origin: 'user' | 'background') {
    const s = this.require();
    const r = s.data.model.recordings.find((r) => r.id === sourceId);
    if (!r || r.availability !== 'ready' || r.retained) return false;
    const queued = s
      .jobs()
      .find(
        (j) =>
          j.sourceId === sourceId && j.kind === 'visual' && ['queued', 'running'].includes(j.state),
      );
    if (queued) {
      if (origin === 'user' && queued.origin === 'background')
        s.putJob({ ...queued, origin, updated: new Date().toISOString() });
      return true;
    }
    if (s.pictureEvents(sourceId, false)) return false;
    s.putJob({
      id: randomUUID(),
      sourceId,
      kind: 'visual',
      origin,
      state: 'queued',
      progress: 0,
      message: 'Waiting',
      updated: new Date().toISOString(),
    });
    return true;
  }
  /** Analyse picture now: on one recording, or on a batch's recordings from Jobs. */
  async analysePicture(id: string, sourceIds: string[]) {
    const s = this.require(id);
    if (
      !Array.isArray(sourceIds) ||
      !sourceIds.length ||
      sourceIds.length > 500 ||
      sourceIds.some((x) => typeof x !== 'string')
    )
      throw new Error('Choose recordings to analyse.');
    for (const sourceId of new Set(sourceIds))
      if (!s.data.model.recordings.some((r) => r.id === sourceId))
        throw new Error('Recording not found.');
    for (const sourceId of new Set(sourceIds)) {
      this.enqueuePicture(sourceId, 'user');
      this.enqueueScreenText(sourceId, 'user');
    }
    this.pump();
    return this.snapshot();
  }
  // ---- Playback proxies (VC-237) ----
  // Segments made so far by proxy job, kept while it waits so it carries on with the next one.
  private proxyProgress = new Map<string, { done: Map<number, string>; elapsedMs: number }>();
  private nvenc?: Promise<boolean>;
  /** The H.264 encoder proxies use: NVENC when it works on this PC, otherwise x264. */
  private proxyEncoder(): Promise<ProxyEncode> {
    const forced = process.env.VIRTUAL_CUT_PROXY_ENCODER;
    if (forced === 'x264' || forced === 'nvenc') return Promise.resolve(forced);
    this.nvenc ??= nvencWorks(this.tool('ffmpeg'), new AbortController().signal);
    return this.nvenc.then((works) => (works ? 'nvenc' : 'x264'));
  }
  private proxyFile(store: ProjectStore, source: NativeSource) {
    return isNativeProxy(source.proxy)
      ? path.join(store.data.project.cache, source.proxy.file)
      : undefined;
  }
  private enqueueProxy(sourceId: string, origin: 'user' | 'background', height: ProxyHeight) {
    const s = this.require();
    const r = s.data.model.recordings.find((r) => r.id === sourceId);
    if (!r || r.availability !== 'ready' || r.retained || r.sample) return false;
    const queued = s
      .jobs()
      .find(
        (j) =>
          j.sourceId === sourceId && j.kind === 'proxy' && ['queued', 'running'].includes(j.state),
      );
    if (queued) {
      if (origin === 'user' && queued.origin === 'background')
        s.putJob({ ...queued, origin, updated: new Date().toISOString() });
      return true;
    }
    s.putJob({
      id: randomUUID(),
      sourceId,
      kind: 'proxy',
      origin,
      proxyHeight: height,
      state: 'queued',
      progress: 0,
      message: 'Waiting',
      updated: new Date().toISOString(),
    });
    return true;
  }
  /** Whether a recording already has a usable proxy at this size. */
  private async hasProxy(store: ProjectStore, source: NativeSource, height: ProxyHeight) {
    const file = this.proxyFile(store, source);
    const info = file ? await stat(file).catch(() => null) : null;
    return (
      proxyState(source.proxy, source.fingerprint, info).state === 'ready' &&
      source.proxy?.height === height
    );
  }
  /** Removes a recording's proxy file from the cache and its record from the project. */
  private async dropProxy(store: ProjectStore, sourceId: string) {
    const source = store.sources().find((x) => x.id === sourceId);
    if (!source?.proxy) return;
    const file = this.proxyFile(store, source);
    if (file) {
      this.grants.delete(file);
      try {
        await unlink(file);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new Error('The proxy file is in use. Close what is playing it, then try again.', {
            cause: e,
          });
      }
    }
    store.transaction(() => {
      const native = store.sources().find((x) => x.id === sourceId)!;
      const { proxy: _removed, ...rest } = native;
      store.putSource(rest);
      store.data.revision++;
    });
  }
  private proxyJob(store: ProjectStore, sourceId: string) {
    return store
      .jobs()
      .find(
        (j) =>
          j.sourceId === sourceId && j.kind === 'proxy' && ['queued', 'running'].includes(j.state),
      );
  }
  /** Make proxy (a card's chip) or Make proxies for this batch (the Proxies window). */
  async makeProxies(id: string, sourceIds: string[], again = false) {
    const s = this.require(id);
    if (
      !Array.isArray(sourceIds) ||
      !sourceIds.length ||
      sourceIds.length > 500 ||
      sourceIds.some((x) => typeof x !== 'string')
    )
      throw new Error('Choose recordings to make proxies for.');
    for (const sourceId of new Set(sourceIds))
      if (!s.data.model.recordings.some((r) => r.id === sourceId))
        throw new Error('Recording not found.');
    const settings = proxySettings(s.data.proxies);
    if (settings.onImport === 'never')
      throw new Error('Proxies are off for this project. Turn them on in the Proxies window.');
    for (const sourceId of new Set(sourceIds)) {
      const source = s.sources().find((x) => x.id === sourceId);
      if (!source) continue;
      if (!this.proxyJob(s, sourceId)) {
        if (again) await this.dropProxy(s, sourceId);
        else if (await this.hasProxy(s, source, settings.height)) continue;
      }
      this.enqueueProxy(sourceId, 'user', settings.height);
    }
    this.pump();
    return this.snapshot();
  }
  /** Remove proxy (a ready one) or Forget the missing proxy, from a card's chip. */
  async removeProxy(id: string, sourceId: string) {
    const s = this.require(id);
    if (!s.data.model.recordings.some((r) => r.id === sourceId))
      throw new Error('Recording not found.');
    if (this.proxyJob(s, sourceId)) throw new Error('Stop making this proxy first.');
    await this.dropProxy(s, sourceId);
    return this.snapshot();
  }
  async proxyLocation(id: string, sourceId: string) {
    const s = this.require(id);
    const source = s.sources().find((x) => x.id === sourceId);
    const file = source && this.proxyFile(s, source);
    if (!file || !(await stat(file).catch(() => null))?.isFile())
      throw new Error('The proxy file is missing. Make it again from the proxy chip.');
    return file;
  }
  async setProxySettings(id: string, settings: ProxySettings) {
    const s = this.require(id);
    if (!isProxySettings(settings)) throw new Error('Choose proxy settings from the list.');
    s.data.proxies = { onImport: settings.onImport, height: settings.height };
    s.write();
    return this.snapshot();
  }
  /** Removes the segments a waiting proxy job has made, when it is stopped or the project closes. */
  private async discardProxyProgress(jobId: string) {
    const progress = this.proxyProgress.get(jobId);
    this.proxyProgress.delete(jobId);
    if (progress) await removeFiles(progress.done.values());
  }
  private async runProxy(job: MediaJob, signal: AbortSignal) {
    const s = this.require(),
      source = s.sources().find((x) => x.id === job.sourceId),
      record = s.data.model.recordings.find((r) => r.id === job.sourceId);
    const key = this.pictureKey(job.sourceId);
    const progress = this.proxyProgress.get(job.id) ?? { done: new Map(), elapsedMs: 0 };
    this.proxyProgress.set(job.id, progress);
    const began = performance.now();
    this.diagnostics?.record('job-start', {
      jobId: job.id,
      sourceId: job.sourceId,
      projectId: s.data.project.id,
      kind: job.kind,
    });
    const height = isProxyHeight(job.proxyHeight)
      ? job.proxyHeight
      : proxySettings(s.data.proxies).height;
    const cache = s.data.project.cache;
    const final = source
      ? path.join(cache, proxyFileName(source.id, source.fingerprint, height))
      : '';
    const partial = final.replace(/\.mp4$/i, '.partial.mp4');
    let use: VisualUse | undefined, encode: ProxyEncode | undefined;
    let fraction = job.progress || 0,
      last = 0,
      checking = false;
    const elapsed = () => progress.elapsedMs + Math.round(performance.now() - began);
    const put = (force = false) => {
      if (!force && Date.now() - last < 500) return;
      last = Date.now();
      s.putJob({
        ...job,
        state: 'running',
        progress: fraction,
        use,
        message: checking
          ? 'Checking the proxy against the recording'
          : `Making ${height}p proxy · ${proxyUseText(use, encode)}`,
        started: job.started,
        elapsedMs: elapsed(),
        updated: new Date().toISOString(),
      });
    };
    job = { ...job, started: new Date().toISOString() };
    put(true);
    let failureCode: string | undefined;
    try {
      if (!source || !record || record.availability !== 'ready')
        throw new Error('Source file is not registered. Import it again.');
      const actual = await identify(source.file, source.id).catch(() => {
        throw new Error('The recording could not be read. Relink it, then retry.');
      });
      if (actual.fingerprint !== source.fingerprint || actual.modified !== source.modified)
        throw new Error(
          'Source changed since import. Relink an unchanged copy or import it as new.',
        );
      const index = s.frameIndex(source.id);
      if (!index?.frameTimes.length)
        throw new Error('The keyframe index is unavailable. Inspect the recording again.');
      // Checks use short segments so a few seconds of footage still has several.
      const plan = proxyPlan(
        index.frameTimes,
        index.keys,
        proxyFormat.keyframeStep,
        Number(process.env.VIRTUAL_CUT_PROXY_SEGMENT) || undefined,
      );
      // Segments of earlier runs that were not kept (a crash, a closed project) are removed.
      const own = new Set([...progress.done.values()].map((f) => path.basename(f).toLowerCase()));
      const stale = new RegExp(
        `^${source.id}-${source.fingerprint}-[a-f\\d]{8}-s\\d{4}-proxy-(?:1080|720)p\\.partial\\.mp4$`,
        'i',
      );
      await removeFiles(
        (await readdir(cache))
          .filter((name) => stale.test(name) && !own.has(name.toLowerCase()))
          .map((name) => path.join(cache, name)),
      );
      const remaining = plan
        .filter((x) => !progress.done.has(x.index))
        .reduce((n, x) => n + x.frames, 0);
      const free = await import('node:fs/promises').then((fs) => fs.statfs(cache));
      const needed =
        256 * 1024 * 1024 +
        2 * proxyBytesEstimate((record.duration * remaining) / index.frameTimes.length, height);
      if (free.bavail * free.bsize < needed)
        throw new Error(
          `Free about ${Math.ceil(needed / 1e9)} GB in the project cache before making this proxy.`,
        );
      const decoder =
        process.env.VIRTUAL_CUT_PICTURE_GPU === '0' ? undefined : gpuDecoder(record.codec);
      if (decoder && !this.pictureGpu.has(key))
        this.pictureGpu.set(
          key,
          await gpuReads(
            this.tool('ffmpeg'),
            source.file,
            decoder,
            record.sourceStart || 0,
            signal,
          ),
        );
      use = decoder && this.pictureGpu.get(key) ? 'gpu' : 'cpu';
      encode = await this.proxyEncoder();
      put(true);
      const total = index.frameTimes.length;
      let made = plan.filter((x) => progress.done.has(x.index)).reduce((n, x) => n + x.frames, 0);
      for (const segment of plan) {
        if (progress.done.has(segment.index)) continue;
        signal.throwIfAborted();
        const out = path.join(
          cache,
          `${source.id}-${source.fingerprint}-${job.id.slice(0, 8)}-s${String(segment.index).padStart(4, '0')}-proxy-${height}p.partial.mp4`,
        );
        try {
          await makeSegment(
            this.tool('ffmpeg'),
            {
              file: source.file,
              offset: record.sourceStart || 0,
              segment,
              frameTimes: index.frameTimes,
              height,
              decode: use === 'gpu' ? 'gpu' : 'cpu',
              gpuDecoder: decoder,
              encode,
              out,
            },
            signal,
            (frames) => {
              fraction = Math.max(fraction, 0.97 * Math.min(1, (made + frames) / total));
              put();
            },
          );
        } catch (e) {
          if (signal.aborted || use !== 'gpu') throw e;
          // The NVIDIA decoder could not read this recording: it is decoded on the CPU from now
          // on, which waits for the PC to be idle like the picture pass.
          this.pictureGpu.set(key, false);
          this.diagnostics?.record('operation-failed', {
            kind: 'proxy-gpu',
            errorCode: errorCode(e),
          });
          throw new PictureYield('Waiting for the PC to be idle (no NVIDIA decoder)');
        }
        progress.done.set(segment.index, out);
        made += segment.frames;
      }
      checking = true;
      fraction = Math.max(fraction, 0.97);
      put(true);
      const parts = plan.map((x) => progress.done.get(x.index)!);
      await joinSegments(this.tool('ffmpeg'), parts, partial, signal);
      progress.done.clear();
      await removeFiles(parts);
      const read = await readProxy(this.tool('ffprobe'), partial, signal);
      const problem = proxyProblem(read, index.frameTimes, plan, index.keys, height);
      if (problem) throw new Error(`The proxy did not match the recording. ${problem}`);
      const now = await stat(source.file);
      if (
        this.store !== s ||
        now.size !== source.bytes ||
        now.mtimeMs !== source.modified ||
        !s.sources().some((x) => x.id === source.id && x.fingerprint === source.fingerprint)
      )
        throw new Error('Recording changed while its proxy was made.');
      signal.throwIfAborted();
      // A remade proxy, or one at the other size, replaces the recording's earlier file.
      const before = s.sources().find((x) => x.id === source.id)!;
      for (const file of new Set([this.proxyFile(s, before), final])) {
        if (!file) continue;
        this.grants.delete(file);
        await unlink(file).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== 'ENOENT') throw e;
        });
      }
      await rename(partial, final);
      const facts = await stat(final);
      const proxy: NativeProxy = {
        file: path.basename(final),
        height,
        width: read.width,
        codec: proxyFormat.codec,
        keyframeStep: proxyFormat.keyframeStep,
        fingerprint: source.fingerprint,
        bytes: facts.size,
        modified: facts.mtimeMs,
        made: new Date().toISOString(),
      };
      s.transaction(() => {
        const native = s.sources().find((x) => x.id === source.id)!;
        s.putSource({ ...native, proxy });
      });
      this.proxyProgress.delete(job.id);
      s.putJob({
        ...job,
        state: 'succeeded',
        progress: 1,
        use,
        message: `Proxy ready · ${height}p · ${(facts.size / 1e9).toFixed(2)} GB · ${proxyUseText(use, encode)}`,
        elapsedMs: elapsed(),
        updated: new Date().toISOString(),
      });
    } catch (e) {
      failureCode = errorCode(e);
      const reason: unknown = signal.reason;
      const yielded =
        e instanceof PictureYield
          ? e
          : signal.aborted && reason instanceof PictureYield
            ? reason
            : undefined;
      if (yielded || (signal.aborted && this.switching)) {
        // Waits with the segments it has made and carries on with the next one later.
        progress.elapsedMs = elapsed();
        s.putJob({
          ...job,
          state: 'queued',
          progress: fraction,
          use: undefined,
          message: yielded ? yielded.message : 'Waiting',
          elapsedMs: elapsed(),
          updated: new Date().toISOString(),
        });
        if (this.switching) await this.discardProxyProgress(job.id);
        if (final) await removeFiles([partial]);
        return;
      }
      await this.discardProxyProgress(job.id);
      if (final) await removeFiles([partial]);
      s.putJob({
        ...job,
        state: signal.aborted ? 'cancelled' : 'failed',
        progress: 0,
        use: undefined,
        message: signal.aborted
          ? 'Stopped; the partial proxy was removed'
          : e instanceof Error
            ? e.message
            : String(e),
        elapsedMs: elapsed(),
        updated: new Date().toISOString(),
      });
    } finally {
      const finalJob = s.jobs().find((j) => j.id === job.id);
      this.diagnostics?.record(
        finalJob?.state === 'succeeded'
          ? 'job-end'
          : finalJob?.state === 'queued'
            ? 'job-paused'
            : signal.aborted
              ? 'job-cancelled'
              : 'job-failed',
        {
          jobId: job.id,
          sourceId: job.sourceId,
          kind: job.kind,
          elapsedMs: elapsed(),
          errorCode: finalJob?.state === 'queued' ? undefined : failureCode,
        },
      );
    }
  }
  // ---- Screen text pass (VC-141) ----
  // Lines read so far by pass, kept while it waits so it carries on after the last keyframe.
  private textProgress = new Map<string, { joiner: LineJoiner; elapsedMs: number }>();
  private enqueueScreenText(sourceId: string, origin: 'user' | 'background') {
    const s = this.require();
    const r = s.data.model.recordings.find((r) => r.id === sourceId);
    if (!r || r.availability !== 'ready' || r.retained) return false;
    // Without the engine there is nothing to queue; cards and Jobs link to its setup.
    if (this.screenText.problem) return false;
    const queued = s
      .jobs()
      .find(
        (j) =>
          j.sourceId === sourceId && j.kind === 'text' && ['queued', 'running'].includes(j.state),
      );
    if (queued) {
      if (origin === 'user' && queued.origin === 'background')
        s.putJob({ ...queued, origin, updated: new Date().toISOString() });
      return true;
    }
    if (s.screenText(sourceId)) return false;
    s.putJob({
      id: randomUUID(),
      sourceId,
      kind: 'text',
      origin,
      state: 'queued',
      progress: 0,
      message: 'Waiting',
      updated: new Date().toISOString(),
    });
    return true;
  }
  private async runScreenText(job: MediaJob, signal: AbortSignal) {
    const s = this.require(),
      source = s.sources().find((x) => x.id === job.sourceId),
      record = s.data.model.recordings.find((r) => r.id === job.sourceId);
    const progress = this.textProgress.get(job.id) ?? { joiner: new LineJoiner(), elapsedMs: 0 };
    this.textProgress.set(job.id, progress);
    const began = performance.now();
    this.diagnostics?.record('job-start', {
      jobId: job.id,
      sourceId: job.sourceId,
      projectId: s.data.project.id,
      kind: job.kind,
    });
    let fraction = job.progress || 0,
      last = 0,
      use: 'gpu' | 'cpu' | undefined;
    const elapsed = () => progress.elapsedMs + Math.round(performance.now() - began);
    const put = (force = false) => {
      if (!force && Date.now() - last < 500) return;
      last = Date.now();
      s.putJob({
        ...job,
        state: 'running',
        progress: fraction,
        use,
        message: 'Reading screen text',
        elapsedMs: elapsed(),
        updated: new Date().toISOString(),
      });
    };
    job = { ...job, started: job.started || new Date().toISOString() };
    put(true);
    let failureCode: string | undefined;
    try {
      if (!source || !record || record.availability !== 'ready')
        throw new Error('Source file is not registered. Import it again.');
      const problem = this.screenText.problem;
      if (problem) throw new Error(problem);
      const actual = await identify(source.file, source.id).catch(() => {
        throw new Error('The recording could not be read. Relink it, then retry.');
      });
      if (actual.fingerprint !== source.fingerprint || actual.modified !== source.modified)
        throw new Error(
          'Source changed since import. Relink an unchanged copy or import it as new.',
        );
      const offset = record.sourceStart || 0;
      const size = readSize(record.width, record.height);
      const joiner = progress.joiner;
      const resumed = Number.isFinite(joiner.last);
      // The pass gives way like the picture pass: to work ranked ahead of it and its pause rules.
      const watch = setInterval(() => {
        const why = pictureYields(
          job,
          [...s.jobs()].reverse(),
          this.running(),
          this.pictureConditions(),
        );
        if (why) this.active.media?.controller.abort(new PictureYield(why));
      }, 1000);
      let result;
      try {
        result = await readKeyframes(
          this.screenText.settings,
          {
            ffmpeg: this.tool('ffmpeg'),
            args: keyframeArgs({
              file: source.file,
              offset,
              from: resumed ? joiner.last : 0,
              size,
              sourceHeight: record.height,
            }),
            width: size.width,
            height: size.height,
            same: unchangedSpans(s.pictureEvents(source.id, false)?.events, offset),
            after: resumed ? offset + joiner.last : undefined,
          },
          (frame) => {
            const time = Math.max(0, frame.time - offset);
            if (!(time > joiner.last)) return;
            if ('same' in frame) joiner.same(time);
            else joiner.frame(time, frame.lines);
            fraction = Math.max(fraction, Math.min(0.99, time / Math.max(record.duration, 0.001)));
            put();
          },
          signal,
          undefined,
          (gpu) => {
            use = gpu ? 'gpu' : 'cpu';
            put(true);
          },
        );
      } finally {
        clearInterval(watch);
      }
      const final = await stat(source.file);
      if (
        this.store !== s ||
        final.size !== source.bytes ||
        final.mtimeMs !== source.modified ||
        !s.sources().some((x) => x.id === source.id && x.fingerprint === source.fingerprint)
      )
        throw new Error('Recording changed while its screen text was read.');
      if (!joiner.keyframes) throw new Error('The screen text pass found no keyframes.');
      const stored = {
        version: SCREEN_TEXT_VERSION,
        width: size.width,
        height: size.height,
        lines: joiner.lines(),
        keyframes: joiner.keyframes,
        read: joiner.read,
        gpu: result.gpu,
        elapsedMs: elapsed(),
        peakMemoryBytes: result.peakMemoryBytes,
        created: new Date().toISOString(),
      };
      s.putScreenText(source.id, source.fingerprint, stored);
      this.textProgress.delete(job.id);
      const count = `${stored.lines.length} line${stored.lines.length === 1 ? '' : 's'}`;
      s.putJob({
        ...job,
        state: 'succeeded',
        progress: 1,
        use: stored.gpu ? 'gpu' : 'cpu',
        message: `Screen text ready · ${count} from ${stored.keyframes} keyframes (${stored.keyframes - stored.read} unchanged)${stored.gpu ? '' : ' · read on the CPU'}`,
        elapsedMs: stored.elapsedMs,
        updated: new Date().toISOString(),
      });
    } catch (e) {
      failureCode = errorCode(e);
      const reason: unknown = signal.reason;
      if (signal.aborted && (reason instanceof PictureYield || this.switching)) {
        // Waits with the lines it has read and carries on after the last keyframe.
        progress.elapsedMs = elapsed();
        s.putJob({
          ...job,
          state: 'queued',
          progress: fraction,
          message: reason instanceof PictureYield ? reason.message : 'Waiting',
          elapsedMs: elapsed(),
          updated: new Date().toISOString(),
        });
        if (this.switching) this.textProgress.delete(job.id);
        return;
      }
      this.textProgress.delete(job.id);
      s.putJob({
        ...job,
        state: signal.aborted ? 'cancelled' : 'failed',
        progress: 0,
        message: signal.aborted ? 'Cancelled' : e instanceof Error ? e.message : String(e),
        elapsedMs: elapsed(),
        updated: new Date().toISOString(),
      });
    } finally {
      const finalJob = s.jobs().find((j) => j.id === job.id);
      this.diagnostics?.record(
        finalJob?.state === 'succeeded'
          ? 'job-end'
          : finalJob?.state === 'queued'
            ? 'job-paused'
            : signal.aborted
              ? 'job-cancelled'
              : 'job-failed',
        {
          jobId: job.id,
          sourceId: job.sourceId,
          kind: job.kind,
          elapsedMs: elapsed(),
          errorCode: finalJob?.state === 'queued' ? undefined : failureCode,
        },
      );
    }
  }
  private async runPicture(job: MediaJob, signal: AbortSignal) {
    const s = this.require(),
      source = s.sources().find((x) => x.id === job.sourceId),
      record = s.data.model.recordings.find((r) => r.id === job.sourceId);
    const key = this.pictureKey(job.sourceId);
    const progress = this.pictureProgress.get(job.id) ?? {
      chunks: new Map(),
      elapsedMs: 0,
      used: new Set(),
    };
    this.pictureProgress.set(job.id, progress);
    const began = performance.now();
    this.diagnostics?.record('job-start', {
      jobId: job.id,
      sourceId: job.sourceId,
      projectId: s.data.project.id,
      kind: job.kind,
    });
    let use: VisualUse | undefined;
    let fraction = job.progress || 0,
      last = 0;
    const elapsed = () => progress.elapsedMs + Math.round(performance.now() - began);
    const put = (force = false) => {
      if (!force && Date.now() - last < 500) return;
      last = Date.now();
      s.putJob({
        ...job,
        state: 'running',
        progress: fraction,
        use,
        message: `Reading picture · ${useText(use)}`,
        started: job.started,
        elapsedMs: elapsed(),
        updated: new Date().toISOString(),
      });
    };
    job = { ...job, started: new Date().toISOString() };
    put(true);
    let failureCode: string | undefined;
    try {
      if (!source || !record || record.availability !== 'ready')
        throw new Error('Source file is not registered. Import it again.');
      const actual = await identify(source.file, source.id).catch(() => {
        throw new Error('The recording could not be read. Relink it, then retry.');
      });
      if (actual.fingerprint !== source.fingerprint || actual.modified !== source.modified)
        throw new Error(
          'Source changed since import. Relink an unchanged copy or import it as new.',
        );
      const decoder =
        process.env.VIRTUAL_CUT_PICTURE_GPU === '0' ? undefined : gpuDecoder(record.codec);
      if (decoder && !this.pictureGpu.has(key))
        this.pictureGpu.set(
          key,
          await gpuReads(
            this.tool('ffmpeg'),
            source.file,
            decoder,
            record.sourceStart || 0,
            signal,
          ),
        );
      const allowed = () => {
        const why = pictureYields(
          job,
          [...s.jobs()].reverse(),
          this.running(),
          this.pictureConditions(),
        );
        if (why) {
          this.active.media?.controller.abort(new PictureYield(why));
          return { gpu: false, cpu: 0 };
        }
        const now = pictureUse(job, this.pictureConditions());
        if (now !== use) {
          use = now;
          put(true);
        }
        return {
          gpu: now === 'gpu' || now === 'gpu+cpu',
          cpu: now === 'gpu+cpu' || now === 'cpu' ? cpuWorkers() : 0,
        };
      };
      const chunks = await runPass(
        {
          ffmpeg: this.tool('ffmpeg'),
          file: source.file,
          offset: record.sourceStart || 0,
          duration: record.duration,
          height: visualHeight(record.width, record.height),
          gpu: this.pictureGpu.get(key) ? decoder : undefined,
          chunkSeconds: Number(process.env.VIRTUAL_CUT_PICTURE_CHUNK) || undefined,
          allowance: allowed,
          progress: (n) => {
            fraction = Math.max(fraction, n);
            put();
          },
          gpuFailed: (e) => {
            this.pictureGpu.set(key, false);
            this.diagnostics?.record('operation-failed', {
              kind: 'picture-gpu',
              errorCode: errorCode(e),
            });
          },
          signal,
        },
        progress,
      );
      const frames = joinFrames(chunks);
      const events = buildEvents(frames, joinStills(chunks, record.duration), record.duration);
      const final = await stat(source.file);
      if (
        this.store !== s ||
        final.size !== source.bytes ||
        final.mtimeMs !== source.modified ||
        !s.sources().some((x) => x.id === source.id && x.fingerprint === source.fingerprint)
      )
        throw new Error('Recording changed while its picture was read.');
      const stored = {
        version: VISUAL_VERSION,
        events,
        frames: {
          times: Float32Array.from(frames.times),
          brightness: Uint8Array.from(frames.brightness, (y) => Math.round(y)),
          cut: Uint8Array.from(frames.cut, (c) => Math.min(255, Math.round(c))),
        },
        use: (progress.used.has('gpu')
          ? progress.used.has('cpu')
            ? 'gpu+cpu'
            : 'gpu'
          : 'cpu') as VisualUse,
        elapsedMs: elapsed(),
        created: new Date().toISOString(),
      };
      s.putPictureEvents(source.id, source.fingerprint, stored);
      const counts = summarize(stored).counts;
      this.pictureProgress.delete(job.id);
      s.putJob({
        ...job,
        state: 'succeeded',
        progress: 1,
        use: stored.use,
        message: `Picture events ready · ${useLabel(stored.use)} · ${counts.black} black, ${counts.still} still, ${counts.cut} cuts, ${counts.fade} fades`,
        elapsedMs: stored.elapsedMs,
        updated: new Date().toISOString(),
      });
    } catch (e) {
      failureCode = errorCode(e);
      const reason: unknown = signal.reason;
      if (signal.aborted && (reason instanceof PictureYield || this.switching)) {
        // Waits with the chunks it has read and carries on later.
        progress.elapsedMs = elapsed();
        s.putJob({
          ...job,
          state: 'queued',
          progress: fraction,
          use: undefined,
          message: reason instanceof PictureYield ? reason.message : 'Waiting',
          elapsedMs: elapsed(),
          updated: new Date().toISOString(),
        });
        if (this.switching) this.pictureProgress.delete(job.id);
        return;
      }
      this.pictureProgress.delete(job.id);
      s.putJob({
        ...job,
        state: signal.aborted ? 'cancelled' : 'failed',
        progress: 0,
        use: undefined,
        message: signal.aborted ? 'Cancelled' : e instanceof Error ? e.message : String(e),
        elapsedMs: elapsed(),
        updated: new Date().toISOString(),
      });
    } finally {
      const finalJob = s.jobs().find((j) => j.id === job.id);
      this.diagnostics?.record(
        finalJob?.state === 'succeeded'
          ? 'job-end'
          : finalJob?.state === 'queued'
            ? 'job-paused'
            : signal.aborted
              ? 'job-cancelled'
              : 'job-failed',
        {
          jobId: job.id,
          sourceId: job.sourceId,
          kind: job.kind,
          elapsedMs: elapsed(),
          errorCode: finalJob?.state === 'queued' ? undefined : failureCode,
        },
      );
    }
  }
  private wantFilmstrip(sourceId: string) {
    const source = this.store?.sources().find((x) => x.id === sourceId);
    if (!source) return;
    this.filmstripSettled.delete(filmstripFile(this.store!.data.project.cache, source));
    this.filmstripNext.add(sourceId);
    this.makeFilmstrips();
  }
  private async stopFilmstrips() {
    const build = this.filmstripBuild;
    build?.controller.abort();
    await build?.finished;
  }
  private makeFilmstrips() {
    const s = this.store;
    const next = s && this.nextJob('media');
    // Only a background picture pass waits for filmstrips.
    if (
      !s ||
      this.active.media ||
      this.switching ||
      this.filmstripBuild ||
      (next && !(isPass(next) && rank(next) === 3))
    )
      return;
    const source = this.filmstripSource();
    if (!source) return;
    this.filmstripNext.delete(source.id);
    const file = filmstripFile(s.data.project.cache, source),
      controller = new AbortController();
    const finished = this.makeFilmstrip(s, source, file, controller.signal)
      .catch((e) => {
        if (controller.signal.aborted) return;
        this.filmstripFailed.add(file);
        this.diagnostics?.record('operation-failed', {
          kind: 'filmstrip',
          errorCode: errorCode(e),
        });
      })
      .finally(() => {
        this.filmstripBuild = null;
        this.onChange?.();
        setImmediate(() => this.pump());
      });
    this.filmstripBuild = { sourceId: source.id, controller, finished };
    this.onChange?.();
  }
  /** The next recording that needs a filmstrip, if any. */
  private filmstripSource() {
    const s = this.store;
    if (!s) return undefined;
    const sources = s.sources();
    const ready = new Set(
      s.data.model.recordings
        .filter((r) => r.availability === 'ready' && !r.retained)
        .map((r) => r.id),
    );
    let source: NativeSource | undefined;
    for (const id of [...this.filmstripNext, ...sources.map((x) => x.id)]) {
      const candidate = sources.find((x) => x.id === id);
      if (!candidate || !ready.has(id)) continue;
      const file = filmstripFile(s.data.project.cache, candidate);
      if (this.filmstripSettled.has(file) || this.filmstripFailed.has(file)) continue;
      if (existsSync(file)) {
        this.filmstripSettled.add(file);
        continue;
      }
      source = candidate;
      break;
    }
    return source;
  }
  private filmstripStates(store: ProjectStore) {
    const states: Record<string, 'ready' | 'making' | 'waiting'> = {};
    const sources = new Map(store.sources().map((x) => [x.id, x]));
    for (const r of store.data.model.recordings) {
      const source = sources.get(r.id);
      if (!source || r.availability !== 'ready' || r.retained) continue;
      const file = filmstripFile(store.data.project.cache, source);
      if (this.filmstripSettled.has(file) || existsSync(file)) {
        this.filmstripSettled.add(file);
        states[r.id] = 'ready';
      } else if (this.filmstripBuild?.sourceId === r.id) states[r.id] = 'making';
      else if (!this.filmstripFailed.has(file)) states[r.id] = 'waiting';
    }
    return states;
  }
  private async makeFilmstrip(
    s: ProjectStore,
    source: NativeSource,
    file: string,
    signal: AbortSignal,
  ) {
    const keys = s.frameIndex(source.id)?.keys;
    if (!keys?.length) throw new Error('Keyframe index is unavailable.');
    const free = await import('node:fs/promises').then((fs) => fs.statfs(s.data.project.cache));
    if (free.bavail * free.bsize < 256 * 1024 * 1024)
      throw new Error('Not enough free space in the preview cache.');
    const offset = s.data.model.recordings.find((r) => r.id === source.id)?.sourceStart || 0;
    const set = await sweepKeyframes(this.tool('ffmpeg'), source, offset, keys, signal);
    const info = await stat(source.file);
    signal.throwIfAborted();
    if (
      this.store !== s ||
      !s.sources().some((x) => x.id === source.id && x.fingerprint === source.fingerprint) ||
      info.size !== source.bytes ||
      info.mtimeMs !== source.modified
    )
      throw new Error('The recording changed while its filmstrip was made.');
    await writeTileFile(file, source, offset, set);
    this.filmstripSettled.add(file);
  }
  private async run(job: MediaJob, signal: AbortSignal) {
    const began = performance.now();
    this.diagnostics?.record('job-start', {
      jobId: job.id,
      sourceId: job.sourceId,
      projectId: this.store?.data.project.id,
      kind: job.kind,
    });
    job = { ...job, started: new Date().toISOString(), elapsedMs: 0 };
    if (job.kind === 'transcribe') job = { ...job, device: undefined, deviceMessage: undefined };
    const elapsedMs = () => Math.round(performance.now() - began);
    const s = this.require(),
      source = s.sources().find((x) => x.id === job.sourceId);
    let last = 0;
    const progress = (
      n: number,
      message = job.kind === 'inspect' ? 'Inspecting recording' : 'Preparing audio',
    ) => {
      if (Date.now() - last < 500 && n < 1) return;
      last = Date.now();
      s.putJob({
        ...job,
        state: 'running',
        progress: n,
        message,
        elapsedMs: elapsedMs(),
        updated: new Date().toISOString(),
      });
    };
    progress(0);
    let temp = '',
      pcm = '';
    let failureCode: string | undefined;
    try {
      if (job.kind === 'export') {
        const record = s.exports().find((e) => e.plan.id === job.id);
        if (!record) throw new Error('Export plan is unavailable.');
        const guard = async () => {
          signal.throwIfAborted();
          this.assertFilingCurrent(record);
          if (record.filing) {
            const target = await prepareDestination(
              s.data.project.destination,
              record.filing.folder,
              record.filing.root,
            );
            if (path.dirname(record.output!).toLowerCase() !== target.directory.toLowerCase())
              throw new Error('The filing destination changed. Review a new plan.');
          }
        };
        const done = await writeClip(
          record,
          { ffmpeg: this.tool('ffmpeg'), ffprobe: this.tool('ffprobe') },
          signal,
          (next, n) => {
            s.putExport({ ...next, started: job.started, elapsedMs: elapsedMs() });
            progress(n, next.message);
          },
          guard,
          await this.exportAudio(record),
        );
        await guard();
        await verifyPublished(done, signal);
        const subtitles = done.subtitles?.requested.length
          ? await writeSubtitleSidecars(done, (role) => this.subtitleSource(done, role))
          : undefined;
        const completed = {
          ...done,
          subtitles,
          started: job.started,
          elapsedMs: elapsedMs(),
          ...(done.filing
            ? {
                filing: {
                  ...done.filing,
                  state: 'complete' as const,
                  completedAt: new Date().toISOString(),
                },
                message: 'Filed · video, audio, metadata and Date modified verified.',
              }
            : {}),
        };
        const history = done.companionTranscripts;
        if (history) {
          const kept = history.items.map((h) => h.transcript.role);
          completed.message += kept.length
            ? ` Transcript history kept in the companion (${kept.map((r) => (r === 'game' ? 'game dialogue' : 'microphone')).join(', ')}).`
            : ' No finished transcript for the companion history.';
        }
        if (subtitles) completed.message += subtitleSummary(subtitles, done.verification);
        s.putExport(completed);
        this.batchRecords.exportSettled(s, completed.plan.id);
        s.putJob({
          ...job,
          state: 'succeeded',
          progress: 1,
          message: completed.message,
          elapsedMs: elapsedMs(),
          updated: done.updated,
        });
        return;
      }
      if (!source) throw new Error('Source file is not registered. Import it again.');
      const actual = await identify(source.file, source.id);
      if (actual.fingerprint !== source.fingerprint || actual.modified !== source.modified)
        throw new Error(
          'Source changed since import. Relink an unchanged copy or import it as new.',
        );
      const prefix = path.join(s.data.project.cache, `${source.id}-${source.fingerprint}`);
      const free = await import('node:fs/promises').then((fs) => fs.statfs(s.data.project.cache));
      if (free.bavail * free.bsize < 256 * 1024 * 1024)
        throw new Error('Not enough free space in the preview cache.');
      if (job.kind === 'transcribe') {
        const record = s.data.model.recordings.find((r) => r.id === source.id)!;
        const request = job.transcription;
        if (!request || !job.role || job.track == null)
          throw new Error('This job has no transcription settings. Start a new transcription.');
        const track = record.audioTracks?.find((t) => t.index === job.track);
        if (!track) throw new Error('The selected audio track is no longer available.');
        if (free.bavail * free.bsize < 256 * 1024 * 1024 + record.duration * 32000)
          throw new Error('Free more preview-cache space before transcribing.');
        const context = effectiveContext(s.data.model.contexts, request.batchId);
        let transcript: TranscriptSummary = {
          id: job.id,
          sourceId: source.id,
          fingerprint: source.fingerprint,
          role: job.role,
          track: job.track,
          language: request.language,
          duration: record.duration,
          offset: track.offset,
          state: 'running',
          model:
            this.transcription.settings.model
              .replaceAll('\\', '/')
              .match(/models--[^/]+--([^/]+)/)?.[1] ||
            path.basename(this.transcription.settings.model),
          pipeline: TRANSCRIPTION_PIPELINE,
          device: request.device || this.transcription.settings.device,
          created: new Date().toISOString(),
          context: request.contextId
            ? s.transcripts.context(request.contextId)
            : {
                gameId: context.game?.id,
                gameName: context.game?.name,
                vocabulary: request.vocabulary ? hintVocabulary(context.game) : '',
                brief: context.brief,
                ...(cleanHeardAs(context.game?.heardAs).length
                  ? { heardAs: cleanHeardAs(context.game?.heardAs) }
                  : {}),
              },
          segmentCount: 0,
          wordCount: 0,
        };
        s.transcripts.begin(transcript);
        const wav = `${prefix}-asr-${job.id}.partial.wav`;
        const claim = await open(wav, 'wx');
        await claim.close();
        pcm = wav;
        await this.transcription.run(
          {
            source: source.file,
            track: job.track,
            offset: track.offset,
            language: request.language,
            vocabulary: transcript.context.vocabulary,
            ffmpeg: this.tool('ffmpeg'),
            wav: pcm,
            tempDirectory: s.data.project.cache,
            device: request.device || this.transcription.settings.device,
          },
          signal,
          (event) => {
            if (event.device) {
              transcript.device = event.device;
              job = {
                ...job,
                device: event.device,
                deviceMessage: event.message || job.deviceMessage,
              };
              last = 0;
              progress(
                0.03,
                event.device === 'cpu' ? 'Transcribing on CPU' : 'Transcribing on NVIDIA GPU',
              );
            }
            if (event.type === 'info' && event.message) {
              transcript.deviceMessage = event.message;
              this.diagnostics?.record('transcription-device', {
                jobId: job.id,
                device: event.device,
                message: event.message,
              });
            }
            if (event.type === 'stage') progress(event.progress || 0, event.message);
            if (event.engine) transcript.engineVersion = event.engine;
            if (event.runtime) transcript.runtimeVersion = event.runtime;
            if (event.peakMemoryBytes) transcript.peakMemoryBytes = event.peakMemoryBytes;
            if (
              event.type === 'complete' &&
              transcript.context.vocabulary &&
              Number.isSafeInteger(event.guardRedos)
            )
              transcript.guardRedos = event.guardRedos;
            if (event.type === 'info') {
              transcript = {
                ...transcript,
                language: event.language ?? transcript.language,
                languageProbability: event.languageProbability ?? transcript.languageProbability,
              };
              s.transcripts.put(transcript);
            }
            if (event.type === 'segment' && event.segment) {
              const segment = event.segment;
              if (
                !Number.isSafeInteger(segment.id) ||
                segment.id !== transcript.segmentCount ||
                !Number.isFinite(segment.start) ||
                !Number.isFinite(segment.end) ||
                segment.start < 0 ||
                segment.end < segment.start ||
                segment.end > record.duration + 1 ||
                typeof segment.text !== 'string' ||
                segment.text.length > 10000 ||
                !Array.isArray(segment.words) ||
                segment.words.length > 10000 ||
                segment.words.some(
                  (w) =>
                    !Number.isFinite(w.start) ||
                    !Number.isFinite(w.end) ||
                    w.start < 0 ||
                    w.end < w.start ||
                    w.end > record.duration + 1 ||
                    typeof w.text !== 'string',
                ) ||
                (segment.voiceScore != null &&
                  (!Number.isFinite(segment.voiceScore) ||
                    segment.voiceScore < 0 ||
                    segment.voiceScore > 1)) ||
                (segment.hintGuard != null &&
                  !['stock-phrase', 'sparse'].includes(segment.hintGuard))
              )
                throw new Error(
                  'The speech model returned invalid timing. Original recording is unchanged.',
                );
              s.transcripts.append(job.id, segment);
              transcript.segmentCount++;
              transcript.wordCount += segment.words.length;
              progress(
                event.progress || 0,
                `Recognizing ${job.role} speech · ${transcript.wordCount} words`,
              );
            }
          },
        );
        signal.throwIfAborted();
        const final = await stat(source.file);
        if (final.size !== source.bytes || final.mtimeMs !== source.modified)
          throw new Error('Recording changed during transcription.');
        const finished: TranscriptSummary = {
          ...transcript,
          state: 'complete',
          completed: new Date().toISOString(),
          elapsedMs: elapsedMs(),
        };
        // VC-166: short microphone lines with no voice under them, or stock phrases, are dropped
        // as one edit, so Undo brings them back. The recognition itself stays as it was heard.
        const dropped = dropLines(finished, s.transcripts.segments(job.id, -1, false, true));
        // VC-194: the game's heard-as spellings become visible corrections, in the same edit.
        const heard = heardAsEdits(
          s.data.model,
          finished,
          s.transcripts.segments(job.id, -1, false, true),
          heardAsRules(finished.context.heardAs).rules,
        ).edits;
        s.transcripts.put(finished);
        if (dropped.length || heard.length) {
          const model = s.data.model;
          s.save(model, {
            ...model,
            droppedLines: [...(model.droppedLines || []), ...dropped],
            transcriptEdits: [...(model.transcriptEdits || []), ...heard],
          });
        }
      } else if (job.kind === 'inspect') {
        const info = await inspectMedia(source.file, source.id, this.tool('ffprobe'), signal, (n) =>
          progress(n),
        );
        {
          const file = `${prefix}-frame-0.jpg`;
          temp = `${prefix}-frame-0.partial.jpg`;
          await launchTool(
            this.tool('ffmpeg'),
            [
              '-v',
              'error',
              '-nostdin',
              '-ss',
              String(info.duration / 2),
              '-i',
              source.file,
              '-frames:v',
              '1',
              '-vf',
              'scale=320:-2',
              '-y',
              temp,
            ],
            signal,
          );
          if (!existsSync(temp) || (await stat(temp)).size < 100)
            throw new Error('A preview frame could not be decoded.');
          await rename(temp, file);
          temp = '';
        }
        const final = await stat(source.file);
        if (final.size !== source.bytes || final.mtimeMs !== source.modified)
          throw new Error('Recording changed during inspection.');
        s.transaction(() => {
          const r = s.data.model.recordings.find((r) => r.id === source.id)!;
          const { markers, frameTimes, keys, ...facts } = info;
          s.putFrameIndex(source.id, source.fingerprint, { frameTimes, keys });
          const defaults = r.importAudio || { game: 1, mic: null };
          const existing = !!s.data.model.markerBaseline?.[source.id];
          const game = existing
            ? r.gameTrack
            : defaults.game == null
              ? null
              : (info.audioTracks[defaults.game - 1]?.index ?? null);
          const mic = existing
            ? r.micTrack
            : defaults.mic == null
              ? null
              : (info.audioTracks[defaults.mic - 1]?.index ?? null);
          delete r.frameTimes;
          delete r.keys;
          Object.assign(r, facts, {
            frameCount: frameTimes.length,
            keyCount: keys.length,
            availability: 'ready',
            error: '',
            gameTrack: game,
            micTrack: mic,
            audioWarning:
              (defaults.game != null && game == null) || (defaults.mic != null && mic == null)
                ? 'This recording does not have the batch’s selected audio track. Choose its tracks below.'
                : '',
            monitor: r.monitor || 'game',
          });
          if (!s.data.model.markerBaseline?.[source.id]) {
            s.data.model.markers[source.id] = markers;
            (s.data.model.markerBaseline ??= {})[source.id] = structuredClone(markers);
            // No clip is made here (VC-206): every clip is cut by the user or proposed by an
            // agent. Cut offers a one-action whole-recording clip.
          }
          s.data.revision++;
        });
        this.queueAudio(source.id);
        const transcription = s.data.model.recordings.find((r) => r.id === source.id)?.importAudio
          ?.transcription;
        if (transcription) {
          try {
            this.requestTranscription(
              s.data.project.id,
              source.id,
              s.data.model.recordings.find((r) => r.id === source.id)!.batchIds![0],
              transcription,
              'background',
            );
          } catch (e) {
            s.putJob({
              id: randomUUID(),
              sourceId: source.id,
              kind: 'transcribe',
              state: 'failed',
              progress: 0,
              message: e instanceof Error ? e.message : String(e),
              updated: new Date().toISOString(),
            });
          }
        }
        // The picture pass (VC-180) follows in the background, after the transcript. Checks
        // run with it manual so imports elsewhere in the suite don't start GPU work.
        if (process.env.VIRTUAL_CUT_PICTURE_PASS !== 'manual') {
          this.enqueuePicture(source.id, 'background');
          // Screen text (VC-141) follows the picture pass.
          this.enqueueScreenText(source.id, 'background');
        }
        // Proxies asked for at import (VC-237) follow the picture pass in the same lane.
        const proxies = proxySettings(s.data.proxies);
        if (
          s.data.model.recordings.find((r) => r.id === source.id)?.importAudio?.proxy &&
          proxies.onImport !== 'never' &&
          !s.sources().find((x) => x.id === source.id)?.proxy
        )
          this.enqueueProxy(source.id, 'background', proxies.height);
      } else {
        // Publish a fresh generation. Windows may lock a preview currently playing;
        // replacing that file breaks waveform upgrades and retry preparation.
        const file = `${prefix}-audio-${job.track}-${randomUUID()}.m4a`;
        temp = `${prefix}-audio-${job.track}-${job.id}.partial.m4a`;
        pcm = `${prefix}-audio-${job.track}-${job.id}.partial.f32`;
        const record = s.data.model.recordings.find((r) => r.id === source.id)!;
        const duration = record.duration;
        const expected = record.audioTracks?.find((t) => t.index === job.track)?.duration;
        // Lossless 24-bit stereo is at most about 290 kB per second.
        if (free.bavail * free.bsize < 256 * 1024 * 1024 + duration * 300000)
          throw new Error('Free more space in the preview cache before preparing this audio.');
        const starts = JSON.parse(
          await launchTool(
            this.tool('ffprobe'),
            [
              '-v',
              'error',
              '-show_entries',
              'format=start_time:stream=index,codec_name,start_time',
              '-of',
              'json',
              source.file,
            ],
            signal,
          ),
        ) as {
          format?: { start_time?: string };
          streams?: { index: number; codec_name?: string; start_time?: string }[];
        };
        const probed = starts.streams?.find((x) => x.index === job.track);
        if (!probed?.codec_name) throw new Error('This audio track could not be read.');
        const kind = playableAudio(probed.codec_name) ? 'copy' : 'flac';
        await launchTool(
          this.tool('ffmpeg'),
          [
            '-v',
            'error',
            '-nostdin',
            ...audioCopyArgs(
              source.file,
              job.track!,
              probed.codec_name,
              Number(starts.format?.start_time || 0) - Number(probed.start_time || 0),
            ),
            '-movflags',
            '+faststart',
            '-f',
            'mp4',
            '-progress',
            'pipe:1',
            '-y',
            temp,
            '-map',
            `0:${job.track}`,
            '-vn',
            '-ac',
            '1',
            '-ar',
            '8000',
            '-c:a',
            'pcm_f32le',
            '-f',
            'f32le',
            '-y',
            pcm,
          ],
          signal,
          (line) => {
            if (line.startsWith('out_time_us='))
              progress(Math.min(0.99, Number(line.split('=')[1]) / 1e6 / duration));
          },
        );
        if ((await stat(temp)).size === 0) throw new Error('Audio preview is empty.');
        const verification = JSON.parse(
          await launchTool(
            this.tool('ffprobe'),
            ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', temp],
            signal,
          ),
        );
        const stream = verification.streams?.find(
          (x: { codec_type: string }) => x.codec_type === 'audio',
        );
        const actualDuration = Number(stream?.duration);
        if (
          !Number.isFinite(actualDuration) ||
          actualDuration <= 0 ||
          (expected && Math.abs(actualDuration - expected) > 0.25)
        )
          throw new Error('Audio preview duration did not match its source stream.');
        // Nothing may change: copied packets stay byte-identical, and a FLAC copy decodes
        // to the original's exact samples. The copy is what you hear and what exports carry.
        const [original, copied] = await Promise.all(
          kind === 'copy'
            ? [
                packetHash(this.tool('ffprobe'), source.file, job.track!, signal),
                packetHash(this.tool('ffprobe'), temp, 0, signal),
              ]
            : [
                decodedAudioHash(this.tool('ffmpeg'), source.file, job.track!, signal),
                decodedAudioHash(this.tool('ffmpeg'), temp, 0, signal),
              ],
        );
        if (original !== copied)
          throw new Error('The audio copy did not decode identical to the original track.');
        const final = await stat(source.file);
        if (final.size !== source.bytes || final.mtimeMs !== source.modified)
          throw new Error('Recording changed during audio preparation.');
        const peaks = await waveform(pcm, 8000);
        signal.throwIfAborted();
        await rename(temp, file);
        temp = '';
        const published = await stat(file),
          copyIdentity = { bytes: published.size, modified: published.mtimeMs };
        s.transaction(() => {
          const native = s.sources().find((x) => x.id === source.id)!;
          s.putSource({
            ...native,
            audioPreviews: {
              ...native.audioPreviews,
              [job.track!]: path.basename(file),
            },
            audioCopies: { ...native.audioCopies, [job.track!]: { kind, ...copyIdentity } },
          });
          const track = s.data.model.recordings
            .find((r) => r.id === source.id)
            ?.audioTracks?.find((t) => t.index === job.track);
          if (track) track.waveform = peaks;
        });
      }
      s.putJob({
        ...job,
        state: 'succeeded',
        progress: 1,
        message: 'Complete',
        elapsedMs: elapsedMs(),
        updated: new Date().toISOString(),
      });
    } catch (e) {
      failureCode = errorCode(e);
      if (job.kind === 'transcribe') {
        const transcript = s.transcripts.list(job.sourceId).find((t) => t.id === job.id);
        if (transcript)
          s.transcripts.put({
            ...transcript,
            state: signal.aborted ? (this.switching ? 'interrupted' : 'cancelled') : 'failed',
            elapsedMs: elapsedMs(),
          });
      }
      if (job.kind === 'export') {
        const record = s.exports().find((e) => e.plan.id === job.id);
        if (record)
          s.putExport({
            ...record,
            started: job.started,
            elapsedMs: elapsedMs(),
            state: signal.aborted ? (this.switching ? 'interrupted' : 'cancelled') : 'failed',
            message: signal.aborted
              ? 'Export stopped. Retry from Jobs.'
              : e instanceof Error
                ? e.message
                : String(e),
            updated: new Date().toISOString(),
          });
      }
      s.putJob({
        ...job,
        state: signal.aborted ? (this.switching ? 'interrupted' : 'cancelled') : 'failed',
        progress: 0,
        message: signal.aborted ? 'Cancelled' : e instanceof Error ? e.message : String(e),
        elapsedMs: elapsedMs(),
        updated: new Date().toISOString(),
      });
      if (job.kind === 'inspect') {
        const r = s.data.model.recordings.find((r) => r.id === job.sourceId);
        if (r) {
          r.availability = 'failed';
          r.error = signal.aborted ? 'Inspection cancelled' : String(e);
          s.write();
        }
      }
    } finally {
      const finalJob = s.jobs().find((j) => j.id === job.id);
      this.diagnostics?.record(
        finalJob?.state === 'succeeded'
          ? 'job-end'
          : signal.aborted
            ? 'job-cancelled'
            : 'job-failed',
        {
          jobId: job.id,
          sourceId: job.sourceId,
          kind: job.kind,
          elapsedMs: elapsedMs(),
          errorCode: failureCode,
        },
      );
      if (temp) await unlink(temp).catch(() => {});
      if (pcm) await unlink(pcm).catch(() => {});
    }
  }
}

/** A picture pass stopping to wait (VC-180), as opposed to being cancelled. */
class PictureYield extends Error {}

/** What a proxy job decodes and encodes with, as Jobs shows it (VC-237). */
function proxyUseText(use?: VisualUse, encode?: ProxyEncode) {
  const decode = use === 'gpu' ? 'GPU decoder' : use ? 'CPU decoder' : 'starting';
  return encode ? `${decode} · ${encode === 'nvenc' ? 'NVENC' : 'x264 (CPU)'}` : decode;
}

/** What a picture pass decodes with, as Jobs shows it. */
function useText(use?: VisualUse) {
  return use === 'gpu+cpu'
    ? 'GPU decoder + CPU'
    : use === 'gpu'
      ? 'GPU decoder'
      : use === 'cpu'
        ? 'CPU'
        : 'starting';
}

/** How a finished picture pass read the recording. */
function useLabel(use: VisualUse) {
  return use === 'gpu+cpu' ? 'GPU + CPU' : use === 'gpu' ? 'GPU' : 'CPU';
}
