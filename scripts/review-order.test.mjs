import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  reviewRows,
  sortReview,
  groupReview,
  inReviewFolder,
  reviewFolderKey,
} from '../src/workflow/reviewOrder.ts';

const clips = [
  { id: 'c3', rid: 'r1', name: 'Third', start: 20, end: 30, folder: 'A' },
  { id: 'c1', rid: 'r2', name: 'First', start: 0, end: 10, folder: 'A' },
  { id: 'c2', rid: 'r1', name: 'Second', start: 10, end: 20, folder: 'B' },
  { id: 'unknown', rid: 'r3', name: 'Unknown', start: 0, end: 10, folder: 'B' },
];
const records = [
  { id: 'r1', sourceModified: 10000 },
  { id: 'r2', sourceModified: 10000 },
  { id: 'r3' },
];
test('Review preserves global chronology or groups once by explicit choice; model stays intact', () => {
  const before = structuredClone(clips);
  const rows = sortReview(reviewRows(clips, records), 'date-asc');
  assert.deepEqual(
    rows.map((c) => c.id),
    ['c1', 'c2', 'c3', 'unknown'],
  );
  assert.deepEqual(
    groupReview(rows, 'sequence').map((g) => [g.location.folder, g.rows.map((c) => c.id)]),
    [
      ['A', ['c1']],
      ['B', ['c2']],
      ['A', ['c3']],
      ['B', ['unknown']],
    ],
  );
  assert.deepEqual(
    groupReview(rows, 'folders').map((g) => [g.location.folder, g.rows.map((c) => c.id)]),
    [
      ['A', ['c1', 'c3']],
      ['B', ['c2', 'unknown']],
    ],
  );
  assert.deepEqual(
    sortReview(rows, 'date-desc').map((c) => c.id),
    ['c3', 'c2', 'c1', 'unknown'],
  );
  assert.deepEqual(
    sortReview(rows, 'name').map((c) => c.id),
    ['c1', 'c2', 'c3', 'unknown'],
  );
  assert.equal(new Set(rows.map((c) => reviewFolderKey(c.location))).size, 2);
  assert.deepEqual(clips, before);
});
test('Equal dates have deterministic name/ID ties; zero date is valid; unavailable dates stay last', () => {
  const rows = reviewRows(
    [
      { ...clips[0], id: 'b', name: 'Same', start: 0 },
      { ...clips[0], id: 'a', name: 'Same', start: 0 },
      { ...clips[0], id: 'z', rid: 'missing' },
    ],
    [{ id: 'r1', sourceModified: 0 }],
  );
  for (const order of ['date-asc', 'date-desc'])
    assert.deepEqual(
      sortReview(rows, order).map((c) => c.id),
      ['a', 'b', 'z'],
    );
  assert.equal(rows[0].modified, 0);
  assert.equal(rows[2].modified, undefined);
});
test('Only a current verified available Done revision supplies a filed location; later draft retains its plan', () => {
  const c = { ...clips[0], filed: true };
  const receipt = (id, current, updated) => ({
    plan: { id, clipId: c.id, requested: { start: 20 } },
    input: { sourceModified: 10000 },
    filing: { state: 'complete' },
    state: 'verified',
    current,
    updated,
  });
  const exports = [
    receipt('old', false, '2026-01-03'),
    receipt('current', true, '2026-01-02'),
    receipt('earlier', true, '2026-01-01'),
  ];
  const library = [
    { exportId: 'old', folder: 'Wrong', output: 'wrong', available: true, metadataAvailable: true },
    {
      exportId: 'current',
      folder: 'G:\\Finished\\Moved',
      output: 'G:\\Finished\\Moved\\Third.mp4',
      available: true,
      metadataAvailable: true,
    },
    {
      exportId: 'earlier',
      folder: 'Earlier',
      output: 'earlier',
      available: true,
      metadataAvailable: true,
    },
  ];
  const row = reviewRows([c], records, exports, library)[0];
  assert.equal(row.location.exportId, 'current');
  assert.equal(row.location.external, true);
  assert.equal(row.folder, 'A');
  assert.equal(inReviewFolder(row, 'A'), false);
  assert.equal(inReviewFolder(row, reviewFolderKey(row.location)), true);
  assert.equal(
    reviewRows([{ ...c, filed: false }], records, exports, library)[0].location.folder,
    'A',
  );
  library[1].metadataAvailable = false;
  assert.equal(reviewRows([c], records, exports, library)[0].location.exportId, 'earlier');
  exports[2].current = false;
  assert.equal(reviewRows([c], records, exports, library)[0].location.folder, 'A');
});
test('Root-relative locations and nested folder filtering remain distinct from external paths', () => {
  const rows = reviewRows([{ ...clips[0], folder: 'A/Nested' }, clips[2]], records);
  assert(inReviewFolder(rows[0], 'A'));
  assert(!inReviewFolder(rows[1], 'A'));
  assert(rows.every((c) => inReviewFolder(c, '')));
});
