import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { require, root } from './shared.mjs';

const { VideoAccess } = require(path.join(root, 'dist-electron/media.cjs'));
const { DemoMedia } = require(path.join(root, 'dist-electron/demo-media.cjs'));

test('demo allowlist grants independent bounded streams and rejects unknown or escaping paths', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'virtual-cut-demo-test-'));
  await writeFile(path.join(directory, 'first.mp4'), '0123456789abcdef');
  await writeFile(path.join(directory, 'second.mp4'), 'second video');
  const manifest = path.join(directory, 'manifest.json');
  const media = new DemoMedia();
  const read = (id, options) => media.respond(new Request(`media://video/demo/${id}`, options));
  await media.load(path.join(directory, 'missing.json'));
  assert.equal((await read('r1')).status, 404);
  await writeFile(
    manifest,
    JSON.stringify({ root: directory, files: { r1: 'first.mp4', r2: 'second.mp4' } }),
  );
  await media.load(manifest);
  const part = await read('r1', { headers: { Range: 'bytes=2-5' } });
  assert.equal(part.status, 206);
  assert.equal(await part.text(), '2345');
  assert.equal(await (await read('r2')).text(), 'second video');
  assert.equal((await read('r1', { method: 'HEAD' })).headers.get('Content-Length'), '16');
  assert.equal((await read('r1', { method: 'POST' })).status, 405);
  for (const id of ['unknown', 'r1?path=secret', '../first.mp4', 'r1/extra'])
    assert.equal((await read(id)).status, 404);
  for (const config of [
    { root: '.', files: { r1: 'first.mp4' } },
    { root: directory, files: { r1: '../first.mp4' } },
    { root: directory, files: { r1: 'first.mp4', r2: 'missing.mp4' } },
  ]) {
    await writeFile(manifest, JSON.stringify(config));
    await assert.rejects(media.load(manifest));
    assert.equal((await read('r1')).status, 404, 'An invalid manifest grants no partial access');
  }
});

test('selected video access is read-only, bounded, and revoked on replacement', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'virtual-cut-media-test-'));
  const file = path.join(directory, 'clip #1 100% — test.mp4');
  const bytes = Buffer.from('0123456789abcdef');
  await writeFile(file, bytes);
  const before = await stat(file);
  const access = new VideoAccess();
  assert.equal((await access.respond(new Request('media://video/unknown'))).status, 404);
  const video = await access.select(file);
  const read = (range, method = 'GET') =>
    access.respond(
      new Request(video.url, { method, headers: range ? { Range: range } : undefined }),
    );
  const part = await read('bytes=2-5');
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('Content-Range'), 'bytes 2-5/16');
  assert.equal(await part.text(), '2345');
  const suffix = await read('bytes=-3');
  assert.equal(await suffix.text(), 'def');
  assert.equal(await (await read('bytes=12-999')).text(), 'cdef');
  assert.equal(await (await read('bytes=12-')).text(), 'cdef');
  for (const range of [
    'bytes=16-',
    'bytes=-0',
    'bytes=7-2',
    'bytes=0-1,3-4',
    'bytes=9007199254740992-',
    'nonsense',
  ]) {
    const result = await read(range);
    assert.equal(result.status, 416, range);
    assert.equal(result.headers.get('Content-Range'), 'bytes */16');
  }
  const head = await read(null, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Length'), '16');
  assert.equal(await head.text(), '');
  assert.equal((await read(null, 'POST')).status, 405);
  assert.equal((await access.respond(new Request(`${video.url}/../../anything`))).status, 404);
  assert.equal((await access.respond(new Request(`${video.url}?path=secret`))).status, 404);
  await assert.rejects(access.select(path.join(directory, 'missing.mp4')));
  assert.equal(await (await read()).text(), bytes.toString());
  await access.select(file);
  assert.equal((await read()).status, 404);
  const current = await access.select(file);
  for (const origin of ['app://virtual-cut', 'http://127.0.0.1:5173', 'https://example.com']) {
    const response = await access.respond(
      new Request(current.url, { method: 'HEAD', headers: { Origin: origin } }),
    );
    assert.equal(
      response.headers.get('Access-Control-Allow-Origin'),
      origin === 'https://example.com' ? null : origin,
    );
  }
  access.clear();
  assert.equal((await access.respond(new Request(current.url))).status, 404);
  const after = await stat(file);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
});
