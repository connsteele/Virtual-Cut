import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  addSubmission,
  batchOf,
  finalState,
  removedSpans,
  settleExports,
} from '../dist-electron/batch-record.js';
import { batchRecordAnswer, AgentReadError } from '../dist-electron/agent-tools.js';
import { applyProposalCommand } from '../dist-electron/proposal-edits.js';
import { emptyModel } from '../dist-electron/project-edits.js';
import { require } from './shared.mjs';

// Batch records (VC-182): the agent's first pass is frozen when its proposals land, and the
// state at export links each clip, marker and note to its proposal or to the user.
const project = { id: 'p1', name: 'Fortune' };
const batch = { id: 'b1', name: 'Cai' };
const recording = {
  id: 'r1',
  title: 'Cai session 1',
  url: '',
  frames: [],
  base: 0,
  duration: 200,
  position: 0,
  sample: false,
  context: '',
  batchIds: ['b1'],
};
let model = {
  ...emptyModel(),
  recordings: [
    recording,
    { ...recording, id: 'r2', title: 'Other batch', batchIds: ['b2'] },
    { ...recording, id: 'r3', title: 'Sample', sample: true },
  ],
  clips: [
    { id: 'c1', rid: 'r1', name: 'Whole', start: 0, end: 200, folder: '_Review', include: true },
  ],
  markers: { r1: [{ id: 'm0', time: 5, name: 'Earlier', category: 'Context', topic: '' }] },
};
const proposal = (id, kind, extra = {}) => ({
  id,
  sourceId: 'r1',
  kind,
  time: 16,
  title: id,
  text: '',
  reason: 'why',
  evidence: [],
  agent: { clientId: 'cl', name: 'Claude Code', model: 'check-model' },
  submitted: '2026-10-15T01:00:00Z',
  submissionId: 's1',
  projectRevision: 3,
  ...extra,
});
const first = [
  proposal('p1', 'mark', { title: 'Bertrand', intents: ['marker', 'general'] }),
  proposal('p2', 'cut', { time: 100, title: 'Siege ends', names: { first: 'A', second: 'B' } }),
  proposal('p3', 'clip', { time: 120, end: 150, title: 'Siege' }),
  proposal('p4', 'note', { time: 40, title: 'Remember', text: 'For the video notes' }),
];
const read = {
  intentGuideVersion: '1',
  transcripts: [{ role: 'mic', transcriptId: 'mic-1', corrections: 2 }],
  projectRevision: 3,
};
let record = addSubmission(undefined, {
  project,
  batch,
  model,
  proposals: first,
  stored: first,
  runIntent: 'mic intent pass',
  ...read,
  now: '2026-10-15T01:00:01Z',
});
assert.equal(record.recordVersion, 1);
assert.deepEqual(record.runs[0], {
  submissionId: 's1',
  recordingId: 'r1',
  submitted: '2026-10-15T01:00:00Z',
  agent: 'Claude Code',
  model: 'check-model',
  intent: 'mic intent pass',
  proposals: 4,
  read,
});
assert.equal(record.firstPass[0].frozen, '2026-10-15T01:00:01Z');
assert.deepEqual(
  record.firstPass[0].before.clips.map((c) => [c.id, c.start, c.end]),
  [['c1', 0, 200]],
);
assert.deepEqual(
  record.firstPass[0].proposals.map((p) => [p.id, p.kind, p.time, p.end, p.clipNames]),
  [
    ['p1', 'marker', 16, undefined, undefined],
    ['p2', 'split', 100, undefined, { first: 'A', second: 'B' }],
    ['p3', 'clip', 120, 150, undefined],
    ['p4', 'note', 40, undefined, undefined],
  ],
);
assert.deepEqual(record.firstPass[0].proposals[0].intents, ['marker', 'general']);

// The user decides on the card: p1 moved and retitled, p2 split with the names chosen, p3
// rejected, p4 left pending.
let n = 0;
const newId = () => `new${++n}`;
const decide = (p, action, extra = {}) => {
  model = applyProposalCommand(
    model,
    p,
    {
      action,
      proposalId: p.id,
      sourceId: 'r1',
      projectId: 'p1',
      transcriptId: '',
      segmentId: 0,
      expected: 'null',
      ...extra,
    },
    newId,
    '2026-10-15T01:05:00Z',
  );
};
decide(first[0], 'accept-proposal', { time: 16.5, title: 'Bertrand at the gate' });
decide(first[1], 'accept-proposal', { firstName: 'Fort', secondName: 'Talk' });
decide(first[2], 'reject-proposal');

// A later submission is a run, but not first pass.
const late = [proposal('p5', 'mark', { time: 170, title: 'Late', submissionId: 's2' })];
record = addSubmission(record, {
  project,
  batch,
  model,
  proposals: late,
  stored: [...first, ...late],
  ...read,
  now: '2026-10-15T01:06:00Z',
});
assert.equal(record.runs[1].afterDecisions, true);
assert.equal(record.runs[1].intent, undefined);
assert.equal(record.firstPass[0].proposals.length, 4);

// After accepting: the marker renamed, the second clip trimmed, a missed marker added, the
// earlier marker removed.
const marker = model.markers.r1.find((m) => m.id === 'new1');
marker.name = 'Bertrand, gate';
model.clips.find((c) => c.id === 'new2').end = 180;
model.markers.r1 = model.markers.r1.filter((m) => m.id !== 'm0');
model.markers.r1.push({ id: 'u1', time: 60, name: 'Missed', category: 'Context', topic: '' });
model.notes.push({ id: 'n9', sourceId: 'r2', title: 'Other', text: '', url: '' });
const exports = [
  {
    plan: {
      id: 'e1',
      clipId: 'c1',
      sourceId: 'r1',
      name: 'Fort',
      requested: { start: 0, end: 100 },
    },
    state: 'verified',
  },
  {
    plan: { id: 'e2', clipId: 'x', sourceId: 'r2', name: 'Other', requested: { start: 0, end: 1 } },
    state: 'queued',
  },
  {
    plan: { clipId: 'new2', sourceId: 'r1', name: 'Talk', requested: { start: 100, end: 180 } },
    state: 'planned',
  },
];
const exported = finalState(record, {
  project,
  batch,
  model,
  proposals: [...first, ...late, proposal('q', 'mark', { sourceId: 'r2' })],
  exports,
  projectRevision: 9,
  now: '2026-10-15T02:00:00Z',
});
assert.equal(exported.final.projectRevision, 9);
const [r1] = exported.final.recordings;
assert.equal(exported.final.recordings.length, 1, 'only the batch, never samples');
assert.deepEqual(
  r1.clips.map((c) => [c.id, c.name, c.start, c.end, c.origin, c.splitBy, c.changed]),
  [
    ['c1', 'Fort', 0, 100, 'before-first-pass', 'p2', undefined],
    ['new2', 'Talk', 100, 180, { proposalId: 'p2' }, undefined, { end: { from: 200, to: 180 } }],
  ],
);
assert.deepEqual(
  r1.markers.map((m) => [m.id, m.origin, m.changed]),
  [
    [
      'new1',
      { proposalId: 'p1' },
      { name: { from: 'Bertrand at the gate', to: 'Bertrand, gate' } },
    ],
    ['u1', 'user', undefined],
  ],
);
assert.deepEqual(r1.removedItems, [{ kind: 'marker', id: 'm0', origin: 'before-first-pass' }]);
assert.deepEqual(r1.removedSpans, [{ start: 180, end: 200 }]);
assert.deepEqual(
  exported.final.proposals.map((p) => [p.id, p.status, p.firstPass, p.chosen]),
  [
    ['p1', 'accepted', true, { time: 16.5, title: 'Bertrand at the gate', note: '' }],
    ['p2', 'accepted', true, { time: 100, clipNames: { first: 'Fort', second: 'Talk' } }],
    ['p3', 'rejected', true, undefined],
    ['p4', 'pending', true, undefined],
    ['p5', 'pending', false, undefined],
  ],
);
assert.deepEqual(exported.final.exports, [
  { exportId: 'e1', clipId: 'c1', name: 'Fort', start: 0, end: 100, state: 'verified' },
]);
assert(JSON.stringify(exported).length < 10000, 'a few KB, no media');

// Undoing accepted work by hand: the accepted note removed, the split clip renamed.
decide(first[3], 'accept-proposal', { time: 41 });
const noteId = model.cueDecisions.find((d) => d.proposalId === 'p4').noteId;
model.notes = model.notes.filter((x) => x.id !== noteId);
model.clips.find((c) => c.id === 'c1').name = 'Fort gate';
const again = finalState(exported, {
  project,
  batch,
  model,
  proposals: first,
  exports: [],
  projectRevision: 10,
  now: '2026-10-15T02:10:00Z',
});
assert.deepEqual(again.final.recordings[0].removedItems[0], {
  kind: 'note',
  id: noteId,
  origin: { proposalId: 'p4' },
});
assert.deepEqual(again.final.recordings[0].clips[0].changed, {
  name: { from: 'Fort', to: 'Fort gate' },
});

// Proposals older than batch records: the first pass is rebuilt from them, without a before.
const rebuilt = finalState(undefined, {
  project,
  batch,
  model: { ...model, clips: [] },
  proposals: first,
  exports: [],
  projectRevision: 10,
  now: '2026-10-15T02:20:00Z',
});
assert.equal(rebuilt.firstPass[0].frozen, '2026-10-15T01:00:00Z');
assert.equal(rebuilt.firstPass[0].before, undefined);
assert.equal(rebuilt.final.recordings[0].removedSpans, undefined, 'no clips, no removed spans');
assert.deepEqual(
  rebuilt.final.recordings[0].removedItems.map((x) => [x.kind, x.origin.proposalId]),
  [
    ['clip', 'p2'],
    ['note', 'p4'],
  ],
);
assert.deepEqual(
  rebuilt.final.recordings[0].markers.map((m) => [m.origin, m.changed]),
  [
    [{ proposalId: 'p1' }, { name: { from: 'Bertrand at the gate', to: 'Bertrand, gate' } }],
    ['user', undefined],
  ],
);

assert.deepEqual(
  removedSpans(10, [
    { start: 2, end: 4, include: true },
    { start: 3, end: 5, include: true },
    { start: 6, end: 10, include: false },
  ]),
  [
    { start: 0, end: 2 },
    { start: 5, end: 10 },
  ],
);
// VC-186: a clip range accepted as a range marker is the agent's suggestion, kept as a range:
// the marker links to it, the proposal carries the kind change, and removing the marker later
// lists a marker, not a clip.
{
  const clip = proposal('p6', 'clip', { time: 20, end: 30, title: 'Fort scene', text: 'Part' });
  const base = { ...emptyModel(), recordings: [recording] };
  const kept = applyProposalCommand(
    base,
    clip,
    {
      action: 'accept-proposal',
      proposalId: clip.id,
      sourceId: 'r1',
      projectId: 'p1',
      transcriptId: '',
      segmentId: 0,
      expected: 'null',
      acceptAs: 'range-marker',
    },
    () => 'range1',
    '2026-10-15T03:00:00Z',
  );
  const input = {
    project,
    batch,
    proposals: [clip],
    exports: [],
    projectRevision: 12,
    now: '2026-10-15T03:05:00Z',
  };
  const ranged = finalState(undefined, { ...input, model: kept });
  assert.deepEqual(
    ranged.final.recordings[0].markers.map((m) => [m.id, m.time, m.end, m.name, m.origin]),
    [['range1', 20, 30, 'Fort scene', { proposalId: 'p6' }]],
  );
  assert.deepEqual(ranged.final.recordings[0].clips, []);
  assert.deepEqual(ranged.final.proposals[0], {
    id: 'p6',
    status: 'accepted',
    decided: '2026-10-15T03:00:00Z',
    chosen: { time: 20, end: 30, title: 'Fort scene', note: 'Part' },
    kindChange: { from: 'clip-range', to: 'range-marker' },
    firstPass: true,
  });
  assert.equal(ranged.firstPass[0].proposals[0].kind, 'clip', 'the first pass keeps what it was');
  const gone = finalState(undefined, { ...input, model: { ...kept, markers: { r1: [] } } });
  assert.deepEqual(gone.final.recordings[0].removedItems, [
    { kind: 'marker', id: 'range1', origin: { proposalId: 'p6' } },
  ]);
  // The reverse: a range marker kept as a clip links the clip to the suggestion.
  const range = proposal('p7', 'mark', { time: 40, end: 60, title: 'Talk', text: 'Part' });
  const asClip = applyProposalCommand(
    base,
    range,
    {
      action: 'accept-proposal',
      proposalId: range.id,
      sourceId: 'r1',
      projectId: 'p1',
      transcriptId: '',
      segmentId: 0,
      expected: 'null',
      acceptAs: 'clip',
    },
    () => 'clip1',
    '2026-10-15T03:00:00Z',
  );
  const clipped = finalState(undefined, { ...input, proposals: [range], model: asClip });
  assert.deepEqual(
    clipped.final.recordings[0].clips.map((c) => [c.id, c.start, c.end, c.name, c.origin]),
    [['clip1', 40, 60, 'Talk', { proposalId: 'p7' }]],
  );
  assert.deepEqual(clipped.final.proposals[0].kindChange, {
    from: 'range-marker',
    to: 'clip-range',
  });
}
assert.equal(batchOf(model, 'b1', 'r1'), 'b1');
assert.equal(batchOf(model, 'b1', 'r2'), 'b2');
assert.equal(batchOf(model, 'b1', 'gone'), undefined);

// The MCP answer reads the active batch's record, or refuses with what to do.
const source = {
  project,
  batches: [{ ...batch, created: '' }],
  activeBatchId: 'b1',
  revision: 11,
  model,
  batchRecord: (id) => (id === 'b1' ? exported : undefined),
};
assert.equal(batchRecordAnswer(source).projectRevision, 11);
assert.equal(batchRecordAnswer(source, 'b1').batch.id, 'b1');
assert.throws(() => batchRecordAnswer(source, 'b2'), AgentReadError);
assert.throws(
  () => batchRecordAnswer({ ...source, batchRecord: () => undefined }),
  /"Cai" has no batch record yet/,
);

// On disk: one JSON per batch in the profile; unreadable or foreign files read as none.
const { BatchRecords } = require('../dist-electron/batch-records.cjs');
const profile = await mkdtemp(path.join(os.tmpdir(), 'vc-batch-records-'));
try {
  const records = new BatchRecords(profile);
  const logged = [];
  records.log = (event, details) => logged.push([event, details.kind]);
  const store = {
    data: {
      project,
      model,
      batches: [{ ...batch, created: '' }],
      activeBatchId: 'b1',
      revision: 4,
    },
    proposals: { list: (id) => [...first, ...late].filter((p) => !id || p.sourceId === id) },
    exports: () => exports,
  };
  records.submitted(store, first, { runIntent: 'pass', transcripts: [] });
  assert.equal(records.read('p1', 'b1').runs[0].intent, 'pass');
  records.submitted(store, [], { transcripts: [] });
  exports[0].state = 'queued';
  records.exported(store, 'b1');
  assert.equal(records.read('p1', 'b1').final.exports.length, 1);
  exports[0].state = 'verified';
  records.exportSettled(store, 'e1');
  records.exportSettled(store, 'missing');
  assert.equal(records.read('p1', 'b1').final.exports[0].state, 'verified');
  records.exported(store, 'missing');
  records.submitted(store, [{ ...first[0], sourceId: 'r9' }], { transcripts: [] });
  assert.equal(records.read('p1', 'missing'), undefined);
  assert.equal(path.basename(path.dirname(records.file('a/b', 'b1'))).length, 32);
  await writeFile(records.file('p1', 'b1'), '{"recordVersion": 99}');
  assert.equal(records.read('p1', 'b1'), undefined);
  // A record that cannot be written is logged, never thrown into the export.
  await writeFile(path.join(profile, 'batch-records', 'blocked'), '');
  records.exported(
    { ...store, data: { ...store.data, project: { id: 'blocked', name: 'x' } } },
    'b1',
  );
  assert.deepEqual(logged, [['operation-failed', 'batch-record']]);
} finally {
  await rm(profile, { recursive: true, force: true });
}
console.log('batch record checks passed');

// A finished export updates only its state in the record.
{
  const record = {
    final: {
      exports: [
        { exportId: 'a', clipId: 'c1', name: 'One', start: 0, end: 1, state: 'queued' },
        { exportId: 'b', clipId: 'c2', name: 'Two', start: 1, end: 2, state: 'queued' },
      ],
    },
  };
  const exports = [{ plan: { id: 'a' }, state: 'verified' }];
  assert.equal(settleExports(record, exports), true);
  assert.deepEqual(
    record.final.exports.map((e) => e.state),
    ['verified', 'queued'],
  );
  assert.equal(settleExports(record, exports), false, 'nothing left to change');
  assert.equal(settleExports({}, exports), false, 'no final state yet');
}
