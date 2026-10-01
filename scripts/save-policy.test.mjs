import test from 'node:test';
import assert from 'node:assert/strict';
import { autosaveSettings, autosaveDue } from '../src/workflow/autosave.ts';
import { changes, applyChange } from '../electron/project-changes.ts';

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
