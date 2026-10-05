import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startScan } from '../src/workflow/scanPlayback.ts';

/** A video stand-in: seeks stay pending until the test lands them with `land()`. */
function fakeVideo(start, { pending = true } = {}) {
  let time = start;
  const listeners = new Set();
  const video = {
    writes: [],
    pause() {},
    seeking: false,
    readyState: 2,
    get currentTime() {
      return time;
    },
    set currentTime(at) {
      assert(!this.seeking, 'One seek in flight at a time');
      time = at;
      this.writes.push(at);
      if (pending) this.seeking = true;
    },
    addEventListener(type, fn) {
      if (type === 'seeked') listeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === 'seeked') listeners.delete(fn);
    },
    /** Finish the pending seek the way the browser does: seeking clears, then `seeked`. */
    land() {
      this.seeking = false;
      for (const fn of [...listeners]) fn();
    },
    get listeners() {
      return listeners.size;
    },
  };
  return video;
}

test('scanning serializes seeks, follows elapsed time, respects source offset and stops cleanly', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let wall = 0,
    ends = 0;
  t.mock.method(performance, 'now', () => wall);
  const video = fakeVideo(25);
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
  assert.equal(video.currentTime, 27);
  advance(800);
  assert.equal(video.writes.length, 1, 'A slow seek is never replaced by another one');
  wall += 83;
  video.land();
  assert(
    video.currentTime >= 39,
    'Scan catches up to wall time rather than replaying a seek backlog',
  );
  wall += 500;
  video.land();
  assert.equal(video.currentTime, 44.999);
  video.land();
  assert.equal(ends, 1);
  assert.equal(video.listeners, 0, 'Cancel stops listening for seeks');
  const before = video.writes.length;
  advance(1000);
  assert.equal(video.writes.length, before);
});

test('the next seek starts as soon as the previous one lands, not on a fixed timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let wall = 0;
  t.mock.method(performance, 'now', () => wall);
  const video = fakeVideo(100);
  const scan = startScan({
    video,
    direction: -1,
    rate: 1,
    offset: 0,
    keys: [],
    range: () => ({ start: 0, end: 200, looping: false }),
    onPosition() {},
    onEnd() {
      assert.fail('The range is long enough');
    },
  });
  // Each seek takes 20 ms. Landing it starts the next one straight away, with no timer
  // involved: about 50 seeks a second, where the 83 ms timer allowed 12.
  for (let i = 0; i < 50; i++) {
    wall += 20;
    video.land();
  }
  assert(video.writes.length >= 45, `${video.writes.length} seeks in one second`);
  assert(Math.abs(video.currentTime - 99) < 0.03, 'Reverse 1× moved one second back');
  scan.cancel();
});

test('a watchdog continues the scan if a seek never reports landing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let wall = 0;
  t.mock.method(performance, 'now', () => wall);
  const video = fakeVideo(100);
  const scan = startScan({
    video,
    direction: -1,
    rate: 1,
    offset: 0,
    keys: [],
    range: () => ({ start: 0, end: 200, looping: false }),
    onPosition() {},
    onEnd() {},
  });
  wall += 20;
  t.mock.timers.tick(20);
  assert.equal(video.writes.length, 1);
  // The seek finishes but no event arrives.
  video.seeking = false;
  wall += 300;
  t.mock.timers.tick(300);
  assert.equal(video.writes.length, 2);
  scan.cancel();
});

test('reverse loops remain inside selected bounds, including after bounds change', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let wall = 0;
  t.mock.method(performance, 'now', () => wall);
  let range = { start: 10, end: 12, looping: true };
  const video = fakeVideo(17.2);
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
    video.land();
    assert(video.currentTime >= 17 && video.currentTime < 19);
  }
  range = { start: 12, end: 14, looping: true };
  for (let i = 0; i < 5; i++) {
    wall += 83;
    t.mock.timers.tick(83);
    video.land();
    assert(video.currentTime >= 19 && video.currentTime < 21);
  }
  scan.cancel();
  const before = video.writes.length;
  wall += 1000;
  t.mock.timers.tick(1000);
  assert.equal(video.writes.length, before);
});
