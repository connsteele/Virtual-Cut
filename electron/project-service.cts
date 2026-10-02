import { markerIntersects, relativeMarker } from './marker-ranges.js';
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
  planProjectDeletion,
  executeProjectDeletion,
  type DeletionPlan,
} from './project-deletion.cjs';
import { identify, inspectMedia, launchTool } from './media-inspection.cjs';
import { VideoAccess, videoExtensions } from './media.cjs';
import { FilmstripCache } from './filmstrip.cjs';
import { inspectRetainedOutput } from './retained-preview.cjs';
import type { MediaJob, RecentProject, ImportAudio } from './project-contracts.js' with {
  'resolution-mode': 'import',
};
import type { Model } from './workflow-types.js' with { 'resolution-mode': 'import' };
import { mergeEdits, validateEdits } from './project-edits.js';
import {
  destinationPlan,
  destinationFolders,
  destinationLocation,
  destinationSelection,
  prepareDestination,
} from './destination-plan.cjs';
import { destinationSignature } from './review-plan.js';
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
} from './export-contracts.js' with { 'resolution-mode': 'import' };

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
  private filmstripCache = new FilmstripCache();
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
    if (this.retainedPreview) this.filmstripCache.clear();
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
    if (!r.keys?.length) throw new Error('Keyframe index is unavailable.');
    return this.filmstripCache.request(
      this.tool('ffmpeg'),
      source,
      r.sourceStart || 0,
      r.keys,
      times,
      token,
    );
  }
  cancelFilmstrip(id: string, token: string, release = false) {
    this.require(id);
    this.filmstripCache.cancel(token, release === true);
  }
  store: ProjectStore | null = null;
  private grants = new Map<string, { access: VideoAccess; url: string }>();
  private active: { id: string; controller: AbortController; finished: Promise<void> } | null =
    null;
  private switching = false;
  constructor(
    private profile: string,
    private toolsDirectory: string,
    private diagnostics?: Diagnostics,
  ) {}
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
    return this.snapshot();
  }
  async close() {
    this.switching = true;
    try {
      this.releaseRetained();
      this.retainedDetails.clear();
      await this.filmstripCache.close();
      this.active?.controller.abort();
      await this.active?.finished;
      await this.store?.checkpoint('auto', true);
      this.store?.close();
      this.store = null;
      this.grants.clear();
      this.filingPlans.clear();
    } finally {
      this.switching = false;
    }
  }
  private tool(name: 'ffmpeg' | 'ffprobe') {
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
    const valid =
      name?.startsWith(prefix + '-') && /^[a-f0-9-]{36}\.m4a$/.test(name.slice(prefix.length + 1));
    return path.join(this.require().data.project.cache, valid ? name! : prefix + '.m4a');
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
        this.filmstripCache.clear();
        dirty = true;
        this.grants.delete(s.file);
      }
    }
    if (dirty) store.write();
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
      try {
        item.current = item.inputHash === this.exportInput(item.plan.clipId, false).hash;
      } catch {
        item.current = false;
      }
    }
    snapshot.library = await this.retainedClips();
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
      // A stable media-pool poster is separate from the in-memory timeline.
      const prefix = path.join(store.data.project.cache, `${r.id}-${source?.fingerprint}`);
      const legacyPoster = `${prefix}-frame-4.jpg`;
      const poster = existsSync(legacyPoster) ? legacyPoster : `${prefix}-frame-0.jpg`;
      r.frames = [];
      r.poster = existsSync(poster) ? await this.grant(poster) : '';
    }
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
    this.filmstripCache.clear();
    const store = this.require(id);
    this.switching = true;
    try {
      this.active?.controller.abort();
      await this.active?.finished;
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
    this.filmstripCache.clear();
    const s = this.require(id);
    if (!s.data.batches.some((b) => b.id === batchId)) throw new Error('Batch not found.');
    const recording = s.data.model.recordings.find((r) => r.id === sourceId);
    if (!recording?.batchIds?.includes(batchId))
      throw new Error('This recording is no longer in the chosen batch.');
    const otherBatches = recording.batchIds.filter((b) => b !== batchId);
    this.switching = true;
    try {
      // Shared sources remain registered, so their ongoing work can continue.
      if (
        !otherBatches.length &&
        this.active &&
        s.jobs().some((j) => j.id === this.active!.id && j.sourceId === sourceId)
      ) {
        this.active.controller.abort();
        await this.active.finished;
      }
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
    this.filmstripCache.clear();
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
      if (
        this.active &&
        s.jobs().some((j) => j.id === this.active!.id && removed.has(j.sourceId))
      ) {
        this.active.controller.abort();
        await this.active.finished;
      }
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
            /^-(?:frame-[0-7](?:\.partial)?\.jpg|audio-\d+(?:-[a-f\d-]{36})?(?:\.partial)?\.(?:m4a|f32))$/i;
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
    for (const value of [defaults.game, defaults.mic])
      if (value != null && (!Number.isInteger(value) || value < 1 || value > 64))
        throw new Error('Choose an audio track number from 1 to 64.');
    if (defaults.game != null && defaults.game === defaults.mic)
      throw new Error('Game audio and microphone notes need different tracks.');
    batch.audioDefaults = defaults;
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
            });
            r.availability = r.duration ? 'ready' : 'pending';
            this.grants.delete(existing.file);
          }
          s.write();
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
            importAudio: defaults,
          });
          s.data.model.markers[sourceId] = [];
          s.data.revision++;
          this.enqueue(sourceId, 'inspect');
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
  private enqueue(sourceId: string, kind: 'inspect' | 'audio', track?: number) {
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
      track,
      state: 'queued',
      progress: 0,
      message: 'Waiting',
      updated: new Date().toISOString(),
    });
  }
  private queueAudio(sourceId: string) {
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
        this.enqueue(sourceId, 'audio', index);
    this.pump();
  }
  async prepareAudio(id: string, sourceId: string) {
    this.require(id);
    this.queueAudio(sourceId);
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
    const keys = [...(recording.keys || [])].sort((a, b) => a - b);
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
  async startExport(id: string, planId: string, output: string, cleanGameConfirmed: boolean) {
    const s = this.require(id),
      record = s.exports().find((e) => e.plan.id === planId);
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
      state: 'queued',
      progress: 0,
      message: next.message,
      updated: next.updated,
    });
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
  async fileQueue(id: string, planId: string, confirmed: boolean) {
    const s = this.require(id),
      saved = this.filingPlans.get(planId);
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
        record.state = 'queued';
        record.message = 'Waiting to file';
        s.putExport(record);
        s.putJob({
          id: record.plan.id,
          sourceId: record.plan.sourceId,
          kind: 'export',
          state: 'queued',
          progress: 0,
          message: record.message,
          updated: record.updated,
        });
      }
    });
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
    if (this.active && records.some((e) => e.plan.id === this.active!.id)) {
      this.active.controller.abort();
      await this.active.finished;
    }
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
            markers: e.input.markers
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
      if (this.active?.id === jobId) {
        this.active.controller.abort();
        await this.active.finished;
      } else if (job.state === 'queued')
        s.putJob({
          ...job,
          state: 'cancelled',
          message: 'Cancelled',
          updated: new Date().toISOString(),
        });
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
    this.filmstripCache.clear();
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
      s.putSource({ ...next, importedAt: old.importedAt, audioPreviews: old.audioPreviews });
      const r = s.data.model.recordings.find((r) => r.id === sourceId)!;
      r.sourcePath = next.file;
      r.availability = r.duration ? 'ready' : 'pending';
      r.error = '';
      s.data.revision++;
    });
    this.grants.delete(old.file);
    if (!s.data.model.recordings.find((r) => r.id === sourceId)?.duration) {
      this.enqueue(sourceId, 'inspect');
      this.pump();
    }
    return this.snapshot();
  }
  private pump() {
    if (this.active || this.switching || !this.store) return;
    const job = [...this.store.jobs()].reverse().find((j) => j.state === 'queued');
    if (!job) return;
    const controller = new AbortController();
    const finished = this.run(job, controller.signal).finally(() => {
      this.active = null;
      this.pump();
    });
    this.active = { id: job.id, controller, finished };
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
        );
        await guard();
        await verifyPublished(done, signal);
        const completed = {
          ...done,
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
        s.putExport(completed);
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
      if (job.kind === 'inspect') {
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
          const { markers, ...facts } = info;
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
          Object.assign(r, facts, {
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
            s.data.model.clips.push({
              id: randomUUID(),
              rid: source.id,
              name: r.title,
              originalName: r.title,
              folder: '_Review',
              originalFolder: '_Review',
              start: 0,
              end: r.duration,
              include: true,
            });
          }
          s.data.revision++;
        });
        this.queueAudio(source.id);
      } else {
        // Publish a fresh generation. Windows may lock a preview currently playing;
        // replacing that file breaks waveform upgrades and retry preparation.
        const file = `${prefix}-audio-${job.track}-${randomUUID()}.m4a`;
        temp = `${prefix}-audio-${job.track}-${job.id}.partial.m4a`;
        pcm = `${prefix}-audio-${job.track}-${job.id}.partial.f32`;
        const record = s.data.model.recordings.find((r) => r.id === source.id)!;
        const duration = record.duration;
        const expected = record.audioTracks?.find((t) => t.index === job.track)?.duration;
        if (free.bavail * free.bsize < 256 * 1024 * 1024 + duration * 64000)
          throw new Error('Free more space in the preview cache before preparing this audio.');
        await launchTool(
          this.tool('ffmpeg'),
          [
            '-v',
            'error',
            '-nostdin',
            '-i',
            source.file,
            '-map',
            `0:${job.track}`,
            '-vn',
            '-af',
            'asetpts=PTS-STARTPTS',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-movflags',
            '+faststart',
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
        const final = await stat(source.file);
        if (final.size !== source.bytes || final.mtimeMs !== source.modified)
          throw new Error('Recording changed during audio preparation.');
        const peaks = await waveform(pcm, 8000);
        signal.throwIfAborted();
        await rename(temp, file);
        temp = '';
        s.transaction(() => {
          const native = s.sources().find((x) => x.id === source.id)!;
          s.putSource({
            ...native,
            audioPreviews: {
              ...native.audioPreviews,
              [job.track!]: path.basename(file),
            },
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
