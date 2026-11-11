// Making a recording's playback proxy (VC-237).
//
// The proxy is an H.264 copy of the whole recording at 1080p or 720p, with no audio and no
// B-frames. It has a keyframe on every source keyframe, so a clip's proxy can later be cut
// losslessly at the same points as the clip (VC-239), and at least one every 0.5 s by time, so
// the viewer can drag and rewind it quickly. Frames map one to one to the original's frames.
//
// It is made in segments of about a minute, each starting on a source keyframe. A job that
// gives way to playback or other work keeps the segments it has made and carries on with the
// next one. When every segment is made they are joined without re-encoding, the joined file is
// checked packet by packet against the recording's frame index, and only then renamed from its
// `.partial.mp4` name to the proxy's name.

import { randomUUID } from 'node:crypto';
import { rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchTool } from './media-inspection.cjs';
import { proxyFormat, type ProxyHeight } from './proxy-record.js';

/** Footage per segment, in seconds; a segment always starts on a source keyframe. */
export const segmentSeconds = 60;

export interface ProxySegment {
  index: number;
  /** Index of the segment's first frame in the recording's frame index. */
  first: number;
  frames: number;
  /** Recording time of the first frame. */
  start: number;
  /** Frames (by index in the recording) that must be keyframes, the first one included. */
  keys: number[];
}

/** A frame's duration, from the frame index's median spacing (60 fps when it can't be told). */
export function frameStep(frameTimes: readonly number[]) {
  const gaps: number[] = [];
  for (let i = 1; i < frameTimes.length && gaps.length < 2000; i++)
    gaps.push(frameTimes[i] - frameTimes[i - 1]);
  gaps.sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1];
  return median > 0 && Number.isFinite(median) ? median : 1 / 60;
}

/** The first frame at or after a time (binary search over sorted times). */
function frameAt(times: readonly number[], t: number) {
  let lo = 0,
    hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The segments of a recording's proxy and the frames that must be keyframes: every source
 * keyframe, and the first frame at or after every multiple of `step` seconds of recording time.
 * Times are recording seconds (the frame index), sorted.
 */
export function proxyPlan(
  frameTimes: readonly number[],
  sourceKeys: readonly number[],
  step: number = proxyFormat.keyframeStep,
  target = segmentSeconds,
): ProxySegment[] {
  if (!frameTimes.length) throw new Error('The recording has no frame index. Inspect it again.');
  if (!sourceKeys.length) throw new Error('The recording has no keyframes in its frame index.');
  const tolerance = frameStep(frameTimes) / 4;
  const keyFrames = [...new Set(sourceKeys.map((t) => frameAt(frameTimes, t - tolerance)))]
    .filter((i) => i < frameTimes.length)
    .sort((a, b) => a - b);
  if (keyFrames[0] !== 0)
    throw new Error('The recording does not start on a keyframe, so a proxy cannot match it.');
  const wanted = new Set(keyFrames);
  const end = frameTimes[frameTimes.length - 1];
  for (let k = 1; k * step <= end + tolerance; k++) {
    const i = frameAt(frameTimes, k * step - tolerance);
    if (i < frameTimes.length) wanted.add(i);
  }
  const all = [...wanted].sort((a, b) => a - b);
  // Segments start on source keyframes about `target` seconds apart.
  const starts = [0];
  for (const i of keyFrames)
    if (frameTimes[i] - frameTimes[starts[starts.length - 1]] >= target) starts.push(i);
  return starts.map((first, index) => {
    const next = starts[index + 1] ?? frameTimes.length;
    return {
      index,
      first,
      frames: next - first,
      start: frameTimes[first],
      keys: all.filter((i) => i >= first && i < next),
    };
  });
}

/**
 * FFmpeg's forced keyframe times for a segment, relative to its first frame. Each sits a
 * quarter frame before its frame, so rounding never moves it onto the next one.
 */
export function forcedTimes(segment: ProxySegment, frameTimes: readonly number[]) {
  const quarter = frameStep(frameTimes) / 4;
  return segment.keys
    .filter((i) => i > segment.first)
    .map((i) => Math.max(0, frameTimes[i] - segment.start - quarter).toFixed(6));
}

export type ProxyDecode = 'gpu' | 'cpu';
export type ProxyEncode = 'nvenc' | 'x264';

export interface SegmentJob {
  file: string;
  /** The recording's first video timestamp (frame index times are relative to it). */
  offset: number;
  segment: ProxySegment;
  frameTimes: readonly number[];
  height: ProxyHeight;
  decode: ProxyDecode;
  /** NVDEC decoder for the recording's codec, for `decode: 'gpu'`. */
  gpuDecoder?: string;
  encode: ProxyEncode;
  out: string;
}

const encoders: Record<ProxyEncode, string[]> = {
  // VC-16: NVENC H.264 at CQ 23, high profile, no B-frames. Keyframes come only from the forced
  // list (the GOP limit is never reached), as IDR frames.
  nvenc: [
    '-c:v',
    'h264_nvenc',
    '-preset',
    'p4',
    '-profile:v',
    'high',
    '-rc',
    'vbr',
    '-cq',
    '23',
    '-b:v',
    '0',
    '-bf',
    '0',
    '-g',
    '100000',
    '-forced-idr',
    '1',
  ],
  // Without an NVIDIA encoder: the same stream from x264, without scene-cut keyframes.
  x264: [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-profile:v',
    'high',
    '-bf',
    '0',
    '-g',
    '100000',
    '-sc_threshold',
    '0',
    '-forced-idr',
    '1',
  ],
};

/** FFmpeg arguments that make one segment. */
export function segmentArgs(job: SegmentJob) {
  const { segment } = job;
  const gpu = job.decode === 'gpu' && !!job.gpuDecoder;
  const scale = gpu
    ? `scale_cuda=-2:${job.height}:format=nv12${job.encode === 'nvenc' ? '' : ',hwdownload,format=nv12'}`
    : `scale=-2:${job.height}:flags=bicubic,format=yuv420p`;
  // Seeking just before the segment's first frame keeps exactly that frame first; frames
  // before it are decoded from the previous keyframe and dropped.
  const seek = segment.first > 0 ? ['-ss', (job.offset + segment.start - 0.001).toFixed(6)] : [];
  const forced = forcedTimes(segment, job.frameTimes);
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-nostats',
    '-progress',
    'pipe:1',
    ...(gpu ? ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda', '-c:v', job.gpuDecoder!] : []),
    ...seek,
    '-i',
    job.file,
    '-map',
    '0:V:0',
    '-an',
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    '-frames:v',
    String(segment.frames),
    '-vf',
    scale,
    '-fps_mode',
    'passthrough',
    ...encoders[job.encode],
    ...(forced.length ? ['-force_key_frames', forced.join(',')] : []),
    '-f',
    'mp4',
    '-n',
    job.out,
  ];
}

/** Makes one segment, reporting frames made. Fails if it made a different number of frames. */
export async function makeSegment(
  ffmpeg: string,
  job: SegmentJob,
  signal: AbortSignal,
  frames: (made: number) => void,
) {
  await rm(job.out, { force: true });
  try {
    await launchTool(ffmpeg, segmentArgs(job), signal, (line) => {
      const m = /^frame=(\d+)/.exec(line);
      if (m) frames(Number(m[1]));
    });
  } catch (e) {
    await rm(job.out, { force: true }).catch(() => {});
    throw e;
  }
}

/** Joins the segments without re-encoding into `out`, ready for playback from the start. */
export async function joinSegments(
  ffmpeg: string,
  files: readonly string[],
  out: string,
  signal: AbortSignal,
) {
  const list = path.join(path.dirname(out), `${path.basename(out)}-${randomUUID()}.txt`);
  await writeFile(
    list,
    files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n',
  );
  await rm(out, { force: true });
  try {
    await launchTool(
      ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        list,
        '-map',
        '0:v:0',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        '-n',
        out,
      ],
      signal,
    );
  } catch (e) {
    await rm(out, { force: true }).catch(() => {});
    throw e;
  } finally {
    await rm(list, { force: true }).catch(() => {});
  }
}

export interface ProxyPacket {
  pts: number;
  key: boolean;
}

/** The proxy's stream facts and packets, read with FFprobe. */
export async function readProxy(ffprobe: string, file: string, signal: AbortSignal) {
  const info = JSON.parse(
    await launchTool(
      ffprobe,
      [
        '-v',
        'error',
        '-select_streams',
        'V:0',
        '-show_entries',
        'stream=codec_name,width,height:format=nb_streams',
        '-of',
        'json',
        file,
      ],
      signal,
    ),
  ) as {
    streams?: { codec_name?: string; width?: number; height?: number }[];
    format?: { nb_streams?: number };
  };
  const packets: ProxyPacket[] = [];
  await launchTool(
    ffprobe,
    [
      '-v',
      'error',
      '-select_streams',
      'V:0',
      '-show_entries',
      'packet=pts_time,flags',
      '-of',
      'csv=p=0',
      file,
    ],
    signal,
    (line) => {
      const [pts, flags] = line.split(',');
      if (pts && pts !== 'N/A') packets.push({ pts: Number(pts), key: !!flags?.includes('K') });
    },
  );
  packets.sort((a, b) => a.pts - b.pts);
  const stream = info.streams?.[0];
  return {
    codec: stream?.codec_name || '',
    width: Number(stream?.width) || 0,
    height: Number(stream?.height) || 0,
    streams: Number(info.format?.nb_streams) || 0,
    packets,
  };
}

/**
 * Why a proxy does not match its recording, or '' when it does: the same frames at the same
 * times (within a quarter frame), a keyframe on every source keyframe, no gap between keyframes
 * longer than `step` plus a frame, and the planned size and codec.
 */
export function proxyProblem(
  proxy: Awaited<ReturnType<typeof readProxy>>,
  frameTimes: readonly number[],
  plan: readonly ProxySegment[],
  sourceKeys: readonly number[],
  height: ProxyHeight,
  step: number = proxyFormat.keyframeStep,
) {
  if (proxy.codec !== proxyFormat.codec) return `The proxy is ${proxy.codec || 'unreadable'}.`;
  if (proxy.height !== height) return `The proxy is ${proxy.height} pixels high, not ${height}.`;
  if (proxy.streams !== 1) return 'The proxy has more than its picture.';
  const { packets } = proxy;
  if (packets.length !== frameTimes.length)
    return `The proxy has ${packets.length} frames; the recording has ${frameTimes.length}.`;
  const frame = frameStep(frameTimes);
  const shift = packets[0].pts - frameTimes[0];
  for (let i = 0; i < packets.length; i++)
    if (Math.abs(packets[i].pts - shift - frameTimes[i]) > frame / 4)
      return `Proxy frame ${i + 1} is at ${(packets[i].pts - shift).toFixed(3)} s; the recording's is at ${frameTimes[i].toFixed(3)} s.`;
  const tolerance = frame / 4;
  for (const t of sourceKeys) {
    const i = frameAt(frameTimes, t - tolerance);
    if (i < packets.length && !packets[i].key)
      return `The proxy has no keyframe at the source keyframe at ${t.toFixed(3)} s.`;
  }
  for (const segment of plan)
    for (const i of segment.keys)
      if (!packets[i].key)
        return `The proxy has no keyframe at ${frameTimes[i].toFixed(3)} s, where one was asked for.`;
  let last = 0;
  for (let i = 1; i < packets.length; i++) {
    if (!packets[i].key) continue;
    if (frameTimes[i] - frameTimes[last] > step + frame + tolerance)
      return `The proxy has ${(frameTimes[i] - frameTimes[last]).toFixed(2)} s between keyframes at ${frameTimes[last].toFixed(3)} s.`;
    last = i;
  }
  if (frameTimes[frameTimes.length - 1] - frameTimes[last] > step + frame + tolerance)
    return 'The proxy ends without a keyframe in its last half second.';
  return '';
}

/** Whether FFmpeg's NVIDIA H.264 encoder works on this PC (a tenth of a second of colour). */
export async function nvencWorks(ffmpeg: string, signal: AbortSignal) {
  try {
    await launchTool(
      ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=256x144:r=30:d=0.1',
        '-c:v',
        'h264_nvenc',
        '-f',
        'null',
        '-',
      ],
      AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    );
    return true;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}

/** Bytes a proxy is expected to need at most: busy footage at the spike's 0.5 s rate. */
export function proxyBytesEstimate(duration: number, height: ProxyHeight) {
  // 1080p at 0.5 s keyframes: about 2.4 GB per calm footage hour, up to about 5 on busy footage.
  const perSecond = height === 1080 ? 1_500_000 : 800_000;
  return Math.ceil(duration * perSecond);
}

/** Removes files, ignoring ones already gone. */
export async function removeFiles(files: Iterable<string>) {
  for (const file of files) await rm(file, { force: true }).catch(() => {});
}

export async function fileFacts(file: string) {
  const info = await stat(file);
  return { bytes: info.size, modified: info.mtimeMs };
}
