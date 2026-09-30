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
import { identify, inspectMedia, launchTool } from './media-inspection.cjs';
import { VideoAccess, videoExtensions } from './media.cjs';
import { FilmstripCache } from './filmstrip.cjs';
import type { MediaJob, RecentProject, ImportAudio } from './project-contracts.js' with {
  'resolution-mode': 'import',
};
import type { Model } from './workflow-types.js' with { 'resolution-mode': 'import' };
import { editorial } from './project-edits.js';
import { exportClip as writeClip } from './clip-export.cjs';
import type {
  ExportContainer,
  ExportContainerChoice,
  ExportInput,
  ExportPlan,
  ExportRecord,
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
  private filmstripCache = new FilmstripCache();
  filmstrip(id: string, sourceId: string, times: number[], token: string) {
    const store = this.require(id);
    const source = store.sources().find((s) => s.id === sourceId);
    const r = store.data.model.recordings.find((r) => r.id === sourceId);
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
  ) {}
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
    await this.close();
    this.store = next;
    await next.loadCopies();
    this.reconcileExports();
    process.env.VIRTUAL_CUT_MEDIA_TEMP = next.data.project.cache;
    await this.refreshAvailability();
    await this.remember();
    const selected =
      next.data.model.recordings.find((r) => r.id === next.data.model.selectedRecordingId) ||
      next.data.model.recordings[0];
    if (selected?.availability === 'ready') this.queueAudio(selected.id);
    return this.snapshot();
  }
  async close() {
    this.switching = true;
    try {
      await this.filmstripCache.close();
      this.active?.controller.abort();
      await this.active?.finished;
      await this.store?.checkpoint('auto', true);
      this.store?.close();
      this.store = null;
      this.grants.clear();
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
    const access = new VideoAccess();
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
        this.filmstripCache.clear();
        dirty = true;
        this.grants.delete(s.file);
      }
    }
    if (dirty) store.write();
  }
  async snapshot() {
    await this.refreshAvailability();
    const store = this.require(),
      snapshot = store.snapshot();
    for (const item of snapshot.exports) {
      try {
        item.current = item.inputHash === this.exportInput(item.plan.clipId).hash;
      } catch {
        item.current = false;
      }
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
    if (editorial(previous) !== editorial(store.data.model)) await store.checkpoint('auto');
    return this.snapshot();
  }
  async checkpoint(id: string) {
    await this.require(id).checkpoint('manual');
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
  private exportInput(clipId: string) {
    const s = this.require(),
      clip = s.data.model.clips.find((c) => c.id === clipId),
      r = s.data.model.recordings.find((r) => r.id === clip?.rid),
      source = s.sources().find((x) => x.id === clip?.rid);
    if (!clip || !r || !source || r.availability !== 'ready')
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
    delete clipPayload.held;
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
  async exportPlan(id: string, clipId: string, choice: ExportContainerChoice): Promise<ExportPlan> {
    const s = this.require(id);
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
    s.discardExportPlans();
    s.putExport({
      plan,
      annotationVersion: 2,
      input,
      inputHash: hash,
      state: 'planned',
      message: 'Ready to choose an output file.',
      updated: plan.created,
    });
    return plan;
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
    try {
      if (job.kind === 'export') {
        const record = s.exports().find((e) => e.plan.id === job.id);
        if (!record) throw new Error('Export plan is unavailable.');
        const done = await writeClip(
          record,
          { ffmpeg: this.tool('ffmpeg'), ffprobe: this.tool('ffprobe') },
          signal,
          (next, n) => {
            s.putExport({ ...next, started: job.started, elapsedMs: elapsedMs() });
            progress(n, next.message);
          },
        );
        s.putExport({ ...done, started: job.started, elapsedMs: elapsedMs() });
        s.putJob({
          ...job,
          state: 'succeeded',
          progress: 1,
          message: done.message,
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
      if (temp) await unlink(temp).catch(() => {});
      if (pcm) await unlink(pcm).catch(() => {});
    }
  }
}
