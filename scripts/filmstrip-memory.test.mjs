import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FilmstripMemory,
  filmstripSource,
  filmstripTiles,
} from '../src/workflow/filmstripMemory.ts';

const recording = (id, extra = {}) => ({
  id,
  url: `media://${id}`,
  availability: 'ready',
  duration: 400,
  ...extra,
});
const jpeg = 'data:image/jpeg;base64,' + Buffer.alloc(1000, 42).toString('base64');
const frame = (requested) => ({ requested, time: requested, data: jpeg });

test('tiles remain source-aligned through pans, direction changes, fractional clocks and extremes', () => {
  for (const count of [1, 5, 16, 31]) {
    for (const span of [0.1, 31.34567, 432.283]) {
      const a = filmstripTiles(20, 20 + span, count, 1000);
      const b = filmstripTiles(20 + span / 4, 20 + span * 1.25, count, 1000);
      assert(b.length <= 32);
      const common = b.filter((tile) => a.some((t) => t.requested === tile.requested));
      assert(common.length >= Math.floor(count * 0.5));
      for (const tile of common) {
        assert.deepEqual(
          tile,
          a.find((t) => t.requested === tile.requested),
        );
      }
      assert.deepEqual(filmstripTiles(20, 20 + span, count, 1000), a);
    }
  }
  const last = filmstripTiles(9.1, 10, 7, 10).at(-1);
  assert.equal(last.right, 10);
  assert(last.requested < 10);
});

test('overview revisit, bounded details, explicit URL release and invalidation', async () => {
  const memory = new FilmstripMemory();
  const recordings = Array.from({ length: 30 }, (_, i) => recording(String(i)));
  memory.sync('p', recordings);
  const a = filmstripSource('p', recordings[0]);
  const times = Array.from({ length: 16 }, (_, i) => i);
  memory.put(a, times.map(frame), true, times);
  const original = memory.get(a, 0).data;
  for (let i = 1; i < 30; i++) {
    const source = filmstripSource('p', recordings[i]);
    memory.put(source, times.map(frame), false, times);
    assert(memory.stats().entries <= 192);
    assert(memory.stats().bytes <= 24 * 1024 * 1024);
  }
  assert.equal(memory.get(a, 0).data, original, 'Overview retained ahead of old zoom detail');
  assert((await fetch(original)).ok);
  memory.sync(
    'p',
    recordings.map((r, i) => (i === 0 ? { ...r, sourceModified: 999 } : r)),
  );
  assert.equal(memory.get(a, 0), undefined);
  await assert.rejects(fetch(original), 'Evicted image URL revoked');
  memory.put(a, [frame(0)], true, [0]);
  assert.equal(memory.get(a, 0), undefined, 'Late old-source response rejected');
  const other = filmstripSource('p', recordings[29]);
  const url = memory.get(other, 0).data;
  memory.sync('', []);
  assert.deepEqual(memory.stats(), { entries: 0, bytes: 0 });
  await assert.rejects(fetch(url));
});

test('overview pressure also evicts, removal and project change drop all old identities', () => {
  const memory = new FilmstripMemory();
  const recordings = Array.from({ length: 40 }, (_, i) => recording(String(i)));
  memory.sync('p', recordings);
  const times = Array.from({ length: 32 }, (_, i) => i);
  for (const r of recordings) memory.put(filmstripSource('p', r), times.map(frame), true, times);
  assert(memory.stats().entries <= 192 && memory.stats().bytes <= 24 * 1024 * 1024);
  assert.equal(memory.get(filmstripSource('p', recordings[0]), 0), undefined);
  memory.sync('p', []);
  assert.equal(memory.stats().entries, 0);
  memory.sync('p', recordings);
  memory.put(filmstripSource('p', recordings[0]), [frame(0)], true, [0]);
  memory.sync('other', recordings);
  assert.equal(memory.stats().entries, 0);
});
