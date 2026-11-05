import { nativeImage } from 'electron';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { filmstripFile, readTileFile } from './filmstrip.cjs';
import type { NativeSource, ProjectStore } from './project-store.cjs';
import {
  LookError,
  burnTime,
  clock,
  nearDuplicate,
  pictureHash,
  planLook,
  type LookMoment,
  type LookRecording,
  type PlannedImage,
} from './look-plan.js';

/**
 * The look tool's pictures (VC-172, decision 0022): decoded into memory with FFmpeg on the CPU
 * at normal priority, sent as JPEG image blocks and never written anywhere. Strip tiles come
 * from the recording's filmstrip tile file (decision 0013) when it holds the keyframe.
 */
export interface LookInput {
  recording_id: string;
  moments: LookMoment[];
}
type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface LookResult {
  content: Content[];
  images: number;
  imageTokens: number;
  elapsedMs: number;
  /** Per picture: how it was made and how long it took, for checks and timing notes. */
  made: { kind: PlannedImage['kind']; from: 'tile file' | 'keyframe' | 'frame'; ms: number }[];
}

/** Decodes at most this many pictures at once. */
const DECODERS = 3;
const QUALITY = { tile: 80, frame: 85, crop: 90 } as const;

/** What look needs from the open project. */
export function lookRecording(store: ProjectStore, recordingId: string) {
  const r = store.data.model.recordings.find(
    (x) => x.id === recordingId && !x.sample && !x.retained,
  );
  if (!r) throw new LookError(`No recording with id "${recordingId}". Call get_project_summary.`);
  const source = store.sources().find((s) => s.id === recordingId);
  if (!source || r.availability === 'missing' || r.availability === 'failed' || !r.width)
    throw new LookError(
      `"${r.title}" is not available to show right now (${r.availability || 'not inspected'}).`,
    );
  if (r.availability && r.availability !== 'ready')
    throw new LookError(`"${r.title}" is not ready to show (${r.availability}).`);
  const index = store.frameIndex(recordingId);
  const text = store.screenText(recordingId);
  const recording: LookRecording = {
    title: r.title,
    duration: r.duration,
    width: r.width,
    height: r.height || 0,
    keys: index?.keys || [],
    frameTimes: index?.frameTimes || [],
    ...(text ? { screenTextFrame: { width: text.width, height: text.height } } : {}),
  };
  return {
    recording,
    source,
    offset: r.sourceStart || 0,
    tileFile: filmstripFile(store.data.project.cache, source),
  };
}

export async function look(
  ffmpeg: string,
  target: ReturnType<typeof lookRecording>,
  input: LookInput,
): Promise<LookResult> {
  const began = performance.now();
  const { recording, source, offset } = target;
  const plan = planLook(recording, input.moments);
  await unchanged(source);
  const tiles = plan.images.some((i) => i.kind === 'tile' && i.keyframe)
    ? await readTileFile(target.tileFile, source, offset).catch(() => null)
    : null;
  const tileSet = tiles && tiles !== 'stale' ? tiles : undefined;
  const made: LookResult['made'] = [];
  type Rendered = { bgra: Buffer; width: number; height: number; at: number; hash: Uint8Array };
  const rendered: (Rendered | Error)[] = [];
  let next = 0;
  const work = async () => {
    for (let n = next++; n < plan.images.length; n = next++) {
      const image = plan.images[n];
      const start = performance.now();
      try {
        let from: LookResult['made'][number]['from'] = image.keyframe ? 'keyframe' : 'frame';
        let picture: { bgra: Buffer; width: number; height: number; at: number } | undefined;
        if (image.keyframe && tileSet) {
          const k = nearest(tileSet.times, image.at);
          if (k >= 0 && Math.abs(tileSet.times[k] - image.at) <= 0.002) {
            const tile = nativeImage.createFromBuffer(Buffer.from(tileSet.tiles[k]));
            const size = tile.getSize();
            if (size.width > 0) {
              picture = { bgra: tile.toBitmap(), ...size, at: tileSet.times[k] };
              from = 'tile file';
            }
          }
        }
        picture ??= await decode(ffmpeg, source.file, offset, image);
        // Hashed before the time is burned in, so a frozen picture matches across times.
        const hash = pictureHash(picture.bgra, picture.width, picture.height);
        if (image.kind === 'tile')
          burnTime(picture.bgra, picture.width, picture.height, clock(picture.at));
        rendered[n] = { ...picture, hash };
        made[n] = { kind: image.kind, from, ms: Math.round(performance.now() - start) };
      } catch (e) {
        rendered[n] = e as Error;
        made[n] = { kind: image.kind, from: 'frame', ms: Math.round(performance.now() - start) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DECODERS, plan.images.length) }, work));
  await unchanged(source);

  // Near-duplicates of a picture already in this call, of the same kind and size, are dropped.
  const kept: { hash: Uint8Array; image: PlannedImage; number: number }[] = [];
  const pictures: Content[] = [];
  const dropped: string[] = [];
  const failed: string[] = [];
  let tokens = 0;
  plan.images.forEach((image, n) => {
    const picture = rendered[n];
    const name = describe(recording.title, image, picture instanceof Error ? undefined : picture);
    if (picture instanceof Error) {
      failed.push(`${name}: ${picture.message}`);
      return;
    }
    const hash = picture.hash;
    const same = kept.find(
      (k) =>
        k.image.kind === image.kind &&
        k.image.width === image.width &&
        k.image.height === image.height &&
        JSON.stringify(k.image.crop) === JSON.stringify(image.crop) &&
        nearDuplicate(k.hash, hash),
    );
    if (same) {
      dropped.push(`${name} (same picture as ${same.number})`);
      return;
    }
    const number = kept.length + 1;
    kept.push({ hash, image, number });
    tokens += image.tokens;
    const jpeg = nativeImage
      .createFromBitmap(picture.bgra, { width: picture.width, height: picture.height })
      .toJPEG(QUALITY[image.kind]);
    pictures.push(
      { type: 'text', text: `${number}. ${name}` },
      { type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' },
    );
  });
  if (!kept.length)
    throw new LookError(
      `Virtual Cut could not make these pictures${failed.length ? `: ${failed[0]}` : '.'}`,
    );
  const head = [
    `Look at "${recording.title}": ${kept.length} picture${kept.length === 1 ? '' : 's'}, about ` +
      `${tokens.toLocaleString('en-US')} image tokens. Times are recording seconds; each picture ` +
      'follows its line.',
    ...plan.notes,
    ...(dropped.length
      ? [`Not sent, nearly the same as an earlier picture: ${dropped.join('; ')}.`]
      : []),
    ...(failed.length ? [`Could not be made: ${failed.join('; ')}.`] : []),
  ]
    .join('\n')
    .slice(0, 20_000);
  return {
    content: [{ type: 'text', text: head }, ...pictures],
    images: kept.length,
    imageTokens: tokens,
    elapsedMs: Math.round(performance.now() - began),
    made,
  };
}

function describe(
  title: string,
  image: PlannedImage,
  picture?: { width: number; height: number; at: number },
) {
  const at = picture?.at ?? image.at;
  const when = `${clock(at)} (${at.toFixed(3)} s)`;
  const size = `${picture?.width ?? image.width}x${picture?.height ?? image.height}`;
  if (image.kind === 'tile')
    return (
      `Strip tile ${image.tile!.index}/${image.tile!.of} of "${title}" at ${when}, ` +
      `${image.keyframe ? 'nearest keyframe' : 'exact frame'}, ${size}`
    );
  if (image.kind === 'frame') return `Frame of "${title}" at ${when}, ${image.size} ${size}`;
  const c = image.crop!;
  return (
    `Crop of "${title}" at ${when}: x ${c.x}-${c.x + c.width}, y ${c.y}-${c.y + c.height} of ` +
    `the recording's frame, ${image.scaled ? `scaled to ${size}` : `full detail ${size}`}`
  );
}

function nearest(times: number[], at: number) {
  let best = -1;
  for (let i = 0; i < times.length; i++)
    if (best < 0 || Math.abs(times[i] - at) < Math.abs(times[best] - at)) best = i;
  return best;
}

async function unchanged(source: NativeSource) {
  const info = await stat(source.file).catch(() => null);
  if (!info || info.size !== source.bytes || info.mtimeMs !== source.modified)
    throw new LookError(
      'This recording changed or moved since Virtual Cut read it. Ask the user to relink or inspect it again.',
    );
}

/**
 * One picture as raw BGRA. Exact frames seek accurately; keyframe tiles decode only keyframes,
 * like the filmstrip. Both on the CPU (no hardware decoder) at normal priority, Lanczos scaling.
 */
export function decode(
  tool: string,
  file: string,
  offset: number,
  image: Pick<PlannedImage, 'at' | 'keyframe' | 'width' | 'height' | 'crop'>,
  timeoutMs = 30_000,
) {
  return new Promise<{ bgra: Buffer; width: number; height: number; at: number }>(
    (resolve, reject) => {
      const from = image.at + offset - (image.keyframe ? 0.00001 : 0.0005);
      const crop = image.crop
        ? `crop=${image.crop.width}:${image.crop.height}:${image.crop.x}:${image.crop.y},`
        : '';
      const args = [
        '-hide_banner',
        '-loglevel',
        'info',
        '-nostdin',
        '-copyts',
        '-threads',
        image.keyframe ? '2' : '0',
        ...(image.keyframe ? ['-skip_frame', 'nokey', '-noaccurate_seek'] : []),
        '-seek_timestamp',
        '1',
        '-ss',
        String(Math.max(0, from)),
        '-i',
        file,
        '-map',
        '0:V:0',
        '-an',
        '-sn',
        '-dn',
        '-frames:v',
        '1',
        '-vf',
        `select=gte(t\\,${from}),showinfo,${crop}scale=${image.width}:${image.height}:flags=lanczos,format=bgra`,
        '-fps_mode',
        'passthrough',
        '-f',
        'rawvideo',
        'pipe:1',
      ];
      const child = spawn(tool, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const expected = image.width * image.height * 4;
      const chunks: Buffer[] = [];
      let size = 0,
        log = '',
        failure = '';
      const timer = setTimeout(() => {
        failure = 'decoding took too long';
        child.kill();
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > expected) {
          failure = 'the decoder sent more than one picture';
          child.kill();
        } else chunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        log = (log + chunk.toString()).slice(-32000);
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const base = /config in time_base:\s*(\d+)\/(\d+)/.exec(log);
        const frame = /n:\s*0\s+pts:\s*(-?\d+)/.exec(log);
        const at =
          base && frame ? (Number(frame[1]) * Number(base[1])) / Number(base[2]) - offset : NaN;
        if (failure) reject(new Error(failure));
        else if (code !== 0 || size !== expected)
          reject(new Error(`no picture at ${clock(image.at)}`));
        else if (!Number.isFinite(at) || Math.abs(at - image.at) > (image.keyframe ? 0.002 : 0.05))
          reject(new Error(`the picture at ${clock(image.at)} could not be matched to its time`));
        else resolve({ bgra: Buffer.concat(chunks), width: image.width, height: image.height, at });
      });
    },
  );
}
