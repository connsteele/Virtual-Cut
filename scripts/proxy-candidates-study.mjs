// Make the VC-16 proxy candidates from copied recordings and record what each one costs
// (Sprint 14 lane F). For every candidate and source it records generation time, footage
// minutes made per minute, bytes per footage hour, the ffmpeg process's CPU time (from
// -benchmark), whole-PC CPU load (typeperf) and GPU shader, encoder and decoder load
// (nvidia-smi dmon), so the report can say whether the run really used NVDEC and NVENC.
//
// Candidates (Connor's list): 1080p and 720p, each as
//   - H.264 long-GOP (NVENC, keyframe every 15 frames, no B-frames)
//   - H.264 all-intra (NVENC, every frame a keyframe)
//   - ProRes 422 Proxy (prores_ks profile 0, CPU; LT at 1080p as an extra with --extras)
//   - DNxHR LB (CPU; SQ at 1080p as an extra with --extras)
// Every candidate decodes the AV1 source on the GPU (av1_cuvid) and scales there
// (scale_cuda). ProRes and DNxHR have no NVIDIA encoder, so their frames are downloaded and
// encoded on the CPU. Video only: audio stays with the original.
//
// The run refuses to start while another job is using the GPU decoder, and runs candidates
// one at a time. Use copies of recordings only.
//   node scripts/proxy-candidates-study.mjs <output folder> <source copy> [more copies] [--extras] [--only=name,name]
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import './shared.mjs';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const [output, ...sources] = args.filter((a) => !a.startsWith('--'));
if (!output || !sources.length)
  throw new Error(
    'Usage: proxy-candidates-study.mjs <output folder> <source copy> [more] [--extras]',
  );
const only = flags
  .find((f) => f.startsWith('--only='))
  ?.slice(7)
  .split(',');
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg';
const ffprobe = process.env.VIRTUAL_CUT_FFPROBE || 'ffprobe';
await mkdir(output, { recursive: true });
const logFile = path.join(output, 'study.log');
const log = async (line) => {
  console.log(line);
  await appendFile(logFile, line + '\n');
};

const run = (tool, toolArgs, { keepErr = 8000 } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(tool, toolArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '',
      err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-keepErr)));
    child.on('error', reject);
    child.on('close', (code) => (code ? reject(new Error(err)) : resolve({ out, err })));
  });

// --- Samplers -------------------------------------------------------------------------------
function sampler(tool, toolArgs, parse) {
  const samples = [];
  const child = spawn(tool, toolArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  child.on('error', () => {});
  child.stdout.on('data', (d) => {
    for (const line of String(d).split(/\r?\n/)) {
      const s = parse(line);
      if (s) samples.push({ t: Date.now(), ...s });
    }
  });
  return { samples, stop: () => child.kill() };
}
// nvidia-smi dmon -s u: gpu sm mem enc dec jpg ofa
const gpu = sampler('nvidia-smi', ['dmon', '-s', 'u', '-d', '1'], (line) => {
  const c = line.trim().split(/\s+/);
  if (!/^\d+$/.test(c[0] || '') || c.length < 5) return undefined;
  return { sm: Number(c[1]), enc: Number(c[3]), dec: Number(c[4]) };
});
// Whole-PC CPU load from the OS tick counters once a second (typeperf holds its output back
// when piped, so it can't be read live).
const cpu = { samples: [] };
let ticks = os.cpus();
const cpuTimer = setInterval(() => {
  const now = os.cpus();
  let busy = 0,
    all = 0;
  now.forEach((c, i) => {
    const before = ticks[i].times;
    const total = (t) => t.user + t.nice + t.sys + t.irq + t.idle;
    all += total(c.times) - total(before);
    busy += total(c.times) - total(before) - (c.times.idle - before.idle);
  });
  ticks = now;
  if (all > 0) cpu.samples.push({ t: Date.now(), total: (100 * busy) / all });
}, 1000);
cpu.stop = () => clearInterval(cpuTimer);
const average = (list, key) =>
  list.length ? Math.round(list.reduce((a, s) => a + s[key], 0) / list.length) : undefined;
const peak = (list, key) => (list.length ? Math.max(...list.map((s) => s[key])) : undefined);
const window = (list, from, to) => list.filter((s) => s.t >= from + 1000 && s.t <= to);

async function gpuIsFree() {
  const until = Date.now() + 4000;
  while (Date.now() < until) await new Promise((r) => setTimeout(r, 500));
  const recent = gpu.samples.filter((s) => s.t > Date.now() - 2500);
  return { free: !recent.some((s) => s.dec > 5 || s.enc > 5), recent };
}

// --- Candidates ------------------------------------------------------------------------------
const nvencH264 = (gop, cq) => [
  '-c:v',
  'h264_nvenc',
  '-preset',
  'p4',
  '-profile:v',
  'high',
  '-rc',
  'vbr',
  '-cq',
  String(cq),
  '-b:v',
  '0',
  '-bf',
  '0',
  '-g',
  String(gop),
  '-keyint_min',
  String(gop),
  '-forced-idr',
  '1',
];
// All-intra: NVENC takes a GOP length of 0 as "every frame is an IDR frame" (it refuses 1).
// Frames leave the GPU only for CPU encoders.
const toCpu = (pixFmt) => `,hwdownload,format=nv12,format=${pixFmt}`;
const candidates = [
  { name: 'h264-1080p', height: 1080, ext: 'mp4', codec: nvencH264(15, 23), gpuEncode: true },
  { name: 'h264-720p', height: 720, ext: 'mp4', codec: nvencH264(15, 23), gpuEncode: true },
  { name: 'h264intra-1080p', height: 1080, ext: 'mp4', codec: nvencH264(0, 23), gpuEncode: true },
  { name: 'h264intra-720p', height: 720, ext: 'mp4', codec: nvencH264(0, 23), gpuEncode: true },
  {
    name: 'prores-proxy-1080p',
    height: 1080,
    ext: 'mov',
    pixFmt: 'yuv422p10le',
    codec: ['-c:v', 'prores_ks', '-profile:v', '0', '-vendor', 'apl0'],
  },
  {
    name: 'prores-proxy-720p',
    height: 720,
    ext: 'mov',
    pixFmt: 'yuv422p10le',
    codec: ['-c:v', 'prores_ks', '-profile:v', '0', '-vendor', 'apl0'],
  },
  {
    name: 'dnxhr-lb-1080p',
    height: 1080,
    ext: 'mov',
    pixFmt: 'yuv422p',
    codec: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_lb'],
  },
  {
    name: 'dnxhr-lb-720p',
    height: 720,
    ext: 'mov',
    pixFmt: 'yuv422p',
    codec: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_lb'],
  },
];
if (flags.includes('--extras'))
  candidates.push(
    {
      name: 'prores-lt-1080p',
      height: 1080,
      ext: 'mov',
      pixFmt: 'yuv422p10le',
      extra: true,
      codec: ['-c:v', 'prores_ks', '-profile:v', '1', '-vendor', 'apl0'],
    },
    {
      name: 'dnxhr-sq-1080p',
      height: 1080,
      ext: 'mov',
      pixFmt: 'yuv422p',
      extra: true,
      codec: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_sq'],
    },
    // FFmpeg's other ProRes encoder: faster than prores_ks, slightly less exact rate control.
    {
      name: 'proresaw-proxy-1080p',
      height: 1080,
      ext: 'mov',
      pixFmt: 'yuv422p10le',
      extra: true,
      codec: ['-c:v', 'prores_aw', '-profile:v', '0', '-vendor', 'apl0'],
    },
  );

const encodeArgs = (c, source, file) => [
  '-hide_banner',
  '-nostdin',
  '-n',
  '-nostats',
  '-benchmark',
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
  '-sn',
  '-dn',
  '-vf',
  `scale_cuda=-2:${c.height}${c.pixFmt ? toCpu(c.pixFmt) : ''}`,
  ...c.codec,
  '-movflags',
  '+faststart',
  file,
];

// --- Run -------------------------------------------------------------------------------------
const probe = async (file) => {
  const { out } = await run(ffprobe, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name,width,height,nb_frames:format=duration,size',
    '-of',
    'json',
    file,
  ]);
  const j = JSON.parse(out);
  return {
    duration: Number(j.format.duration),
    bytes: Number(j.format.size),
    stream: j.streams[0],
  };
};

// Rows from earlier runs into the same folder are kept; a rerun replaces its own rows.
const results = await readFile(path.join(output, 'candidates.json'), 'utf8')
  .then((text) => JSON.parse(text).results)
  .catch(() => []);
const machine = { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, ram: os.totalmem() };
await log(`Started ${new Date().toISOString()} on ${machine.cpuModel} (${machine.cpus} threads)`);
for (const source of sources) {
  const src = await probe(source);
  for (const c of candidates) {
    if (only && !only.includes(c.name)) continue;
    const check = await gpuIsFree();
    if (!check.free) {
      await log(`STOP: GPU busy before ${c.name} (${JSON.stringify(check.recent.slice(-3))})`);
      process.exitCode = 2;
      break;
    }
    const file = path.join(
      output,
      `${path.parse(source).name.replace(/\s+/g, '_')}.${c.name}.${c.ext}`,
    );
    const started = Date.now();
    let bench = '';
    let failed;
    try {
      ({ err: bench } = await run(ffmpeg, encodeArgs(c, source, file)));
    } catch (error) {
      failed = String(error.message).slice(-600);
    }
    const ended = Date.now();
    const seconds = (ended - started) / 1000;
    const g = window(gpu.samples, started, ended);
    const p = window(cpu.samples, started, ended);
    const utime = Number(bench.match(/utime=([\d.]+)s/)?.[1]);
    const stime = Number(bench.match(/stime=([\d.]+)s/)?.[1]);
    const maxrss = Number(bench.match(/maxrss=(\d+)KiB/)?.[1]);
    const made = failed ? undefined : await probe(file);
    const hours = src.duration / 3600;
    const result = {
      candidate: c.name,
      extra: Boolean(c.extra),
      source: path.basename(source),
      sourceMinutes: Number((src.duration / 60).toFixed(2)),
      sourceGBPerHour: Number((src.bytes / 1e9 / hours).toFixed(2)),
      failed,
      seconds: Number(seconds.toFixed(1)),
      realtimeMultiple: Number((src.duration / seconds).toFixed(2)),
      minutesPerFootageHour: Number((seconds / 60 / hours).toFixed(2)),
      gbPerFootageHour: made ? Number((made.bytes / 1e9 / hours).toFixed(2)) : undefined,
      sizeVersusSource: made ? Number((made.bytes / src.bytes).toFixed(2)) : undefined,
      mbps: made ? Number(((made.bytes * 8) / 1e6 / made.duration).toFixed(1)) : undefined,
      frames: made?.stream?.nb_frames,
      size: made
        ? `${made.stream.width}x${made.stream.height} ${made.stream.codec_name}`
        : undefined,
      ffmpegCpuCores: Number.isFinite(utime)
        ? Number(((utime + stime) / seconds).toFixed(1))
        : undefined,
      ffmpegMaxRssMB: Number.isFinite(maxrss) ? Math.round(maxrss / 1024) : undefined,
      pcCpuPercentAvg: average(p, 'total'),
      pcCpuPercentPeak: peak(p, 'total'),
      gpuDecodePercentAvg: average(g, 'dec'),
      gpuEncodePercentAvg: average(g, 'enc'),
      gpuShaderPercentAvg: average(g, 'sm'),
      usedNvdec: (average(g, 'dec') ?? 0) > 10,
      usedNvenc: (average(g, 'enc') ?? 0) > 5,
      file,
    };
    const same = results.findIndex((r) => r.candidate === c.name && r.source === result.source);
    if (same >= 0) results.splice(same, 1, result);
    else results.push(result);
    await log(JSON.stringify(result));
    await writeFile(
      path.join(output, 'candidates.json'),
      JSON.stringify({ machine, results }, null, 2),
    );
  }
  if (process.exitCode) break;
}
gpu.stop();
cpu.stop();
await log(`Finished ${new Date().toISOString()}`);
