import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startScan } from '../src/workflow/scanPlayback.ts';

test('scanning serializes seeks, follows elapsed time, respects source offset and stops cleanly', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let wall = 0,
    time = 25,
    ends = 0,
    writes = [];
  t.mock.method(performance, 'now', () => wall);
  const video = {
    pause() {},
    seeking: false,
    readyState: 2,
    get currentTime() {
      return time;
    },
    set currentTime(at) {
      assert(!this.seeking);
      time = at;
      writes.push(at);
      this.seeking = true;
    },
  };
  const advance = (ms) => {
    wall += ms;
    t.mock.timers.tick(ms);
  };
  const scan = startScan({
    video,
    direction: 1,
    rate: 16,
    offset: 5,
    keys: [20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40],
    range: () => ({ start: 20, end: 40, looping: false }),
    onPosition() {},
    onEnd() {
      ends++;
      scan.cancel();
    },
  });
  advance(83);
  assert.equal(time, 27);
  advance(800);
  assert.equal(writes.length, 1, 'A slow seek is never replaced by another one');
  video.seeking = false;
  advance(83);
  assert(time >= 39, 'Scan catches up to wall time rather than replaying a seek backlog');
  video.seeking = false;
  advance(500);
  assert.equal(time, 44.999);
  video.seeking = false;
  advance(83);
  assert.equal(ends, 1);
  const before = writes.length;
  advance(1000);
  assert.equal(writes.length, before);
});

test('reverse loops remain inside selected bounds, including after bounds change', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let wall = 0,
    time = 17.2,
    writes = [];
  t.mock.method(performance, 'now', () => wall);
  let range = { start: 10, end: 12, looping: true };
  const video = {
    pause() {},
    seeking: false,
    readyState: 2,
    get currentTime() {
      return time;
    },
    set currentTime(at) {
      time = at;
      writes.push(at);
    },
  };
  const scan = startScan({
    video,
    direction: -1,
    rate: 16,
    offset: 7,
    keys: [10, 11, 12, 13, 14],
    range: () => range,
    onPosition() {},
    onEnd() {
      assert.fail('A loop should not end');
    },
  });
  for (let i = 0; i < 5; i++) {
    wall += 83;
    t.mock.timers.tick(83);
    assert(time >= 17 && time < 19);
  }
  range = { start: 12, end: 14, looping: true };
  for (let i = 0; i < 5; i++) {
    wall += 83;
    t.mock.timers.tick(83);
    assert(time >= 19 && time < 21);
  }
  scan.cancel();
  const before = writes.length;
  wall += 1000;
  t.mock.timers.tick(1000);
  assert.equal(writes.length, before);
});
