import test from 'node:test';
import assert from 'node:assert/strict';
import { autosaveSettings, autosaveDue } from '../src/workflow/autosave.ts';
import { changes, applyChange } from '../electron/project-changes.ts';
import { emptyModel, mergeEdits, validateEdits } from '../electron/project-edits.ts';

const editFixture = () => ({
  ...emptyModel(),
  recordings: [
    {
      id: 'r',
      title: 'Source',
      context: '',
      duration: 10,
      position: 0,
      audioTracks: [{ index: 1 }, { index: 2 }],
      gameTrack: 1,
      micTrack: 2,
    },
  ],
  clips: [{ id: 'a', rid: 'r', name: 'A', start: 1, end: 4, folder: '_Review' }],
  markers: { r: [{ id: 'm', time: 2, name: 'M', category: 'Context' }] },
});

test('save validation rejects missing marker sources, foreign audio and invalid context', () => {
  for (const [change, message] of [
    [
      (m) => {
        m.markers.missing = m.markers.r;
      },
      /Marker source is missing/,
    ],
    [
      (m) => {
        m.recordings[0].gameTrack = 8;
      },
      /audio track belonging/,
    ],
    [
      (m) => {
        m.recordings[0].micTrack = 1;
      },
      /different tracks/,
    ],
    [
      (m) => {
        m.recordings[0].pinned = 'file:///private.png';
      },
      /context or pinned/,
    ],
    [
      (m) => {
        m.scratchpad = 'x'.repeat(100001);
      },
      /Invalid project edit/,
    ],
    [
      (m) => {
        m.markers.r.push({ ...m.markers.r[0], time: 3 });
      },
      /Invalid marker/,
    ],
  ]) {
    const model = editFixture();
    change(model);
    assert.throws(() => validateEdits(model), message);
  }
  assert.doesNotThrow(() => validateEdits(editFixture()));
});

test('stale note/source edits and duplicate clip identities cannot overwrite current work', () => {
  const before = editFixture();
  const after = structuredClone(before),
    current = structuredClone(before);
  after.clips.push({ ...after.clips[0] });
  assert.throws(() => mergeEdits(before, after, current), /Duplicate item identity/);
  after.clips.pop();
  after.scratchpad = 'My draft';
  current.scratchpad = 'Other writer';
  assert.throws(() => mergeEdits(before, after, current), /Project notes changed elsewhere/);
  after.scratchpad = before.scratchpad;
  after.recordings[0].context = 'Draft context';
  current.recordings[0].context = 'Newer context';
  const preserved = structuredClone(current);
  assert.throws(() => mergeEdits(before, after, current), /recording changed elsewhere/);
  assert.deepEqual(current, preserved, 'Rejected merge leaves current work unchanged');
});

test('reordering a draft preserves concurrently imported clips and recordings', () => {
  const before = editFixture();
  before.clips.push({ ...before.clips[0], id: 'b' });
  const after = structuredClone(before),
    current = structuredClone(before);
  after.clips.reverse();
  current.clips.push({ ...before.clips[0], id: 'imported' });
  current.recordings.push({ ...before.recordings[0], id: 'new-source' });
  const result = mergeEdits(before, after, current);
  assert.deepEqual(
    result.clips.map((c) => c.id),
    ['b', 'a', 'imported'],
  );
  assert.equal(result.recordings.at(-1).id, 'new-source');
});

test('ten-minute default, interval validation, activity and navigation guards', () => {
  const settings = autosaveSettings(null);
  assert.deepEqual(settings, { minutes: 10, afterEdits: false });
  for (const bad of [0, -1, NaN, 1000, '1'])
    assert.equal(autosaveSettings({ minutes: bad }).minutes, 10);
  assert.equal(autosaveDue(settings, 599999, 0, 0, false, true, true), false);
  assert.equal(autosaveDue(settings, 600000, 0, 0, false, true, true), true);
  assert.equal(autosaveDue(settings, 900000, 0, 0, true, true, true), false);
  assert.equal(autosaveDue(settings, 900000, 0, 899000, false, true, true), false);
  assert.equal(autosaveDue(settings, 900000, 0, 0, false, false, false), false);
  const frequent = { minutes: 10, afterEdits: true };
  assert.equal(autosaveDue(frequent, 3000, 0, 0, false, true, true), true);
  assert.equal(autosaveDue(frequent, 3000, 0, 0, false, true, false), false);
  assert.equal(autosaveDue(settings, 900000, 600000, 0, false, true, true), false);
});

test('small changes preserve unrelated native facts and ordered deletion Undo', () => {
  const before = {
    clips: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    notes: '',
  };
  const after = { clips: [{ id: 'b', name: 'Edited' }], notes: 'note' };
  const change = changes(before, after);
  assert.deepEqual(applyChange(before, change), after);
  const current = { ...after, clips: [...after.clips, { id: 'c', name: 'Imported' }] };
  assert.deepEqual(applyChange(current, change, true), {
    ...before,
    clips: [...before.clips, { id: 'c', name: 'Imported' }],
  });
  assert.deepEqual(
    applyChange(before, changes(after, { ...after, clips: [{ id: 'b', name: 'Native' }] })),
    {
      ...before,
      clips: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'Native' },
      ],
    },
  );
});
