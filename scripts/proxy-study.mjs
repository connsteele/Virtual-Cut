// Generate H.264 playback-proxy candidates with NVENC and record time and size (VC-16).
//
// Each variant decodes the source on the GPU, scales on the GPU when needed, and encodes
// H.264 without B-frames (so any frame can be reached by decoding forward from a nearby
// keyframe) at a fixed keyframe interval. Video only: proxies are for silent fast scanning.
// Use a copy of a recording.
//   node scripts/proxy-study.mjs <source copy> <output folder>
import { spawn } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('Usage: proxy-study.mjs <source copy> <output folder>');
await mkdir(output, { recursive: true });
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg';
const ffprobe = process.env.VIRTUAL_CUT_FFPROBE || 'ffprobe';
const run = (tool, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(tool, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '',
      err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    child.on('error', reject);
    child.on('close', (code) => (code ? reject(new Error(err)) : resolve(out)));
  });
const duration = Number(
  await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', source]),
);
const sourceBytes = (await stat(source)).size;
const variants = [
  { name: '1080p-gop2', height: 1080, gop: 2 },
  { name: '1080p-gop4', height: 1080, gop: 4 },
  { name: '1080p-gop15', height: 1080, gop: 15 },
  { name: '1080p-gop60', height: 1080, gop: 60 },
  { name: '2160p-gop4', height: 2160, gop: 4 },
  { name: '2160p-gop15', height: 2160, gop: 15 },
];
const encode = (v, file) => [
  '-hide_banner',
  '-nostdin',
  '-y',
  '-hwaccel',
  'cuda',
  '-hwaccel_output_format',
  'cuda',
  '-c:v',
  'av1_cuvid',
  '-i',
  source,
  '-map',
  '0:v:0',
  '-an',
  ...(v.height === 2160 ? [] : ['-vf', `scale_cuda=-2:${v.height}`]),
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
  String(v.gop),
  '-keyint_min',
  String(v.gop),
  '-forced-idr',
  '1',
  '-movflags',
  '+faststart',
  file,
];
const results = [];
for (const v of variants) {
  const file = path.join(output, `proxy-${v.name}.mp4`);
  const started = performance.now();
  await run(ffmpeg, encode(v, file));
  const seconds = (performance.now() - started) / 1000;
  const bytes = (await stat(file)).size;
  results.push({
    variant: v.name,
    file,
    generateSeconds: Number(seconds.toFixed(1)),
    realtimeMultiple: Number((duration / seconds).toFixed(1)),
    megabytes: Math.round(bytes / 1e6),
    megabytesPerMinute: Math.round(bytes / 1e6 / (duration / 60)),
    sizeVersusSource: Number((bytes / sourceBytes).toFixed(2)),
  });
  console.log(JSON.stringify(results.at(-1)));
}
// Two proxies at once: do the RTX 4090's two encoders double throughput, or does the single
// decoder limit it?
const pair = variants.filter((v) => ['1080p-gop4', '1080p-gop15'].includes(v.name));
const startedPair = performance.now();
await Promise.all(pair.map((v) => run(ffmpeg, encode(v, path.join(output, `pair-${v.name}.mp4`)))));
const pairSeconds = (performance.now() - startedPair) / 1000;
// One decode feeding two encodes.
const startedSplit = performance.now();
await run(ffmpeg, [
  '-hide_banner',
  '-nostdin',
  '-y',
  '-hwaccel',
  'cuda',
  '-hwaccel_output_format',
  'cuda',
  '-c:v',
  'av1_cuvid',
  '-i',
  source,
  '-filter_complex',
  '[0:v]scale_cuda=-2:1080,split=2[a][b]',
  '-map',
  '[a]',
  '-an',
  '-c:v',
  'h264_nvenc',
  '-preset',
  'p4',
  '-rc',
  'vbr',
  '-cq',
  '23',
  '-b:v',
  '0',
  '-bf',
  '0',
  '-g',
  '4',
  path.join(output, 'split-a.mp4'),
  '-map',
  '[b]',
  '-an',
  '-c:v',
  'h264_nvenc',
  '-preset',
  'p4',
  '-rc',
  'vbr',
  '-cq',
  '23',
  '-b:v',
  '0',
  '-bf',
  '0',
  '-g',
  '15',
  path.join(output, 'split-b.mp4'),
]);
const splitSeconds = (performance.now() - startedSplit) / 1000;
const summary = {
  source,
  durationSeconds: Number(duration.toFixed(1)),
  sourceMegabytesPerMinute: Math.round(sourceBytes / 1e6 / (duration / 60)),
  results,
  twoAtOnceSeconds: Number(pairSeconds.toFixed(1)),
  oneDecodeTwoEncodesSeconds: Number(splitSeconds.toFixed(1)),
};
await writeFile(path.join(output, 'proxy-study.json'), JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify({
    twoAtOnceSeconds: summary.twoAtOnceSeconds,
    oneDecodeTwoEncodesSeconds: summary.oneDecodeTwoEncodesSeconds,
    sourceMegabytesPerMinute: summary.sourceMegabytesPerMinute,
  }),
);
