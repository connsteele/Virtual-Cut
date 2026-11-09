// VC-16 viewer probe: can Virtual Cut show ProRes or DNxHR proxies, which Chromium can't play,
// by decoding them with FFmpeg in main and drawing frames on a WebGL canvas? Runs
// viewer-probe-main.cjs (a bare Electron window, outside the app) once per proxy and records
// time from a seek to the frame on screen, frames shown per second while dragging (latest
// position wins, one or three decodes in flight), forward streaming speed, and CPU, memory and
// GPU load. Use proxies made from copies (proxy-candidates-study.mjs).
//   node scripts/viewer-probe-study.mjs <output folder> <proxy> [more proxies]
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { root, require } from './shared.mjs';

const [output, ...proxies] = process.argv.slice(2);
if (!output || !proxies.length)
  throw new Error('Usage: viewer-probe-study.mjs <output folder> <proxy> [more proxies]');
await mkdir(output, { recursive: true });

function sampler(tool, args, parse) {
  const samples = [];
  const child = spawn(tool, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  child.on('error', () => {});
  child.stdout.on('data', (d) => {
    for (const line of String(d).split(/\r?\n/)) {
      const s = parse(line);
      if (s) samples.push(s);
    }
  });
  return { samples, stop: () => child.kill() };
}
const avg = (list, key) =>
  list.length ? Math.round(list.reduce((a, s) => a + s[key], 0) / list.length) : undefined;

const all = [];
for (const proxy of proxies) {
  const gpu = sampler('nvidia-smi', ['dmon', '-s', 'u', '-d', '1'], (line) => {
    const c = line.trim().split(/\s+/);
    return /^\d+$/.test(c[0] || '') && c.length >= 5
      ? { sm: Number(c[1]), enc: Number(c[3]), dec: Number(c[4]) }
      : undefined;
  });
  // Whole-PC CPU from the OS tick counters (typeperf holds its output back when piped).
  const cpu = { samples: [] };
  let ticks = os.cpus();
  const cpuTimer = setInterval(() => {
    const now = os.cpus();
    let busy = 0,
      all = 0;
    now.forEach((c, i) => {
      const total = (t) => t.user + t.nice + t.sys + t.irq + t.idle;
      const spent = total(c.times) - total(ticks[i].times);
      all += spent;
      busy += spent - (c.times.idle - ticks[i].times.idle);
    });
    ticks = now;
    if (all > 0) cpu.samples.push({ total: (100 * busy) / all });
  }, 1000);
  cpu.stop = () => clearInterval(cpuTimer);
  const started = Date.now();
  const file = await new Promise((resolve, reject) => {
    const child = spawn(
      require('electron'),
      [path.join(root, 'scripts', 'viewer-probe-main.cjs'), proxy, output],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let result,
      err = '';
    child.stdout.on('data', (d) => {
      const m = String(d).match(/VIEWER_PROBE_RESULT (.+)/);
      if (m) result = m[1].trim();
    });
    child.stderr.on('data', (d) => (err = (err + d).slice(-3000)));
    child.on('error', reject);
    child.on('close', () => (result ? resolve(result) : reject(new Error(err || 'no result'))));
  });
  gpu.stop();
  cpu.stop();
  const result = JSON.parse(await readFile(file, 'utf8'));
  result.wholeRun = {
    seconds: Math.round((Date.now() - started) / 1000),
    pcCpuPercentAvg: avg(cpu.samples, 'total'),
    gpuShaderPercentAvg: avg(gpu.samples, 'sm'),
    gpuDecodePercentAvg: avg(gpu.samples, 'dec'),
  };
  await writeFile(file, JSON.stringify(result, null, 2));
  all.push({ proxy: path.basename(proxy), ...result });
  const d = result.drag || [];
  console.log(
    `${path.basename(proxy)}: seek→shown p50 ${result.seek?.seekToShownMs?.p50} ms p95 ${result.seek?.seekToShownMs?.p95} ms; ` +
      d
        .map(
          (x) =>
            `drag ${x.footageSeconds}s/${x.dragMs / 1000}s x${x.parallel} ${x.framesShownPerSecond}/s lag p50 ${x.pointerToFrameMs.p50} ms`,
        )
        .join('; ') +
      `; stream ${result.stream?.framesPerSecond}/s (${result.stream?.versusRealtime}x); CPU avg ${result.wholeRun.pcCpuPercentAvg}%` +
      (result.error ? `; ERROR ${result.error}` : ''),
  );
}
await writeFile(path.join(output, 'viewer-probe.json'), JSON.stringify(all, null, 2));
