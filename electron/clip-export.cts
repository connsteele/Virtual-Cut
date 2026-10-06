import { markerIntersects } from './marker-ranges.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  link,
  lstat,
  open,
  readFile,
  realpath,
  stat,
  statfs,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { identify, launchTool } from './media-inspection.cjs';
import { colors, markerColor, markerColorName } from './workflow-types.js';
import { transcriptHandoff } from './transcript-export.js';
import type { ExportRecord, ExportVerification } from './export-contracts.js' with {
  'resolution-mode': 'import',
};

interface Stream {
  index: number;
  codec_type: string;
  codec_name: string;
  time_base: string;
  r_frame_rate?: string;
  disposition?: { attached_pic?: number };
}
interface Packet {
  stream: number;
  pts: number;
  dts: number;
  duration: number;
  hash: string;
  key: boolean;
}
interface Media {
  streams: Stream[];
  packets: Packet[];
  chapters: { start_time: string; tags?: { title?: string } }[];
}
type Tools = { ffmpeg: string; ffprobe: string };
const quickTime = (container: string) => ['mp4', 'mov', 'm4v'].includes(container);
export async function fileHash(file: string, signal?: AbortSignal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    signal?.throwIfAborted();
    hash.update(chunk);
  }
  return hash.digest('hex');
}
async function probe(file: string, tool: string, signal: AbortSignal): Promise<Media> {
  const facts = JSON.parse(
    await launchTool(
      tool,
      ['-v', 'error', '-show_streams', '-show_chapters', '-of', 'json', file],
      signal,
    ),
  );
  const streams: Stream[] = facts.streams;
  const indices = new Set(
    streams
      .filter((s) => ['video', 'audio'].includes(s.codec_type) && !s.disposition?.attached_pic)
      .map((s) => s.index),
  );
  const packets: Packet[] = [];
  await launchTool(
    tool,
    [
      '-v',
      'error',
      '-show_packets',
      '-show_data_hash',
      'sha256',
      '-show_entries',
      'packet=stream_index,pts_time,dts_time,duration_time,flags,data_hash',
      '-of',
      'compact=p=0:nk=0',
      file,
    ],
    signal,
    (line) => {
      const p = Object.fromEntries(
        line.split('|').map((v) => {
          const i = v.indexOf('=');
          return [v.slice(0, i), v.slice(i + 1)];
        }),
      );
      if (!indices.has(Number(p.stream_index))) return;
      if (!p.data_hash || !Number.isFinite(Number(p.pts_time)))
        throw new Error('This media has packets without verifiable presentation times.');
      packets.push({
        stream: Number(p.stream_index),
        pts: Number(p.pts_time),
        dts: Number(p.dts_time),
        duration: Number(p.duration_time),
        hash: p.data_hash,
        key: p.flags?.includes('K'),
      });
      if (packets.length > 2000000)
        throw new Error('This recording exceeds the current export verification limit.');
    },
  );
  return { streams, packets, chapters: facts.chapters || [] };
}
function tick(s: Stream) {
  const [a, b] = s.time_base.split('/').map(Number);
  return a / b;
}
function seekBoundary(audio: Packet[], firstVideo: Packet, enabled: boolean, videoTick: number) {
  if (!enabled) return 0;
  const crossing = audio.reduce<Packet | undefined>(
    (found, p) => (p.pts <= firstVideo.pts && p.pts + p.duration > firstVideo.pts ? p : found),
    undefined,
  );
  // FFmpeg rounds an output seek separately in each stream's clock. Align to
  // a video tick before seeking: a FLAC boundary between 60 Hz video ticks can
  // otherwise round past the retained keyframe in the packet filter.
  const boundary = Math.min(firstVideo.dts, crossing?.pts ?? firstVideo.dts);
  return Math.floor((boundary + 1e-9) / videoTick) * videoTick;
}
function verify(
  source: Media,
  output: Media,
  record: ExportRecord,
): Omit<ExportVerification, 'bytes' | 'sha256'> {
  const video = source.streams.find(
      (s) => s.codec_type === 'video' && !s.disposition?.attached_pic,
    )!,
    audio = source.streams.find(
      (s) => s.index === record.input.gameTrack && s.codec_type === 'audio',
    ),
    ov = output.streams.filter((s) => s.codec_type === 'video'),
    oa = output.streams.filter((s) => s.codec_type === 'audio');
  if (
    !audio ||
    ov.length !== 1 ||
    oa.length !== 1 ||
    ov[0].codec_name !== video.codec_name ||
    oa[0].codec_name !== audio.codec_name ||
    output.streams.some((s) => !['video', 'audio', 'data'].includes(s.codec_type))
  )
    throw new Error(
      'Export must contain the original video and exactly one original game-audio stream.',
    );
  const sv = source.packets.filter((p) => p.stream === video.index),
    av = output.packets.filter((p) => p.stream === ov[0].index);
  const start = sv.findIndex(
    (p) => p.key && Math.abs(p.pts - record.input.sourceStart - record.plan.planned.start) < 0.002,
  );
  const end =
    record.plan.planned.end >= record.input.duration - 0.00001
      ? sv.length
      : sv.findIndex(
          (p) =>
            p.key && Math.abs(p.pts - record.input.sourceStart - record.plan.planned.end) < 0.002,
        );
  const expected = sv.slice(start, end);
  if (
    start < 0 ||
    end <= start ||
    !av.length ||
    expected.length !== av.length ||
    expected.some((p, i) => p.hash !== av[i].hash)
  )
    throw new Error(
      'The copied video did not match the planned outward keyframe range. No finished output was published.',
    );
  const tolerance = Math.max(tick(video), tick(audio), tick(ov[0]), tick(oa[0])) * 2 + 0.000002;
  const shift = av[0].pts - expected[0].pts;
  let maxTimingError = 0;
  const timing = (s: Packet, o: Packet) => {
    const error = Math.max(
      Math.abs(o.pts - s.pts - shift),
      Number.isFinite(o.dts) && Number.isFinite(s.dts) ? Math.abs(o.dts - s.dts - shift) : 0,
    );
    maxTimingError = Math.max(maxTimingError, error);
    if (error > tolerance)
      throw new Error(
        'Export changed relative video/audio packet timing beyond the container time base.',
      );
  };
  expected.forEach((p, i) => timing(p, av[i]));
  const sa = source.packets.filter((p) => p.stream === audio.index),
    aa = output.packets.filter((p) => p.stream === oa[0].index);
  let previous = -1,
    first = -1;
  for (const p of aa) {
    const match =
      previous < 0
        ? sa.findIndex((s) => s.hash === p.hash && Math.abs(p.pts - s.pts - shift) <= tolerance)
        : previous + 1;
    if (
      match < 0 ||
      !sa[match] ||
      sa[match].hash !== p.hash ||
      Math.abs(p.pts - sa[match].pts - shift) > tolerance
    )
      throw new Error('Game audio contains changed or missing packets.');
    if (first < 0) first = match;
    timing(sa[match], p);
    previous = match;
  }
  if (expected.some((p) => !Number.isFinite(p.duration) || p.duration <= 0))
    throw new Error('Video packet duration is unavailable; this cut cannot be verified yet.');
  const videoEnd = expected.reduce((n, p) => Math.max(n, p.pts + p.duration), -Infinity);
  const hasSeek = record.plan.planned.start > 0.000001;
  const audioBegin = seekBoundary(sa, expected[0], hasSeek, tick(video));
  const expectedFirst = hasSeek ? sa.findIndex((p) => p.pts >= audioBegin - 0.000001) : 0;
  const expectedLast = sa.reduce((found, p, i) => (p.pts < videoEnd - 0.0000001 ? i : found), -1);
  if (!aa.length || first !== expectedFirst || previous !== expectedLast)
    throw new Error(
      'Game audio is missing original packets at the start or end of the copied video.',
    );
  const actual = {
    start: expected.reduce((n, p) => Math.min(n, p.pts), Infinity) - record.input.sourceStart,
    end: videoEnd - record.input.sourceStart,
  };
  if (
    actual.start > record.plan.requested.start + tolerance ||
    actual.end < record.plan.requested.end - tolerance
  )
    throw new Error('Verified output would omit part of the requested clip.');
  const presented = [...expected].sort((a, b) => a.pts - b.pts);
  const rate = (video.r_frame_rate || '').split('/').map(Number);
  const nominal =
    rate.length === 2 && rate[0] > 0 && rate[1] > 0 ? rate[1] / rate[0] : presented[0].duration;
  const frameDuration = (record.annotationVersion ?? 1) >= 4 ? nominal : presented[0].duration;
  const uniform = presented.every(
    (p, i) =>
      Math.abs(p.duration - frameDuration) <= tick(video) + 0.000002 &&
      ((record.annotationVersion ?? 1) < 4 ||
        Math.abs(p.pts - presented[0].pts - i * frameDuration) <= tick(video) + 0.000002) &&
      (!i || Math.abs(p.pts - presented[i - 1].pts - frameDuration) <= tick(video) + 0.000002),
  );
  return {
    actual,
    videoStart: av.reduce((n, p) => Math.min(n, p.pts), Infinity),
    timestampShift: shift,
    tolerance,
    maxTimingError,
    videoPackets: av.length,
    audioPackets: aa.length,
    videoCodec: video.codec_name,
    ...(uniform ? { constantFrameDuration: frameDuration } : {}),
    audioCodec: audio.codec_name,
  };
}
function escapeMetadata(s: string) {
  return s.replace(/([\\=;#\n])/g, '\\$1').replace(/\r/g, '');
}
function chapters(record: ExportRecord, v: Omit<ExportVerification, 'bytes' | 'sha256'>) {
  const markers = record.input.markers
    .filter((m) =>
      (record.annotationVersion ?? 1) >= 4
        ? markerIntersects(m, v.actual.start, v.actual.end)
        : m.time >= v.actual.start - 0.000001 && m.time < v.actual.end,
    )
    .sort((a, b) => a.time - b.time);
  let entries: { start: number; name: string; generated?: boolean }[] = markers.map((m) => ({
    start: Math.max(
      0,
      Math.round(
        ((m.end != null ? Math.max(m.time, v.actual.start) : m.time) +
          record.input.sourceStart +
          v.timestampShift) *
          1000000,
      ),
    ),
    name: m.name,
  }));
  // Chapters cannot express overlapping ranges or two identities at one start.
  // Keep every marker in the companion; a single chapter is only a navigation hint.
  if ((record.annotationVersion ?? 1) >= 4)
    entries = entries.filter(
      (entry, index) => index === 0 || entry.start !== entries[index - 1].start,
    );
  // QuickTime chapter tracks assign their first chapter to zero. A neutral
  // leading chapter prevents the first real annotation from being retimed.
  if (quickTime(record.plan.container) && entries.length && entries[0].start > 0)
    entries.unshift({ start: 0, name: 'Clip start', generated: true });
  return entries;
}
function metadataText(record: ExportRecord, v: Omit<ExportVerification, 'bytes' | 'sha256'>) {
  return (
    ';FFMETADATA1\n' +
    `title=${escapeMetadata(record.plan.name)}\n` +
    chapters(record, v)
      .map((m) => {
        return `[CHAPTER]\nTIMEBASE=1/1000000\nSTART=${m.start}\nEND=${m.start + 1000}\ntitle=${escapeMetadata(m.name)}\n`;
      })
      .join('')
  );
}
async function readable(
  file: string,
  v: Omit<ExportVerification, 'bytes' | 'sha256'>,
  tool: string,
  signal: AbortSignal,
) {
  for (const start of new Set([0, Math.max(0, v.videoStart + v.actual.end - v.actual.start - 1)]))
    await launchTool(
      tool,
      [
        '-v',
        'error',
        '-xerror',
        '-nostdin',
        '-ss',
        String(start),
        '-i',
        file,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0',
        '-t',
        '1',
        '-f',
        'null',
        '-',
      ],
      signal,
    );
}
async function exists(file: string) {
  return stat(file).then(
    () => true,
    (e) => {
      if (e.code === 'ENOENT') return false;
      throw e;
    },
  );
}
/** Hard-link publication is exclusive: existing user files are never replaced. */
async function publish(stage: string, file: string) {
  try {
    await link(stage, file);
  } catch (e) {
    throw new Error(
      (e as NodeJS.ErrnoException).code === 'EEXIST'
        ? 'A file appeared at this destination. Choose a different output name.'
        : 'This folder could not publish the output safely. Choose a local writable Windows folder.',
      { cause: e },
    );
  }
  await unlink(stage);
}
export async function exportClip(
  record: ExportRecord,
  tools: Tools,
  signal: AbortSignal,
  update: (record: ExportRecord, progress: number) => void,
  publicationGuard: () => Promise<void> = async () => {},
): Promise<ExportRecord> {
  const began = performance.now();
  record = {
    ...record,
    started: new Date().toISOString(),
    elapsedMs: 0,
    annotationVersion: record.annotationVersion ?? (record.verification ? 1 : 4),
  };
  const elapsedMs = () => Math.round(performance.now() - began);
  if (
    !record.output ||
    !record.metadata ||
    !record.cleanGameConfirmed ||
    record.input.gameTrack === record.input.micTrack
  )
    throw new Error('Confirm a separate, clean game-audio track before export.');
  const output = record.output,
    sidecar = record.metadata,
    directory = await realpath(path.dirname(output));
  if (path.resolve(output).toLowerCase() === path.resolve(record.input.sourceFile).toLowerCase())
    throw new Error('Choose a new output file, separate from the original.');
  if (!/^[a-f\d-]{36}$/i.test(record.plan.id)) throw new Error('Invalid export identity.');
  const suffix = `.vcut-${record.plan.id}`,
    raw = path.join(directory, suffix + '-raw.' + record.plan.container),
    final = path.join(directory, suffix + '.' + record.plan.container),
    metadata = path.join(directory, suffix + '.ffmeta'),
    json = path.join(directory, suffix + '.json'),
    lock = output + '.vcut-lock';
  let ownedLock = false;
  const report = (message: string, progress: number) => {
    record = {
      ...record,
      state: 'running',
      message,
      elapsedMs: elapsedMs(),
      updated: new Date().toISOString(),
    };
    update(record, progress);
  };
  try {
    // Recover only this export's dead-process lock. An unrelated or live writer
    // continues to reserve the destination.
    if (await exists(lock)) {
      const old = JSON.parse(await readFile(lock, 'utf8'));
      let alive = true;
      try {
        process.kill(old.pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
      }
      if (old.id === record.plan.id && !alive) await unlink(lock);
    }
    const handle = await open(lock, 'wx');
    ownedLock = true;
    await handle.writeFile(JSON.stringify({ id: record.plan.id, pid: process.pid }));
    await handle.close();
    // A dead process may have left only its private stages. The export identity
    // names them deterministically; the acquired lock excludes another writer.
    for (const file of [raw, final, metadata, json])
      await unlink(file).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
      });
    await publicationGuard();
    const sourceIdentity = await identify(record.input.sourceFile, record.plan.sourceId);
    if (
      sourceIdentity.fingerprint !== record.input.sourceFingerprint ||
      sourceIdentity.bytes !== record.input.sourceBytes ||
      sourceIdentity.modified !== record.input.sourceModified
    )
      throw new Error('Original recording changed. Make a new export plan after relinking.');
    const existingOutput = await exists(output),
      existingMetadata = await exists(sidecar);
    if (existingOutput || existingMetadata) {
      if (
        !record.verification ||
        !existingOutput ||
        (await fileHash(output, signal)) !== record.verification.sha256
      )
        throw new Error(
          'This destination already contains a file. Choose a different name; existing files will not be replaced.',
        );
      const content = annotation(record, record.verification);
      if (existingMetadata) {
        if ((await readFile(sidecar, 'utf8')) !== content)
          throw new Error(
            'The existing metadata differs from this export. Choose a new output name.',
          );
      } else {
        await writeFile(json, content, { flag: 'wx' });
        await publicationGuard();
        await publish(json, sidecar);
      }
      await setDate(output, record);
      await setDate(sidecar, record);
      signal.throwIfAborted();
      return {
        ...record,
        state: 'verified',
        elapsedMs: elapsedMs(),
        message: 'Verified video and metadata recovered.',
        updated: new Date().toISOString(),
      };
    }
    const free = await statfs(directory);
    const estimate =
      (record.input.sourceBytes * (record.plan.planned.end - record.plan.planned.start)) /
      record.input.duration;
    if (free.bavail * free.bsize < estimate * 3 + 256 * 1024 * 1024)
      throw new Error('The output drive needs space for two staged copies of this clip.');
    report('Checking original packets', 0.05);
    const source = await probe(record.input.sourceFile, tools.ffprobe, signal),
      video = source.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
    if (!video) throw new Error('Original video stream is unavailable.');
    const keys = source.packets.filter((p) => p.stream === video.index && p.key);
    const start = keys.find(
        (p) => Math.abs(p.pts - record.input.sourceStart - record.plan.planned.start) < 0.002,
      ),
      end = keys.find(
        (p) => Math.abs(p.pts - record.input.sourceStart - record.plan.planned.end) < 0.002,
      );
    if (
      !start ||
      (record.plan.planned.start > 0.000001 && !Number.isFinite(start.dts)) ||
      (record.plan.planned.end < record.input.duration - 0.00001 &&
        (!end || !Number.isFinite(end.dts)))
    )
      throw new Error('These keyframe decode boundaries cannot be copied reliably yet.');
    report('Copying original video and game audio', 0.25);
    const videoPackets = source.packets.filter((p) => p.stream === video.index),
      audioPackets = source.packets.filter((p) => p.stream === record.input.gameTrack);
    const startIndex = videoPackets.indexOf(start),
      endIndex =
        record.plan.planned.end >= record.input.duration - 0.00001
          ? videoPackets.length
          : videoPackets.indexOf(end!);
    const selectedPackets = videoPackets.slice(startIndex, endIndex);
    if (
      startIndex < 0 ||
      endIndex <= startIndex ||
      selectedPackets.some((p) => !Number.isFinite(p.duration) || p.duration <= 0)
    )
      throw new Error('This video range has no verifiable packet durations.');
    const videoEnd = selectedPackets.reduce((n, p) => Math.max(n, p.pts + p.duration), -Infinity);
    const hasSeek = record.plan.planned.start > 0.000001,
      seek = seekBoundary(audioPackets, start, hasSeek, tick(video));
    const args = ['-v', 'error', '-nostdin', '-copyts', '-i', record.input.sourceFile];
    if (hasSeek) args.push('-ss', String(seek));
    args.push('-to', String(videoEnd));
    // Output seeking rebases timestamps before bitstream filtering. Filter
    // video at decode boundaries while audio continues to the last presented
    // frame. amount=0 leaves every retained encoded packet unchanged.
    const discard: string[] = [];
    if (hasSeek) discard.push(`lt(dts*tb,${start.dts - seek - tick(video) / 4})`);
    if (endIndex < videoPackets.length)
      discard.push(`gte(dts*tb,${end!.dts - (hasSeek ? seek : 0) - tick(video) / 4})`);
    if (discard.length) args.push('-bsf:v', `noise=amount=0:drop='${discard.join('+')}'`);
    args.push(
      '-map',
      `0:${video.index}`,
      '-map',
      `0:${record.input.gameTrack}`,
      '-map_metadata',
      '0',
      '-map_chapters',
      '-1',
      '-c',
      'copy',
      '-copytb',
      '1',
      '-avoid_negative_ts',
      'make_zero',
      '-strict',
      '-2',
      '-n',
      raw,
    );
    if (quickTime(record.plan.container))
      args.splice(args.length - 1, 0, '-movie_timescale', '1000000');
    await launchTool(tools.ffmpeg, args, signal);
    report('Verifying copied packet timing', 0.5);
    const first = verify(source, await probe(raw, tools.ffprobe, signal), record);
    // Use one shared shift to start the video at zero. Audio packets crossing
    // the first frame remain preroll rather than introducing a blank lead-in.
    const intendedShift = first.timestampShift - first.videoStart;
    await writeFile(
      metadata,
      metadataText(record, { ...first, timestampShift: intendedShift, videoStart: 0 }),
      { flag: 'wx' },
    );
    const chapterArgs = [
      '-v',
      'error',
      '-nostdin',
      '-copyts',
      '-i',
      raw,
      '-f',
      'ffmetadata',
      '-i',
      metadata,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-map_metadata',
      '0',
      '-metadata',
      `title=${record.plan.name}`,
      '-map_chapters',
      '1',
      '-c',
      'copy',
      '-copytb',
      '1',
      '-avoid_negative_ts',
      'disabled',
      '-output_ts_offset',
      String(-first.videoStart),
      '-strict',
      '-2',
      '-n',
      ...(quickTime(record.plan.container) ? ['-movie_timescale', '1000000'] : []),
      final,
    ];
    await launchTool(tools.ffmpeg, chapterArgs, signal);
    report('Checking final video and audio', 0.7);
    const finalMedia = await probe(final, tools.ffprobe, signal),
      checked = verify(source, finalMedia, record);
    if (Math.abs(checked.timestampShift - intendedShift) > checked.tolerance)
      throw new Error('Adding chapters changed stream timing.');
    const expectedChapters = chapters(record, checked);
    if (
      expectedChapters.length !== finalMedia.chapters.length ||
      expectedChapters.some(
        (c, i) =>
          c.name !== finalMedia.chapters[i].tags?.title ||
          Math.abs(c.start / 1000000 - Number(finalMedia.chapters[i].start_time)) > 0.002,
      )
    )
      throw new Error('Embedded chapter names or timing did not survive this container.');
    await readable(final, checked, tools.ffmpeg, signal);
    const again = await identify(record.input.sourceFile, record.plan.sourceId);
    if (
      again.fingerprint !== sourceIdentity.fingerprint ||
      again.modified !== sourceIdentity.modified
    )
      throw new Error('Original recording changed during export.');
    const verification: ExportVerification = {
      ...checked,
      bytes: (await stat(final)).size,
      sha256: await fileHash(final, signal),
    };
    record = { ...record, verification };
    await writeFile(json, annotation(record, verification), { flag: 'wx' });
    await setDate(final, record);
    await setDate(json, record);
    // Persist the verified hash before either publication so retry can reconcile
    // an interruption between the two exclusive filesystem operations.
    report('Publishing verified video and metadata', 0.95);
    signal.throwIfAborted();
    await publicationGuard();
    await publish(final, output);
    signal.throwIfAborted();
    await publicationGuard();
    await publish(json, sidecar);
    return {
      ...record,
      state: 'verified',
      elapsedMs: elapsedMs(),
      message: 'Original video and game audio verified; metadata saved.',
      updated: new Date().toISOString(),
    };
  } finally {
    for (const file of [raw, final, metadata, json]) await unlink(file).catch(() => {});
    if (ownedLock) await unlink(lock).catch(() => {});
  }
}
async function setDate(file: string, record: ExportRecord) {
  const info = await stat(file);
  await utimes(
    file,
    info.atime,
    new Date(record.input.sourceModified + record.plan.requested.start * 1000),
  );
}
export function annotation(record: ExportRecord, v: ExportVerification) {
  const { input, plan } = record;
  return (
    JSON.stringify(
      {
        schema: 'virtual-cut-export',
        version: record.annotationVersion ?? 1,
        exportId: plan.id,
        created: plan.created,
        clip: input.clip,
        requested: plan.requested,
        planned: plan.planned,
        verified: v,
        source: {
          path: input.sourceFile,
          fingerprint: input.sourceFingerprint,
          bytes: input.sourceBytes,
          modified: new Date(input.sourceModified).toISOString(),
          videoStart: input.sourceStart,
          captureTime: input.captureTime,
        },
        audio: {
          sourceGameTrack: input.gameTrack,
          outputAudioTrack: 1,
          microphoneIncluded: false,
          cleanGameConfirmed: true,
        },
        context: input.context,
        ...((record.annotationVersion ?? 1) >= 3
          ? {
              generatedChapters: (
                (record.annotationVersion ?? 1) >= 4
                  ? chapters(record, v).some((chapter) => chapter.generated)
                  : chapters(record, v).length >
                    input.markers.filter((m) =>
                      (record.annotationVersion ?? 1) >= 4
                        ? markerIntersects(m, v.actual.start, v.actual.end)
                        : m.time >= v.actual.start - 0.000001 && m.time < v.actual.end,
                    ).length
              )
                ? [{ name: 'Clip start', containerTime: 0, purpose: 'quicktime-leading-anchor' }]
                : [],
            }
          : {}),
        markers: input.markers
          .filter((m) =>
            (record.annotationVersion ?? 1) >= 4
              ? markerIntersects(m, v.actual.start, v.actual.end)
              : m.time >= v.actual.start - 0.000001 && m.time < v.actual.end,
          )
          .map((m) => ({
            ...m,
            ...((record.annotationVersion ?? 1) >= 2
              ? { colorName: markerColorName(m), color: markerColor(m) }
              : { color: colors[m.category] }),
            sourceTime: m.time,
            clipTime: (m.end != null ? Math.max(m.time, v.actual.start) : m.time) - v.actual.start,
            containerTime:
              (m.end != null ? Math.max(m.time, v.actual.start) : m.time) +
              input.sourceStart +
              v.timestampShift,
            ...(m.end != null
              ? {
                  sourceEnd: m.end,
                  sourceDuration: m.end - m.time,
                  clipEnd: Math.min(m.end, v.actual.end) - v.actual.start,
                  containerEnd:
                    Math.min(m.end, v.actual.end) + input.sourceStart + v.timestampShift,
                  duration: Math.min(m.end, v.actual.end) - Math.max(m.time, v.actual.start),
                }
              : {}),
          })),
        // Optional and separately versioned, so helpers that read version 4 are unaffected (VC-154).
        ...(record.companionTranscripts?.items.length
          ? {
              transcripts: {
                schema: 'virtual-cut-transcript-history',
                version: 1,
                timing:
                  'sourceStart/sourceEnd: recording time; clipStart/clipEnd: this video from 0; containerStart/containerEnd: video timestamps.',
                items: record.companionTranscripts.items.map((h) =>
                  transcriptHandoff(
                    h.transcript,
                    h.segments,
                    { transcriptEdits: h.edits },
                    {
                      ...v.actual,
                      sourceStart: input.sourceStart,
                      timestampShift: v.timestampShift,
                      exportId: plan.id,
                      name: plan.name,
                    },
                  ),
                ),
              },
            }
          : {}),
        compatibility: {
          embedded: 'Chapter names and container timestamps',
          portable: 'All annotation fields in this file',
          resolve:
            'Manual import still requires review; automatic marker colors and notes are not verified.',
        },
        dateModifiedPolicy: 'Source Date modified + requested clip start',
      },
      null,
      2,
    ) + '\n'
  );
}

export async function verifyPublished(record: ExportRecord, signal?: AbortSignal) {
  if (!record.output || !record.metadata || !record.verification)
    throw new Error('This export has no verified output receipt.');
  for (const file of [record.output, record.metadata]) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Choose a regular exported file.');
    if (
      Math.abs(info.mtimeMs - (record.input.sourceModified + record.plan.requested.start * 1000)) >
      2
    )
      throw new Error('The exported Date modified did not match the source offset.');
  }
  if (
    (await stat(record.output)).size !== record.verification.bytes ||
    (await fileHash(record.output, signal)) !== record.verification.sha256
  )
    throw new Error('The finished video no longer matches its verified receipt.');
  if ((await readFile(record.metadata, 'utf8')) !== annotation(record, record.verification))
    throw new Error('The companion metadata no longer matches this export.');
  signal?.throwIfAborted();
}
