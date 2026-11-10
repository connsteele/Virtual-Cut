import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { autosaveSettings, autosaveDue } from '../src/workflow/autosave.ts';
import { changes, applyChange } from '../electron/project-changes.ts';
import {
  editorial,
  emptyModel,
  mergeEdits,
  validateEdits,
} from '../dist-electron/project-edits.js';

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
    [
      (m) => {
        // A marker color name is not a Resolve clip color (VC-207).
        m.clips[0].color = 'Cyan';
      },
      /Invalid clip color/,
    ],
  ]) {
    const model = editFixture();
    change(model);
    assert.throws(() => validateEdits(model), message);
  }
  assert.doesNotThrow(() => validateEdits(editFixture()));
  const colored = editFixture();
  colored.clips[0].color = 'Apricot';
  assert.equal(validateEdits(colored).clips[0].color, 'Apricot');
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

test('the Original/Proxy switch is saved like navigation, never as an edit (VC-238)', () => {
  const before = editFixture(),
    after = { ...structuredClone(before), viewerSource: 'original' },
    current = structuredClone(before);
  assert.equal(mergeEdits(before, after, current).viewerSource, 'original');
  assert.equal(
    mergeEdits(before, before, { ...current, viewerSource: 'proxy' }).viewerSource,
    'proxy',
  );
  assert.equal(editorial(after), editorial(before), 'no undo step and no unsaved edit');
  assert.doesNotThrow(() => validateEdits({ ...editFixture(), viewerSource: 'proxy' }));
  assert.throws(() => validateEdits({ ...editFixture(), viewerSource: 'both' }), /viewer source/);
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

test('a clip color reaches the companion in its own optional section (VC-207)', async () => {
  // require, not import: under --coverage the instrumented CommonJS module can't load its
  // ES module neighbours through Node's import-to-CommonJS bridge.
  const { annotation } = createRequire(import.meta.url)('../dist-electron/clip-export.cjs');
  const record = (color) => ({
    annotationVersion: 4,
    plan: {
      id: 'p',
      created: '2026-11-06T00:00:00.000Z',
      requested: { start: 1, end: 4 },
      planned: { start: 0, end: 5 },
      name: 'A',
    },
    input: {
      clip: { ...editFixture().clips[0], include: true, ...(color ? { color } : {}) },
      markers: [],
      context: '',
      gameTrack: 1,
      sourceFile: 'source.mkv',
      sourceFingerprint: 'f',
      sourceBytes: 1,
      sourceModified: 0,
      sourceStart: 0,
      duration: 10,
    },
  });
  const verified = { actual: { start: 0, end: 5 }, timestampShift: 0 };
  const colored = JSON.parse(annotation(record('Teal'), verified));
  assert.equal(colored.version, 4, 'the receipt version stays put');
  assert.deepEqual(
    {
      schema: colored.clipColor.schema,
      version: colored.clipColor.version,
      name: colored.clipColor.name,
    },
    { schema: 'virtual-cut-clip-color', version: 1, name: 'Teal' },
  );
  assert.equal('color' in colored.clip, false, 'the section is the one place the color lives');
  const plain = JSON.parse(annotation(record(), verified));
  assert.equal('clipColor' in plain, false);
});

test('an export queued before VC-208 keeps its old marker scope; a new one keeps its own', () => {
  const { annotation } = createRequire(import.meta.url)('../dist-electron/clip-export.cjs');
  const marker = (id, time) => ({ id, time, name: id, category: 'Context', topic: '' });
  const record = (markerScope) => ({
    annotationVersion: 4,
    ...(markerScope ? { markerScope } : {}),
    plan: {
      id: 'p',
      created: '2026-11-06T00:00:00.000Z',
      container: 'mp4',
      requested: { start: 1, end: 4 },
      planned: { start: 0, end: 5 },
      name: 'A',
    },
    input: {
      clip: { ...editFixture().clips[0], include: true },
      // Out of time order, and "padding" sits in the outward keyframe padding before the in-point.
      markers: [marker('inside', 2), marker('padding', 0.5)],
      context: '',
      gameTrack: 1,
      sourceFile: 'source.mkv',
      sourceFingerprint: 'f',
      sourceBytes: 1,
      sourceModified: 0,
      sourceStart: 0,
      duration: 10,
    },
  });
  const verified = { actual: { start: 0, end: 5 }, timestampShift: 0 };
  const old = JSON.parse(annotation(record(), verified));
  assert.deepEqual(
    old.markers.map((m) => m.id).sort(),
    ['inside', 'padding'],
    'a companion re-written for an older export reproduces its padding markers',
  );
  assert.equal(old.generatedChapters.length, 1, 'MP4 chapters lead with a neutral Clip start');
  const own = JSON.parse(annotation(record('clip'), verified));
  assert.deepEqual(
    own.markers.map((m) => m.id),
    ['inside'],
  );
});
