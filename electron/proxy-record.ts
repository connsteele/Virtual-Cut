// The proxy record on a recording (Sprint 15 shared commit, used by VC-237 and VC-238).
//
// A proxy is an optional H.264 playback copy of a whole recording, kept in the project's cache
// folder. The project keeps one record per recording on its native source: which file, what it
// was made from and the size and time it had when it was verified. Everything the windows see
// (none, making, ready, missing) is worked out from that record, the file on disk and the
// recording's proxy job, so a deleted or replaced file never shows as ready.
//
// Lane A (VC-237) makes proxies and writes the record; lane D (VC-238) plays the ready ones.
// Exports always copy the original.

/** Proxy heights a project can choose: 1080p by default, 720p as a project option. */
export const proxyHeights = [1080, 720] as const;
export type ProxyHeight = (typeof proxyHeights)[number];

/** The proxy format agreed for VC-16: H.264, a keyframe every 0.5 s by time plus every source
 * keyframe, no B-frames, no audio. */
export const proxyFormat = { codec: 'h264', keyframeStep: 0.5 } as const;

/** What the project stores on a recording's native source once a proxy is verified. */
export interface NativeProxy {
  /** File name inside the project's cache folder (never a path). */
  file: string;
  height: ProxyHeight;
  width: number;
  codec: typeof proxyFormat.codec;
  /** Seconds between forced keyframes; source keyframes are added on top. */
  keyframeStep: number;
  /** The recording fingerprint the proxy was made from. */
  fingerprint: string;
  /** Size and modification time of the proxy file when it was verified. */
  bytes: number;
  modified: number;
  /** ISO time the proxy was verified. */
  made: string;
}

/**
 * none: no proxy and none being made. making: a proxy job is queued or running.
 * ready: the verified file is on disk unchanged. missing: there is a record, but the file is
 * gone or changed, or it was made from a different revision of the recording.
 */
export type ProxyState = 'none' | 'making' | 'ready' | 'missing';

/** What the windows see on a recording; worked out in each snapshot, never saved. */
export interface RecordingProxy {
  state: ProxyState;
  height?: ProxyHeight;
  width?: number;
  codec?: string;
  /** 0..1 while making. */
  progress?: number;
  /** Playback address of a ready proxy. */
  url?: string;
}

/** The cache file name for a recording's proxy, unique per recording revision and height. */
export function proxyFileName(sourceId: string, fingerprint: string, height: ProxyHeight) {
  return `${sourceId}-${fingerprint}-proxy-${height}p.mp4`;
}

/** Proxy files (and their partial files while being made) in the cache folder. */
export const proxyFilePattern = /-proxy-(?:1080|720)p(?:\.partial)?\.mp4$/i;

export function isProxyHeight(value: unknown): value is ProxyHeight {
  return proxyHeights.includes(value as ProxyHeight);
}

/** A stored record is used only when every field is well formed. */
export function isNativeProxy(value: unknown): value is NativeProxy {
  const p = value as NativeProxy;
  return (
    !!p &&
    typeof p === 'object' &&
    typeof p.file === 'string' &&
    p.file.length > 0 &&
    p.file.length <= 300 &&
    !/[\\/]/.test(p.file) &&
    proxyFilePattern.test(p.file) &&
    !p.file.toLowerCase().endsWith('.partial.mp4') &&
    isProxyHeight(p.height) &&
    Number.isSafeInteger(p.width) &&
    p.width > 0 &&
    p.codec === proxyFormat.codec &&
    Number.isFinite(p.keyframeStep) &&
    p.keyframeStep > 0 &&
    typeof p.fingerprint === 'string' &&
    p.fingerprint.length > 0 &&
    Number.isSafeInteger(p.bytes) &&
    p.bytes > 0 &&
    Number.isFinite(p.modified) &&
    typeof p.made === 'string'
  );
}

/**
 * The state the windows show. `file` is the proxy file's size and time on disk, or null when it
 * could not be read; `job` is the recording's queued or running proxy job, if any.
 */
export function proxyState(
  record: unknown,
  fingerprint: string | undefined,
  file: { size: number; mtimeMs: number } | null,
  job?: { progress: number },
): RecordingProxy {
  if (job)
    return {
      state: 'making',
      progress: Math.max(0, Math.min(1, Number.isFinite(job.progress) ? job.progress : 0)),
    };
  if (record == null) return { state: 'none' };
  if (!isNativeProxy(record)) return { state: 'missing' };
  const format = { height: record.height, width: record.width, codec: record.codec };
  const unchanged =
    !!file &&
    !!fingerprint &&
    record.fingerprint === fingerprint &&
    file.size === record.bytes &&
    file.mtimeMs === record.modified;
  return { state: unchanged ? 'ready' : 'missing', ...format };
}
