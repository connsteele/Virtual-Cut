import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { AudioTrack, Marker } from './workflow-types.js' with { 'resolution-mode': 'import' };
import type { NativeSource } from './project-store.cjs';

export async function identify(file: string, id: string): Promise<NativeSource> {
  const resolved = await realpath(file),
    before = await stat(resolved);
  if (!before.isFile() || before.size < 1)
    throw new Error('Choose a completed, non-empty recording.');
  const handle = await open(resolved, 'r');
  const hash = createHash('sha256').update(String(before.size));
  try {
    const block = Buffer.alloc(Math.min(1024 * 1024, before.size));
    for (const position of new Set([
      0,
      Math.max(0, Math.floor(before.size / 2) - block.length / 2),
      Math.max(0, before.size - block.length),
    ])) {
      const { bytesRead } = await handle.read(block, 0, block.length, Math.floor(position));
      hash.update(block.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error('The recording is still changing. Finish recording, then retry.');
  } finally {
    await handle.close();
  }
  return {
    id,
    file: resolved,
    bytes: before.size,
    modified: before.mtimeMs,
    fingerprint: hash.digest('hex'),
  };
}
export function launchTool(
  tool: string,
  args: string[],
  signal: AbortSignal,
  onLine?: (line: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Cancelled'));
      return;
    }
    const worker: ChildProcess = spawn(
      process.execPath,
      [path.join(__dirname, 'media-worker.cjs'), JSON.stringify({ tool, args })],
      {
        windowsHide: true,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          ...(process.env.VIRTUAL_CUT_MEDIA_TEMP
            ? { TEMP: process.env.VIRTUAL_CUT_MEDIA_TEMP, TMP: process.env.VIRTUAL_CUT_MEDIA_TEMP }
            : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    let output = '',
      error = '',
      pending = '',
      tooLarge = false;
    let parseError: Error | undefined;
    const readLine = (line: string) => {
      try {
        onLine?.(line);
      } catch (e) {
        parseError = e instanceof Error ? e : new Error(String(e));
        cancel();
      }
    };
    const cancel = () => {
      if (worker.connected) worker.send({ cancel: true });
    };
    signal.addEventListener('abort', cancel);
    const timeout = setTimeout(cancel, 30 * 60 * 1000);
    worker.stdout!.on('data', (data: Buffer) => {
      if (onLine) {
        pending += data.toString();
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        for (const line of lines) {
          if (parseError) break;
          readLine(line);
        }
      } else {
        output += data.toString();
        if (output.length > 16 * 1024 * 1024) {
          tooLarge = true;
          cancel();
        }
      }
    });
    worker.stderr!.on('data', (data: Buffer) => {
      error = (error + data.toString()).slice(-8000);
    });
    worker.on('error', reject);
    worker.on('close', (code) => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      if (onLine && pending && !parseError) readLine(pending);
      if (signal.aborted) reject(new Error('Cancelled'));
      else if (parseError) reject(parseError);
      else if (tooLarge)
        reject(new Error('Media-tool response exceeded the supported inspection size.'));
      else if (code !== 0)
        reject(
          new Error(
            error.trim() || 'Media tool did not complete. Check FFmpeg/FFprobe availability.',
          ),
        );
      else resolve(output);
    });
  });
}
interface Stream {
  index: number;
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  time_base?: string;
  start_time?: string;
  duration?: string;
  channels?: number;
  tags?: Record<string, string>;
  disposition?: { attached_pic?: number };
}
export async function inspectMedia(
  file: string,
  id: string,
  probe: string,
  signal: AbortSignal,
  progress: (n: number) => void,
) {
  const data = JSON.parse(
    await launchTool(
      probe,
      ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', file],
      signal,
    ),
  ) as {
    streams: Stream[];
    format: { duration?: string; tags?: Record<string, string> };
    chapters?: { start_time: string; tags?: Record<string, string> }[];
  };
  const video = data.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw new Error('This file has no usable video stream.');
  let duration = Number(video.duration || data.format.duration);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error('Duration could not be inspected. The recording may be incomplete.');
  const sourceStart = Number(video.start_time || 0);
  const fraction = (s = '0/1') => {
    const [a, b = 1] = s.split('/').map(Number);
    return b ? a / b : 0;
  };
  const keys: number[] = [],
    frameTimes: number[] = [];
  let packetEnd = 0;
  progress(0.1);
  await launchTool(
    probe,
    [
      '-v',
      'error',
      '-select_streams',
      String(video.index),
      '-show_packets',
      '-show_entries',
      'packet=pts_time,duration_time,flags',
      '-of',
      'csv=p=0',
      file,
    ],
    signal,
    (line) => {
      const values = line.split(',');
      const pts = Number(values[0]) - sourceStart;
      if (Number.isFinite(pts) && pts >= -0.000001 && pts <= duration) {
        if (frameTimes.length >= 2_000_000)
          throw new Error('Recording has too many frames for this index.');
        frameTimes.push(Math.max(0, pts));
        const frameDuration =
          Number(values[1]) ||
          1 / (fraction(video.avg_frame_rate) || fraction(video.r_frame_rate) || 30);
        packetEnd = Math.max(packetEnd, pts + frameDuration);
        if (values.some((v) => v.includes('K'))) keys.push(Math.max(0, pts));
        if (frameTimes.length % 1000 === 0)
          progress(Math.min(0.94, 0.1 + (Math.max(0, pts) / duration) * 0.84));
      }
    },
  );
  if (packetEnd > 0) duration = Math.round(packetEnd * 1e6) / 1e6;
  const audioTracks: AudioTrack[] = data.streams
    .filter((s) => s.codec_type === 'audio')
    .map((s) => ({
      index: s.index,
      codec: s.codec_name || 'Unknown',
      channels: s.channels || 0,
      title: s.tags?.title || '',
      language: s.tags?.language || '',
      offset: Number(s.start_time || 0) - sourceStart,
      duration: s.duration ? Number(s.duration) : undefined,
    }));
  const chapterSource = (data.chapters || []).map((c, i) => ({
    id: `${id}-chapter-${i}`,
    start: Number(c.start_time),
    name: c.tags?.title || `Marker ${i + 1}`,
  }));
  const markers: Marker[] = chapterSource
    .map((c) => ({
      id: c.id,
      time: c.start - sourceStart,
      name: c.name,
      category: 'Context' as const,
      color: 'Blue' as const,
      topic: '',
    }))
    .filter((m) => Number.isFinite(m.time) && m.time >= 0 && m.time <= duration);
  return {
    duration,
    sourceStart,
    chapterSource,
    timeBase: video.time_base,
    fps: fraction(video.avg_frame_rate) || fraction(video.r_frame_rate) || undefined,
    width: video.width,
    height: video.height,
    codec: video.codec_name,
    keys: [...new Set(keys)].sort((a, b) => a - b),
    frameTimes: [...new Set(frameTimes)].sort((a, b) => a - b),
    audioTracks,
    markers,
    captureTime: data.format.tags?.creation_time || video.tags?.creation_time,
  };
}
