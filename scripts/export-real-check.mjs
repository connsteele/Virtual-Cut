import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  { identify, inspectMedia } = require('../dist-electron/media-inspection.cjs'),
  { exportClip, fileHash } = require('../dist-electron/clip-export.cjs');
const root = 'G:/GPT/Work/virtual-cut/m2';
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'av1-flac-'));
// This is the disposable full-resolution demo copy, never the I: original.
const file = 'G:/GPT/Work/virtual-cut/full-resolution-demo/videos/r4.mp4',
  signal = new AbortController().signal;
const id = randomUUID(),
  source = await identify(file, id),
  hash = await fileHash(file),
  info = await inspectMedia(file, id, 'ffprobe', signal, () => {});
const clip = {
  id: randomUUID(),
  rid: id,
  name: 'Cai — Blaze Arts M2 proof',
  start: 2.2,
  end: 10.2,
  folder: 'Mechanics/Blaze Arts',
  include: true,
  note: 'Original AV1 video / FLAC game audio',
};
const created = new Date().toISOString(),
  plan = {
    id: randomUUID(),
    clipId: clip.id,
    sourceId: id,
    name: clip.name,
    sourceName: 'Demo copy r4',
    gameTrack: info.audioTracks[0].index,
    container: 'mp4',
    requested: { start: clip.start, end: clip.end },
    planned: {
      start: info.keys.filter((t) => t <= clip.start).at(-1),
      end: info.keys.find((t) => t >= clip.end) || info.duration,
    },
    revision: 0,
    created,
  };
const output = path.join(dir, 'Cai Blaze Arts.mp4');
const record = {
  plan,
  input: {
    clip,
    markers: [
      {
        id: randomUUID(),
        time: clip.start,
        name: 'Cai → Leda',
        category: 'Character',
        topic: 'Cai',
        note: 'Multiline\n日本語',
      },
      {
        id: randomUUID(),
        time: 5,
        name: 'Blaze Arts',
        category: 'Mechanic',
        topic: 'Blaze Arts',
        note: 'Game-only export proof',
      },
    ],
    context: 'Disposable footage for Resolve import review',
    gameTrack: info.audioTracks[0].index,
    micTrack: info.audioTracks[1]?.index ?? null,
    sourceFile: source.file,
    sourceFingerprint: source.fingerprint,
    sourceBytes: source.bytes,
    sourceModified: source.modified,
    sourceStart: info.sourceStart,
    duration: info.duration,
    captureTime: info.captureTime,
  },
  inputHash: 'fixture',
  state: 'queued',
  output,
  metadata: output + '.vcut.json',
  cleanGameConfirmed: true,
  message: 'Fixture',
  updated: created,
};
const done = await exportClip(record, { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, signal, (r, p) =>
  console.log(Math.round(p * 100) + '% ' + r.message),
);
assert.equal(done.state, 'verified');
assert.equal(done.verification.videoCodec, 'av1');
assert.equal(done.verification.audioCodec, 'flac');
assert.equal(await fileHash(file), hash);
assert.equal(JSON.parse(await readFile(done.metadata, 'utf8')).markers.length, 2);
await writeFile(path.join(dir, 'record.json'), JSON.stringify(done, null, 2));
console.log(JSON.stringify({ dir, output, verified: done.verification }));
const mkv = {
  ...record,
  plan: { ...plan, id: randomUUID(), container: 'mkv' },
  output: path.join(dir, 'Cai Blaze Arts.mkv'),
  metadata: path.join(dir, 'Cai Blaze Arts.mkv.vcut.json'),
};
const mkvDone = await exportClip(mkv, { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, signal, (r, p) =>
  console.log('MKV ' + Math.round(p * 100) + '% ' + r.message),
);
assert.equal(mkvDone.state, 'verified');
assert.equal(await fileHash(file), hash);
await writeFile(path.join(dir, 'record-mkv.json'), JSON.stringify(mkvDone, null, 2));
await writeFile(
  path.join(root, 'latest-real.json'),
  JSON.stringify({ dir, mp4: output, mkv: mkv.output }, null, 2),
);
console.log(JSON.stringify({ mkv: mkv.output, verified: mkvDone.verification }));
