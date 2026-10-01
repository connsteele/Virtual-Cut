import { inspectMedia, launchTool, identify } from './media-inspection.cjs';
import type { Recording } from './workflow-types.js' with { 'resolution-mode': 'import' };

// Finished files are read only. The index and at most 2048 peak values stay in
// this session; no PCM, JPEG sequence or project-save payload is written.
export async function inspectRetainedOutput(
  file: string,
  id: string,
  probe: string,
  ffmpeg: string,
  signal: AbortSignal,
) {
  const source = await identify(file, id);
  const media = await inspectMedia(file, id, probe, signal, () => {});
  const track = media.audioTracks[0];
  if (track) {
    const peaks: number[] = [];
    const samples = Math.max(1, Math.ceil((media.duration * 8000) / 2048));
    await launchTool(
      ffmpeg,
      [
        '-v',
        'error',
        '-nostdin',
        '-threads',
        '1',
        '-i',
        file,
        '-map',
        `0:${track.index}`,
        '-vn',
        '-sn',
        '-dn',
        '-af',
        `atrim=duration=${media.duration},aresample=8000,asetnsamples=n=${samples}:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.Peak_level:file=-`,
        '-f',
        'null',
        '-',
      ],
      signal,
      (line) => {
        const prefix = 'lavfi.astats.Overall.Peak_level=';
        if (!line.startsWith(prefix)) return;
        if (peaks.length >= 2049)
          throw new Error('Completed audio exceeded its inspected duration.');
        const db = Number(line.slice(prefix.length));
        peaks.push(Number.isFinite(db) ? Math.min(1, 10 ** (db / 20)) : 0);
      },
    );
    track.waveform = { peaks, duration: (peaks.length * samples) / 8000 };
  }
  const after = await identify(file, id);
  if (source.fingerprint !== after.fingerprint || source.modified !== after.modified)
    throw new Error('The completed file changed while preparing its preview.');
  const recording: Recording = {
    id,
    title: '',
    url: '',
    poster: '',
    frames: [],
    base: 0,
    position: 0,
    sample: false,
    fullResolution: true,
    retained: true,
    context: '',
    availability: 'ready',
    sourcePath: source.file,
    sourceModified: source.modified,
    ...media,
    gameTrack: track?.index ?? null,
    micTrack: null,
    monitor: 'game',
  };
  return { source, recording };
}
