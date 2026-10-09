import { createHash } from 'node:crypto';
import { launchTool } from './media-inspection.cjs';

// Audio Chromium plays as stored inside MP4. These track copies keep the original
// packets; anything else (ALAC, PCM) becomes FLAC at the source's own rate and depth.
const playable = new Set(['aac', 'mp3', 'opus', 'flac', 'vorbis']);
export const playableAudio = (codec?: string) => playable.has((codec || '').toLowerCase());

/**
 * FFmpeg arguments for one track copy that starts at zero on the track's own clock.
 * `shift` is the container start minus the track start, in seconds.
 */
export function audioCopyArgs(file: string, index: number, codec: string, shift: number) {
  return playableAudio(codec)
    ? // Packets are copied; only the timeline moves. Encoder priming stays in place.
      ['-itsoffset', String(shift), '-i', file, '-map', `0:${index}`, '-vn', '-c:a', 'copy']
    : [
        '-i',
        file,
        '-map',
        `0:${index}`,
        '-vn',
        '-af',
        'asetpts=PTS-STARTPTS',
        // FFmpeg keeps the decoded sample rate and bit depth (16 stays 16, 24 stays 24).
        '-c:a',
        'flac',
      ];
}

/** MD5 of a stream's decoded samples, the same for the original and a lossless copy. */
export async function decodedAudioHash(
  ffmpeg: string,
  file: string,
  index: number,
  signal: AbortSignal,
) {
  const out = await launchTool(
    ffmpeg,
    [
      '-v',
      'error',
      '-nostdin',
      '-i',
      file,
      '-map',
      `0:${index}`,
      '-c:a',
      'pcm_s32le',
      '-f',
      'md5',
      '-',
    ],
    signal,
  );
  const hash = /MD5=([a-f\d]{32})/.exec(out)?.[1];
  if (!hash) throw new Error('Audio could not be decoded for verification.');
  return hash;
}

/** SHA-256 over a stream's packet payloads, the same for the original and a remuxed copy. */
export async function packetHash(
  ffprobe: string,
  file: string,
  index: number,
  signal: AbortSignal,
) {
  const hash = createHash('sha256');
  let packets = 0;
  await launchTool(
    ffprobe,
    [
      '-v',
      'error',
      '-select_streams',
      String(index),
      '-show_entries',
      'packet=data_hash',
      '-show_data_hash',
      'sha256',
      '-of',
      'csv=p=0',
      file,
    ],
    signal,
    (line) => {
      // Only the payload hash: containers may add per-packet side data fields.
      const data = /SHA256:([a-f\d]{64})/.exec(line)?.[1];
      if (!data) return;
      hash.update(data);
      packets++;
    },
  );
  if (!packets) throw new Error('Audio could not be read for verification.');
  return hash.digest('hex');
}
