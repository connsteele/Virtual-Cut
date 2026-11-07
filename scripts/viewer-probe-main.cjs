/* eslint-disable @typescript-eslint/no-require-imports -- Plain Electron main script started outside the app build. */
// Electron main process for the VC-16 viewer probe (started by viewer-probe-study.mjs).
//
// Chromium can't play ProRes or DNxHR, so this asks: could Virtual Cut decode them itself and
// only draw in the page? Main decodes with the FFmpeg tool in separate processes and hands raw
// YUV frames to a page that draws them with WebGL (colour conversion and scaling on the GPU).
// It is a probe outside the app: no project, no app code, its own throwaway profile.
//
// Decode routes measured:
//   - seek: one FFmpeg process per requested frame (`-ss t -frames:v 1`), the cheapest route
//     with today's tools. Process start-up is part of the cost; `decodeMs` reports it.
//   - stream: one FFmpeg process streaming frames forward from a time, for playback.
// The page drives the experiments and reports results back.
const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const { writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const [proxy, output, label = path.parse(proxy || '').name] = process.argv.slice(2);
if (!proxy || !output) {
  console.error('Usage: electron viewer-probe-main.cjs <proxy> <output folder> [label]');
  app.exit(1);
}
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg';
const ffprobe = process.env.VIRTUAL_CUT_FFPROBE || 'ffprobe';
mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, `profile-${process.pid}`));

const info = JSON.parse(
  execFileSync(ffprobe, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name,profile,width,height,r_frame_rate,pix_fmt:format=duration',
    '-of',
    'json',
    proxy,
  ]),
);
const stream = info.streams[0];
const width = stream.width,
  height = stream.height;
const [num, den] = stream.r_frame_rate.split('/').map(Number);
const fps = num / den;
const duration = Number(info.format.duration);
// yuv420p: full-size Y plane plus quarter-size U and V planes.
const frameBytes = width * height * 1.5;

/** Collects exactly `count` frames from an FFmpeg rawvideo pipe. */
function decode(args, count, onFrame) {
  const started = performance.now();
  const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // Pipe chunks are 64 KB, so a frame is joined once when complete, not on every chunk.
  let chunks = [],
    buffered = 0,
    frames = 0,
    firstByteMs;
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      firstByteMs ??= performance.now() - started;
      chunks.push(chunk);
      buffered += chunk.length;
      while (buffered >= frameBytes && frames < count) {
        const joined = Buffer.concat(chunks, buffered);
        const frame = joined.subarray(0, frameBytes);
        chunks = buffered > frameBytes ? [joined.subarray(frameBytes)] : [];
        buffered -= frameBytes;
        frames++;
        onFrame(frame, performance.now() - started);
      }
      if (frames >= count) child.kill();
    });
    let err = '';
    child.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    child.on('error', reject);
    child.on('close', (code) =>
      frames || code === 0 ? resolve({ frames, firstByteMs }) : reject(new Error(err)),
    );
  });
  return { child, done };
}
const output420 = ['-an', '-sn', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'];

const inFlight = new Set();
ipcMain.handle('probe:info', () => ({
  label,
  proxy,
  width,
  height,
  fps,
  duration,
  codec: stream.codec_name,
  profile: stream.profile,
  pixFmt: stream.pix_fmt,
}));
// One process per frame. `-ss` before `-i` seeks to the frame at or after `time`; every frame
// of these proxies is a keyframe, so only one frame is decoded.
ipcMain.handle('probe:seek', async (event, time) => {
  let picture;
  const job = decode(
    [
      '-hide_banner',
      '-nostdin',
      '-ss',
      time.toFixed(4),
      '-i',
      proxy,
      '-frames:v',
      '1',
      ...output420,
    ],
    1,
    (frame) => (picture = Buffer.from(frame)),
  );
  inFlight.add(job.child);
  const started = performance.now();
  try {
    await job.done;
  } finally {
    inFlight.delete(job.child);
  }
  return { time, decodeMs: performance.now() - started, picture };
});
// Streaming playback: frames are pushed to the page as they decode, as fast as FFmpeg goes.
// The page acknowledges each frame so the main process never queues more than `window`.
ipcMain.handle('probe:stream', async (event, time, count, window = 4) => {
  const sender = event.sender;
  let sent = 0,
    acked = 0;
  const acks = [];
  const onAck = () => {
    acked++;
    acks.shift()?.();
  };
  ipcMain.on('probe:ack', onAck);
  const started = performance.now();
  const job = decode(
    [
      '-hide_banner',
      '-nostdin',
      '-ss',
      time.toFixed(4),
      '-i',
      proxy,
      '-frames:v',
      String(count),
      ...output420,
    ],
    count,
    (frame) => {
      sender.send('probe:frame', { index: sent++, picture: Buffer.from(frame) });
      if (sent - acked >= window) {
        job.child.stdout.pause();
        acks.push(() => job.child.stdout.resume());
      }
    },
  );
  const result = await job.done;
  while (acked < sent) await new Promise((r) => setTimeout(r, 5));
  ipcMain.off('probe:ack', onAck);
  return { ...result, seconds: (performance.now() - started) / 1000 };
});
ipcMain.handle('probe:metrics', () =>
  app.getAppMetrics().map((m) => ({
    type: m.type,
    cpu: Number(m.cpu.percentCPUUsage.toFixed(1)),
    workingSetMB: Math.round(m.memory.workingSetSize / 1024),
  })),
);
ipcMain.handle('probe:done', (event, results) => {
  const file = path.join(output, `viewer-probe-${label}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`VIEWER_PROBE_RESULT ${file}`);
  for (const child of inFlight) child.kill();
  setTimeout(() => app.quit(), 100);
});

app.whenReady().then(async () => {
  const gpu = await app.getGPUFeatureStatus();
  const w = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: false,
    webPreferences: {
      // A local probe page with no remote content; the app itself keeps its sandbox.
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });
  // Off-screen but composited like a visible window (same as the playback studies).
  w.setSkipTaskbar(true);
  w.setIgnoreMouseEvents(true);
  w.setFocusable(false);
  w.setPosition(-20000, -20000);
  w.showInactive();
  w.webContents.on('console-message', (e) => console.log(`[page] ${e.message}`));
  await w.loadFile(path.join(__dirname, 'viewer-probe.html'), {
    query: { gpu: JSON.stringify(gpu) },
  });
});
