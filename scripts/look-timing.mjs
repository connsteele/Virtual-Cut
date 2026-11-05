// Times the look tool's decoding on a copied recording (VC-172): a 16-tile strip from keyframes
// with no filmstrip tile file (the slowest strip), a strip of exact frames over a short range,
// 720p and 1080p frames, and a full-detail crop. Runs FFmpeg the way look does (CPU, normal
// priority, three at a time); nothing is written. Usage:
//   node scripts/look-timing.mjs <copy.mp4> [strip start] [strip end]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { planLook } from '../dist-electron/look-plan.js';
const require = createRequire(import.meta.url);
const { decode } = require('../dist-electron/look.cjs');

const [file, from = '60', to] = process.argv.slice(2);
assert(file, 'Give a copied recording.');
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg';
const ffprobe = process.env.VIRTUAL_CUT_FFPROBE || 'ffprobe';
const probe = (args) =>
  spawnSync(ffprobe, ['-v', 'error', ...args, file], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .stdout;
const [stream] = JSON.parse(
  probe([
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,codec_name,start_time,r_frame_rate',
    '-of',
    'json',
  ]),
).streams;
const offset = Number(stream.start_time) || 0;
const packets = probe([
  '-select_streams',
  'v:0',
  '-show_entries',
  'packet=pts_time,flags',
  '-of',
  'csv=p=0',
])
  .trim()
  .split(/\r?\n/)
  .map((l) => l.split(','))
  .filter(([t]) => t !== 'N/A')
  .map(([t, flags]) => ({ t: Number(t) - offset, key: flags.startsWith('K') }));
const frameTimes = packets.map((p) => p.t).sort((a, b) => a - b);
const keys = packets
  .filter((p) => p.key)
  .map((p) => p.t)
  .sort((a, b) => a - b);
const duration = frameTimes.at(-1);
const recording = {
  title: file,
  duration,
  width: stream.width,
  height: stream.height,
  keys,
  frameTimes,
};
const start = Number(from),
  end = to ? Number(to) : Math.min(duration, start + 120);

async function time(name, moments) {
  const plan = planLook(recording, moments);
  const began = performance.now();
  let next = 0;
  const each = [];
  const work = async () => {
    for (let n = next++; n < plan.images.length; n = next++) {
      const t = performance.now();
      await decode(ffmpeg, file, offset, plan.images[n]);
      each.push(performance.now() - t);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, plan.images.length) }, work));
  const total = performance.now() - began;
  return {
    name,
    pictures: plan.images.length,
    keyframes: plan.images.filter((i) => i.keyframe).length,
    seconds: Math.round(total / 100) / 10,
    slowestPicture: Math.round(Math.max(...each) / 100) / 10,
    tokens: plan.images.reduce((n, i) => n + i.tokens, 0),
  };
}
const results = [
  await time(`strip ${start}-${end} s, 16 keyframe tiles, no tile file`, [
    { kind: 'strip', start_seconds: start, end_seconds: end },
  ]),
  await time(`strip ${start}-${start + 4} s, 16 tiles (mostly exact frames)`, [
    { kind: 'strip', start_seconds: start, end_seconds: start + 4 },
  ]),
  await time('one 720p frame', [{ kind: 'frames', times: [start + 7.3] }]),
  await time('one 1080p frame', [{ kind: 'frames', times: [start + 9.7], size: '1080p' }]),
  await time('six 720p frames', [
    { kind: 'frames', times: [1, 2, 3, 4, 5, 6].map((n) => start + n * 11.1) },
  ]),
  await time('crop of the lower fifth at full detail', [
    { kind: 'crop', at_seconds: start + 12.4, box: [0.1, 0.75, 0.9, 0.95], box_units: 'fraction' },
  ]),
];
console.log(
  JSON.stringify(
    {
      file,
      codec: stream.codec_name,
      size: `${stream.width}x${stream.height}`,
      rate: stream.r_frame_rate,
      keyframeSpacing: Math.round(((keys.at(-1) - keys[0]) / (keys.length - 1)) * 100) / 100,
      results,
    },
    null,
    2,
  ),
);
