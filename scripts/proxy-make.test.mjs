// VC-237: the proxy's segment plan, its forced keyframes and the packet check that decides
// whether a made proxy matches its recording.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  proxyPlan,
  forcedTimes,
  proxyProblem,
  segmentArgs,
  frameStep,
} = require('../dist-electron/proxy-make.cjs');
const { proxySettings, isProxySettings } = await import('../dist-electron/proxy-settings.js');

// 20 s at 60 fps with OBS-like keyframes every second, one irregular one at 5.55 s.
const fps = 60;
const times = Array.from({ length: 20 * fps }, (_, i) => i / fps);
const keys = [0, 1, 2, 3, 4, 5, 5.55, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const at = (t) => Math.round(t * fps);

test('segments start on source keyframes and cover every frame once', () => {
  const plan = proxyPlan(times, keys, 0.5, 6);
  assert.deepEqual(
    plan.map((s) => s.start),
    [0, 7, 13, 19],
  );
  assert.equal(
    plan.reduce((n, s) => n + s.frames, 0),
    times.length,
  );
  for (const [i, s] of plan.entries())
    assert.equal(s.first + s.frames, plan[i + 1]?.first ?? times.length);
});

test('keyframes land on every source keyframe and every half second', () => {
  const plan = proxyPlan(times, keys, 0.5, 6);
  const all = plan.flatMap((s) => s.keys);
  for (const k of keys) assert.ok(all.includes(at(k)), `source keyframe ${k}`);
  for (let t = 0; t < 20; t += 0.5) assert.ok(all.includes(at(t)), `grid ${t}`);
  assert.ok(all.includes(at(5.55)));
  assert.equal(new Set(all).size, all.length);
  // Forced times sit a quarter frame before their frame, relative to the segment.
  const second = plan[1];
  assert.equal(forcedTimes(second, times)[0], (0.5 - 0.25 / fps).toFixed(6));
  assert.equal(forcedTimes(second, times).length, second.keys.length - 1);
});

test('a recording that does not start on a keyframe is refused', () => {
  assert.throws(() => proxyPlan(times, [1, 2]), /does not start on a keyframe/);
  assert.throws(() => proxyPlan([], []), /no frame index/);
});

test('segment arguments: seek before the first frame, exact frame count, GPU or CPU', () => {
  const plan = proxyPlan(times, keys, 0.5, 6);
  const base = { file: 'in.mp4', offset: 2, frameTimes: times, height: 1080, out: 'o.mp4' };
  const gpu = segmentArgs({
    ...base,
    segment: plan[1],
    decode: 'gpu',
    gpuDecoder: 'av1_cuvid',
    encode: 'nvenc',
  });
  assert.equal(gpu[gpu.indexOf('-ss') + 1], (2 + 7 - 0.001).toFixed(6));
  assert.equal(gpu[gpu.indexOf('-frames:v') + 1], String(plan[1].frames));
  assert.equal(gpu[gpu.indexOf('-vf') + 1], 'scale_cuda=-2:1080:format=nv12');
  assert.ok(gpu.includes('h264_nvenc') && gpu.includes('-n'));
  assert.equal(gpu[gpu.indexOf('-bf') + 1], '0');
  const cpu = segmentArgs({ ...base, segment: plan[0], decode: 'cpu', encode: 'x264' });
  assert.ok(!cpu.includes('-ss') && !cpu.includes('-hwaccel') && cpu.includes('libx264'));
  assert.match(cpu[cpu.indexOf('-vf') + 1], /^scale=-2:1080/);
});

test('the packet check accepts a matching proxy and names what differs', () => {
  const plan = proxyPlan(times, keys, 0.5, 6);
  const wanted = new Set(plan.flatMap((s) => s.keys));
  const good = {
    codec: 'h264',
    width: 1920,
    height: 1080,
    streams: 1,
    packets: times.map((t, i) => ({ pts: t + 1e-5, key: wanted.has(i) })),
  };
  assert.equal(proxyProblem(good, times, plan, keys, 1080), '');
  const missingKey = structuredClone(good);
  missingKey.packets[at(5.55)].key = false;
  assert.match(proxyProblem(missingKey, times, plan, keys, 1080), /source keyframe at 5\.550/);
  const short = { ...good, packets: good.packets.slice(1) };
  assert.match(proxyProblem(short, times, plan, keys, 1080), /1199 frames/);
  const drift = structuredClone(good);
  drift.packets[600].pts += 0.01;
  assert.match(proxyProblem(drift, times, plan, keys, 1080), /frame 601/);
  assert.match(proxyProblem({ ...good, height: 720 }, times, plan, keys, 1080), /720 pixels/);
  assert.match(proxyProblem({ ...good, codec: 'hevc' }, times, plan, keys, 1080), /hevc/);
  assert.match(proxyProblem({ ...good, streams: 2 }, times, plan, keys, 1080), /more than/);
  const sparse = structuredClone(good);
  for (const p of sparse.packets) p.key = false;
  for (const k of keys) sparse.packets[at(k)].key = true;
  assert.match(proxyProblem(sparse, times, [], keys, 1080), /between keyframes/);
  assert.equal(frameStep([0]), 1 / 60);
});

test('proxy settings: defaults, and only listed choices are taken', () => {
  assert.deepEqual(proxySettings(undefined), { onImport: 'ask', height: 1080 });
  assert.deepEqual(proxySettings({ onImport: 'import', height: 720 }), {
    onImport: 'import',
    height: 720,
  });
  assert.deepEqual(proxySettings({ onImport: 'always', height: 480 }), {
    onImport: 'ask',
    height: 1080,
  });
  assert.ok(isProxySettings({ onImport: 'never', height: 720 }));
  assert.ok(!isProxySettings({ onImport: 'never', height: 720, extra: 1 }));
  assert.ok(!isProxySettings({ onImport: 'ask', height: 1440 }));
  assert.ok(!isProxySettings(null));
});
