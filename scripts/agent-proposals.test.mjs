import assert from 'node:assert/strict';
import * as z from 'zod';
import {
  prepareSubmission,
  proposalDecisions,
  submissionAnswer,
  submitInput,
} from '../dist-electron/agent-proposals.js';
import { AgentReadError } from '../dist-electron/agent-tools.js';
import {
  applyProposalCommand,
  proposalDecision,
  proposalStatus,
} from '../dist-electron/proposal-edits.js';
import { validateEdits, emptyModel } from '../dist-electron/project-edits.js';

// Agent proposals (VC-161/VC-162): a submission is checked whole, names the failing field,
// cites only the current transcript, and changes nothing until a decision is applied.
const segments = Array.from({ length: 40 }, (_, i) => ({
  id: i,
  start: i * 5,
  end: i * 5 + 4,
  text: ` line ${i}`,
  words: [],
  noSpeechProbability: 0,
  averageLogProbability: 0,
}));
const transcript = (id, role, fingerprint) => ({
  id,
  sourceId: 'r1',
  fingerprint,
  role,
  state: 'complete',
  track: 1,
  language: 'en',
  duration: 200,
  offset: 0,
  model: 'm',
  device: 'cpu',
  created: '2026-10-07T00:00:00Z',
  context: { vocabulary: '', brief: '' },
  segmentCount: segments.length,
  wordCount: 0,
});
const recording = {
  id: 'r1',
  title: 'Cai session 1',
  url: 'media://video/secret',
  frames: [],
  base: 0,
  duration: 200,
  sample: false,
  context: '',
  batchIds: ['b1'],
};
const stored = [];
const model = {
  ...emptyModel(),
  recordings: [recording],
  clips: [
    { id: 'c1', rid: 'r1', name: 'Fort', start: 0, end: 100, folder: 'Story', include: true },
  ],
  transcriptEdits: [
    { id: 'mic-1:3:phrase', transcriptId: 'mic-1', segmentId: 3, text: ' Bertrand' },
  ],
};
const source = {
  project: { id: 'p1', name: 'Fortune' },
  batches: [{ id: 'b1', name: 'Cai', created: '2026-10-05' }],
  activeBatchId: 'b1',
  revision: 3,
  model,
  fingerprints: { r1: 'fp' },
  transcripts: {
    list: () => [transcript('mic-old', 'mic', 'fp-old'), transcript('mic-1', 'mic', 'fp')],
    *segments(_id, after = -1) {
      for (const s of segments) if (s.id > after) yield s;
    },
  },
  proposals: { list: (id) => stored.filter((p) => !id || p.sourceId === id) },
};
let n = 0;
const ids = () => ({ submission: 's1', proposal: () => `p${++n}` });
const agent = { clientId: 'cl', name: 'Claude Code' };
const base = (extra = {}) => ({
  kind: 'marker',
  time_seconds: 16,
  title: 'Bertrand arrives',
  reason: 'He names Bertrand on the mic.',
  evidence: [{ role: 'mic', transcript_id: 'mic-1', line_ids: [3] }],
  ...extra,
});
const submit = (proposals, extra = {}) =>
  prepareSubmission(
    source,
    { recording_id: 'r1', proposals, ...extra },
    agent,
    ids(),
    '2026-10-07T01:00:00Z',
  );

// The SDK publishes this as the tool's JSON Schema.
const schema = z.toJSONSchema(submitInput);
assert.deepEqual(Object.keys(schema.properties).sort(), [
  'agent_model',
  'proposals',
  'recording_id',
]);
assert.deepEqual(schema.properties.proposals.items.properties.kind.enum, [
  'marker',
  'note',
  'split',
  'clip',
]);

const accepted = submit(
  [
    base({ intent: 'marker', note: 'Arrival scene.' }),
    base({
      kind: 'split',
      time_seconds: 50,
      title: 'Fort',
      clip_names: { first: 'Fort approach ', second: 'Fort battle' },
      evidence: [],
    }),
    base({ kind: 'clip', time_seconds: 60, end_seconds: 90, title: 'Siege', evidence: [] }),
    base({ kind: 'note', time_seconds: 120, title: 'Name check', intent: 'general', evidence: [] }),
  ],
  { agent_model: 'claude-test' },
);
assert.deepEqual(
  accepted.map((p) => [p.kind, p.time, p.end]),
  [
    ['mark', 16, undefined],
    ['cut', 50, undefined],
    ['clip', 60, 90],
    ['note', 120, undefined],
  ],
);
assert.deepEqual(accepted[0].evidence[0], {
  role: 'mic',
  transcriptId: 'mic-1',
  lineIds: [3],
  start: 15,
  end: 19,
  quote: 'Bertrand',
});
assert.equal(accepted[0].agent.model, 'claude-test');
assert.equal(accepted[0].projectRevision, 3);
assert.equal(submissionAnswer(source, accepted).submitted[1].kind, 'split');
stored.push(...accepted);

// Every refusal names the field, and nothing is half-accepted.
const refused = (proposals, pattern, extra) =>
  assert.throws(
    () => submit(proposals, extra),
    (e) => e instanceof AgentReadError && pattern.test(e.message),
  );
refused([base({ time_seconds: 900 })], /^proposals\[0\]\.time_seconds: 900 is past the end/);
refused([base({ kind: 'clip' })], /^proposals\[0\]\.end_seconds: a clip needs an end/);
refused([base({ kind: 'clip', end_seconds: 10 })], /end must follow/);
refused([base({ end_seconds: 20 })], /only a clip has an end/);
refused(
  [base({ clip_names: { first: 'A', second: 'B' } })],
  /^proposals\[0\]\.clip_names: only a split names two clips/,
);
refused([base({ title: 'x'.repeat(150) })], /^proposals\[0\]\.title: at most 100/);
refused(
  [
    base({
      time_seconds: 30,
      evidence: [{ role: 'mic', transcript_id: 'mic-old', line_ids: [1] }],
    }),
  ],
  /^proposals\[0\]\.evidence\[0\]\.transcript_id: stale or unknown\. The current mic transcript is "mic-1"/,
);
refused(
  [base({ time_seconds: 30, evidence: [{ role: 'game', transcript_id: 'g', line_ids: [1] }] })],
  /current game transcript is missing/,
);
refused(
  [base({ time_seconds: 30, evidence: [{ role: 'mic', transcript_id: 'mic-1', line_ids: [99] }] })],
  /evidence\[0\]\.line_ids: line 99 is not in that transcript/,
);
refused([base({ time_seconds: 16.1 })], /^proposals\[0\]: repeats pending proposal "p1"/);
refused(
  [base({ time_seconds: 30 }), base({ time_seconds: 30 })],
  /^proposals\[1\]: repeats another proposal in this call/,
);
refused([base({ kind: 'cue' })], /^proposals\.0\.kind/);
refused([], /^proposals: /);
assert.throws(
  () =>
    prepareSubmission(
      source,
      { recording_id: 'r1', proposals: [base({ time_seconds: 3 })] },
      agent,
      ids(),
      undefined,
      2000,
      2000,
    ),
  /already holds 2000 proposals/,
);
assert.throws(
  () => submit([base()], { recording_id: 'missing' }),
  /No recording with id "missing"/,
);

// Deciding: accept with a move and retitle, accept a split and a clip, reject a note.
const command = (proposal, action, values = {}) => ({
  projectId: 'p1',
  sourceId: 'r1',
  transcriptId: 'mic-1',
  segmentId: -1,
  proposalId: proposal.id,
  action,
  expected: 'null',
  ...values,
});
let id = 0;
const newId = () => `new${++id}`;
const [marker, split, clip, note] = accepted;
let next = applyProposalCommand(
  model,
  marker,
  command(marker, 'accept-proposal', {
    time: 17.5,
    title: 'Bertrand returns',
    text: 'Arrival scene.',
  }),
  newId,
  '2026-10-07T02:00:00Z',
);
assert.equal(model.cueDecisions, undefined, 'the input model is unchanged');
assert.deepEqual(next.markers.r1[0], {
  id: 'new1',
  time: 17.5,
  name: 'Bertrand returns',
  note: 'Arrival scene.',
  category: 'Context',
  topic: '',
  color: 'Blue',
});
assert.equal(proposalStatus(next.cueDecisions, marker.id), 'accepted');
assert.throws(
  () => applyProposalCommand(next, marker, command(marker, 'reject-proposal'), newId),
  /already decided/,
);
assert.throws(
  () => applyProposalCommand(next, split, command(split, 'accept-proposal', { time: 150 }), newId),
  /exactly one clip/,
  'a split moved outside every clip is refused',
);
next = applyProposalCommand(
  next,
  split,
  command(split, 'accept-proposal', {
    clipId: 'c1',
    firstName: split.names.first,
    secondName: 'The fort battle',
  }),
  newId,
);
assert.deepEqual(
  next.clips.map((c) => [c.name, c.start, c.end]),
  [
    ['Fort approach', 0, 50],
    ['The fort battle', 50, 100],
  ],
);
assert.throws(
  () => applyProposalCommand(next, clip, command(clip, 'accept-proposal', { endTime: 59 }), newId),
  /Clip end must follow/,
);
next = applyProposalCommand(next, clip, command(clip, 'accept-proposal', { endTime: 95 }), newId);
assert.deepEqual(next.clips.at(-1).folder, '_Review');
assert.equal(proposalDecision(next.cueDecisions, clip.id).appliedEnd, 95);
next = applyProposalCommand(next, note, command(note, 'reject-proposal'), newId);
assert.equal(next.notes.length, 0, 'a rejected note creates nothing');
assert.throws(
  () => applyProposalCommand(model, note, command(note, 'accept-proposal', { time: 999 }), newId),
  /inside this recording/,
);
assert.throws(
  () => applyProposalCommand(model, note, { ...command(note, 'accept-proposal'), proposalId: 'x' }),
  /proposal changed/,
);
assert.throws(
  () =>
    applyProposalCommand(model, note, command(note, 'accept-proposal', { expected: '{}' }), newId),
  /already decided/,
);
const noted = applyProposalCommand(model, note, command(note, 'accept-proposal'), newId);
assert.deepEqual(
  [noted.notes[0].title, noted.notes[0].time, noted.notes[0].sourceId],
  ['Name check', 120, 'r1'],
);
// Decisions pass the project's validation, so they save and undo like cue decisions.
validateEdits(structuredClone(next));
assert.throws(
  () =>
    validateEdits({
      ...structuredClone(next),
      cueDecisions: [{ ...next.cueDecisions[2], appliedEnd: 10 }],
    }),
  /Invalid cue decision/,
);

// Reading decisions back: moved, retitled, rejected and still pending.
const read = proposalDecisions({ ...source, model: next });
assert.deepEqual(read.counts, { pending: 0, accepted: 3, rejected: 1 });
const markerRow = read.proposals.find((p) => p.id === marker.id);
assert.equal(markerRow.status, 'accepted');
assert.equal(markerRow.movedSeconds, 1.5);
assert.equal(markerRow.retitled, true);
assert.equal(markerRow.noteEdited, false);
assert.equal(markerRow.chosen.title, 'Bertrand returns');
assert.equal(markerRow.decided, '2026-10-07T02:00:00Z');
assert.equal(read.proposals.find((p) => p.id === clip.id).endMovedSeconds, 5);
assert.equal(read.proposals.find((p) => p.id === note.id).chosen, undefined);
const splitRow = read.proposals.find((p) => p.id === split.id);
assert.deepEqual(splitRow.proposed.clipNames, { first: 'Fort approach', second: 'Fort battle' });
assert.deepEqual(splitRow.chosen.clipNames, { first: 'Fort approach', second: 'The fort battle' });
assert.equal(splitRow.renamed, true);
// Without names a split keeps the clip's name and adds "· 2", as spoken splits do.
const unnamed = applyProposalCommand(
  model,
  split,
  command(split, 'accept-proposal', { clipId: 'c1' }),
  newId,
);
assert.deepEqual(
  unnamed.clips.map((c) => c.name),
  ['Fort', 'Fort · 2'],
);
assert.equal(proposalDecision(unnamed.cueDecisions, split.id).title, undefined);
assert.throws(
  () =>
    applyProposalCommand(
      model,
      split,
      command(split, 'accept-proposal', { clipId: 'c1', firstName: 'x'.repeat(201) }),
      newId,
    ),
  /clip names of up to 200/,
);
assert.deepEqual(
  proposalDecisions({ ...source, model: next }, { status: 'rejected' }).proposals.map((p) => p.id),
  [note.id],
);
assert.equal(
  proposalDecisions({ ...source, model: next }, { status: 'decided' }).proposals.length,
  4,
);
assert.equal(proposalDecisions(source, { status: 'pending' }).proposals.length, 4);
assert.equal(
  proposalDecisions(source, { recording_id: 'r1', proposal_ids: [clip.id] }).proposals[0].kind,
  'clip',
);
assert.throws(() => proposalDecisions(source, { proposal_ids: ['nope'] }), /no proposal "nope"/);
assert.throws(() => proposalDecisions(source, { status: 'maybe' }), /status: Invalid option/);
assert.ok(!JSON.stringify([accepted, read]).includes('media://'), 'no media URLs');
console.log('Agent proposals: submission checks, decisions and read-back passed.');
