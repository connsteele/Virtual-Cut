// The proxy record on a recording (Sprint 15 shared commit for VC-237 and VC-238): file names,
// which stored records are trusted, the four states the windows show, and proxy files counted
// in project storage.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  isNativeProxy,
  proxyFileName,
  proxyFilePattern,
  proxyFormat,
  proxyState,
} from '../dist-electron/proxy-record.js';

const require = createRequire(import.meta.url);
const { projectStorageUsage } = require('../dist-electron/project-storage.cjs');

const record = {
  file: proxyFileName('rec-1', 'fp-1', 1080),
  height: 1080,
  width: 1920,
  codec: 'h264',
  keyframeStep: 0.5,
  fingerprint: 'fp-1',
  bytes: 1000,
  modified: 1700000000000.5,
  made: '2026-11-10T20:00:00.000Z',
};
const onDisk = { size: 1000, mtimeMs: 1700000000000.5 };

test('proxy file names are per recording revision and height, and match the cache pattern', () => {
  assert.equal(proxyFileName('rec-1', 'fp-1', 1080), 'rec-1-fp-1-proxy-1080p.mp4');
  assert.equal(proxyFileName('rec-1', 'fp-1', 720), 'rec-1-fp-1-proxy-720p.mp4');
  assert.ok(proxyFilePattern.test('rec-1-fp-1-proxy-720p.mp4'));
  assert.ok(proxyFilePattern.test('rec-1-fp-1-proxy-1080p.partial.mp4'));
  assert.ok(!proxyFilePattern.test('rec-1-fp-1-audio-1.m4a'));
  assert.ok(!proxyFilePattern.test('rec-1-fp-1-proxy-480p.mp4'));
  assert.deepEqual(proxyFormat, { codec: 'h264', keyframeStep: 0.5 });
});

test('only a well formed record inside the cache folder is trusted', () => {
  assert.ok(isNativeProxy(record));
  for (const bad of [
    null,
    'x',
    { ...record, file: '..\\elsewhere\\rec-1-fp-1-proxy-1080p.mp4' },
    { ...record, file: 'sub/rec-1-fp-1-proxy-1080p.mp4' },
    { ...record, file: 'rec-1-fp-1-proxy-1080p.partial.mp4' },
    { ...record, file: 'original.mp4' },
    { ...record, height: 480 },
    { ...record, codec: 'av1' },
    { ...record, width: 0 },
    { ...record, keyframeStep: 0 },
    { ...record, bytes: 0 },
    { ...record, fingerprint: '' },
    { ...record, made: undefined },
  ])
    assert.equal(isNativeProxy(bad), false, JSON.stringify(bad));
});

test('the state is none, making, ready or missing', () => {
  assert.deepEqual(proxyState(undefined, 'fp-1', null), { state: 'none' });
  assert.deepEqual(proxyState(record, 'fp-1', onDisk), {
    state: 'ready',
    height: 1080,
    width: 1920,
    codec: 'h264',
  });
  // A queued or running job wins, including over an existing proxy being remade.
  assert.deepEqual(proxyState(undefined, 'fp-1', null, { progress: 0.42 }), {
    state: 'making',
    progress: 0.42,
  });
  assert.deepEqual(proxyState(record, 'fp-1', onDisk, { progress: 7 }), {
    state: 'making',
    progress: 1,
  });
  assert.equal(proxyState(undefined, 'fp-1', null, { progress: NaN }).progress, 0);
  // Gone, replaced, or made from another revision of the recording.
  assert.equal(proxyState(record, 'fp-1', null).state, 'missing');
  assert.equal(proxyState(record, 'fp-1', { ...onDisk, size: 999 }).state, 'missing');
  assert.equal(proxyState(record, 'fp-1', { ...onDisk, mtimeMs: 1 }).state, 'missing');
  assert.equal(proxyState(record, 'fp-2', onDisk).state, 'missing');
  assert.equal(proxyState(record, undefined, onDisk).state, 'missing');
  assert.equal(proxyState({ ...record, codec: 'av1' }, 'fp-1', onDisk).state, 'missing');
  assert.equal(proxyState(record, 'fp-1', { ...onDisk, size: 999 }).height, 1080);
});

test('project storage counts proxies on their own row', async () => {
  const root = await mkdtemp(path.join(process.env.TEMP || os.tmpdir(), 'vc-proxy-record-'));
  try {
    const cache = path.join(root, 'cache');
    await mkdir(cache);
    await writeFile(path.join(cache, proxyFileName('rec-1', 'fp-1', 1080)), Buffer.alloc(300));
    await writeFile(path.join(cache, 'rec-1-fp-1-proxy-720p.partial.mp4'), Buffer.alloc(20));
    await writeFile(path.join(cache, 'rec-1-fp-1-audio-1.m4a'), Buffer.alloc(10));
    const file = path.join(root, 'p.vcut');
    await writeFile(file, '');
    const usage = await projectStorageUsage(
      { id: 'p', name: 'p', file, cache, destination: root },
      [],
      [],
    );
    const row = (id) => usage.rows.find((r) => r.id === id);
    assert.equal(row('proxies').label, 'Playback proxies');
    assert.deepEqual([row('proxies').files, row('proxies').bytes], [2, 320]);
    assert.equal(row('audio').files, 1);
    assert.equal(row('cacheOther').files, 0);
    assert.equal((await stat(file)).size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
