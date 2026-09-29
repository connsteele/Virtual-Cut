import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectStore } from './project-store.cjs';
import { identify, inspectMedia, launchTool } from './media-inspection.cjs';
import { VideoAccess, videoExtensions } from './media.cjs';
import type { MediaJob, RecentProject, ImportAudio } from './project-contracts.js' with {
  'resolution-mode': 'import',
};
import type { Model } from './workflow-types.js' with { 'resolution-mode': 'import' };
import { editorial } from './project-edits.js';

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
    for (const r of snapshot.model.recordings) {
      const source = store.sources().find((s) => s.id === r.id);
      if (source && r.availability === 'ready') {
        try {
          r.url = await this.grant(source.file);
        } catch {
          r.availability = 'missing';
          r.url = '';
        }
      } else r.url = '';
      for (const track of r.audioTracks || []) {
        const audio = path.join(
          store.data.project.cache,
          `${r.id}-${source?.fingerprint}-audio-${track.index}.m4a`,
        );
        if (existsSync(audio)) track.previewUrl = await this.grant(audio);
      }
      const frames: string[] = [];
      for (let i = 0; i < 8; i++) {
        const file = path.join(
          store.data.project.cache,
          `${r.id}-${source?.fingerprint}-frame-${i}.jpg`,
        );
        if (existsSync(file)) frames.push(await this.grant(file));
      }
      r.frames = frames;
      r.poster = frames[Math.floor(frames.length / 2)] || '';
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
  async restore(id: string, saveId: string) {
    const store = this.require(id);
    this.switching = true;
    try {
      this.active?.controller.abort();
      await this.active?.finished;
      await store.restore(saveId);
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
        const native = await identify(file, sourceId);
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
            s.putSource({ ...native, id: existing.id });
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
          !existsSync(
            path.join(s.data.project.cache, `${r.id}-${native.fingerprint}-audio-${index}.m4a`),
          ))
      )
        this.enqueue(sourceId, 'audio', index);
    this.pump();
  }
  async prepareAudio(id: string, sourceId: string) {
    this.require(id);
    this.queueAudio(sourceId);
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
    } else if (action === 'retry' && ['failed', 'interrupted', 'cancelled'].includes(job.state)) {
      if (!s.sources().some((x) => x.id === job.sourceId))
        throw new Error('Choose the recording again using Import.');
      s.putJob({
        ...job,
        state: 'queued',
        progress: 0,
        message: 'Waiting to retry',
        updated: new Date().toISOString(),
      });
      this.pump();
    } else throw new Error('That action is unavailable for this job.');
    return this.snapshot();
  }
  async relink(id: string, sourceId: string, file: string) {
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
      s.putSource(next);
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
        updated: new Date().toISOString(),
      });
    };
    progress(0);
    let temp = '',
      pcm = '';
    try {
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
        const frames = [];
        for (let i = 0; i < 8; i++) {
          const file = `${prefix}-frame-${i}.jpg`;
          temp = `${prefix}-frame-${i}.partial.jpg`;
          await launchTool(
            this.tool('ffmpeg'),
            [
              '-v',
              'error',
              '-nostdin',
              '-ss',
              String((info.duration * (i + 0.5)) / 8),
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
          frames.push(file);
          temp = '';
        }
        const final = await stat(source.file);
        if (final.size !== source.bytes || final.mtimeMs !== source.modified)
          throw new Error('Recording changed during inspection.');
        s.transaction(() => {
          const r = s.data.model.recordings.find((r) => r.id === source.id)!;
          const { markers, ...facts } = info;
          const defaults = r.importAudio || { game: 1, mic: null };
          const game =
            defaults.game == null ? null : (info.audioTracks[defaults.game - 1]?.index ?? null);
          const mic =
            defaults.mic == null ? null : (info.audioTracks[defaults.mic - 1]?.index ?? null);
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
        const file = `${prefix}-audio-${job.track}.m4a`;
        temp = `${prefix}-audio-${job.track}.partial.m4a`;
        pcm = `${prefix}-audio-${job.track}.partial.f32`;
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
        await rename(temp, file);
        temp = '';
        const peaks = await waveform(pcm, 8000);
        s.transaction(() => {
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
        updated: new Date().toISOString(),
      });
    } catch (e) {
      s.putJob({
        ...job,
        state: signal.aborted ? 'cancelled' : 'failed',
        progress: 0,
        message: signal.aborted ? 'Cancelled' : e instanceof Error ? e.message : String(e),
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
