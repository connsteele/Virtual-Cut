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
  inferReworks,
  applyProposalCommand,
  proposalDecision,
  proposalStatus,
} from '../dist-electron/proposal-edits.js';
import { validateEdits, emptyModel } from '../dist-electron/project-edits.js';

// Agent proposals (VC-161/VC-162): a submission is checked whole, names the failing field,
// cites only the current transcript, and changes nothing until a decision is applied.
// Line 30 is a spoken Split and line 31 a spoken Marker cue, for proposals that rework them.
const spoken = { 30: ' Split.', 31: ' Marker, Bertrand shows up.' };
const segments = Array.from({ length: 40 }, (_, i) => ({
  id: i,
  start: i * 5,
  end: i * 5 + 4,
  text: spoken[i] ?? ` line ${i}`,
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
refused([base({ kind: 'note', end_seconds: 20 })], /only a clip or a range marker has an end/);
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
// VC-155: several intents, Notion targets, range markers, and reworking a spoken cue.
{
  const [range, notion, rework, retitle] = submit([
    base({ time_seconds: 20, end_seconds: 60, title: 'Reunion', intents: ['marker'] }),
    base({
      kind: 'note',
      time_seconds: 5,
      title: 'Cai stops running',
      intents: ['general', 'notion'],
      intent: 'general',
      notion: { target: 'expands', existing: "Cai's doubt " },
      evidence: [{ role: 'mic', transcript_id: 'mic-1', line_ids: [1, 3, 5] }],
    }),
    base({
      kind: 'split',
      time_seconds: 147,
      title: 'Scene change',
      clip_names: { first: 'Fort', second: 'Camp' },
      refines: { transcript_id: 'mic-1', line_id: 30 },
      evidence: [],
    }),
    base({
      time_seconds: 155,
      title: 'Bertrand returns',
      refines: { transcript_id: 'mic-1', line_id: 31 },
      evidence: [],
    }),
  ]);
  assert.equal(range.end, 60);
  assert.deepEqual(notion.intents, ['general', 'notion']);
  assert.equal(notion.intent, 'general');
  assert.deepEqual(notion.notion, { target: 'expands', existing: "Cai's doubt" });
  assert.deepEqual(rework.refines, {
    transcriptId: 'mic-1',
    track: 1,
    lineId: 30,
    kind: 'cut',
    time: 150,
    text: 'Split.',
  });
  assert.equal(retitle.refines.kind, 'mark');
  assert.equal(submissionAnswer(source, [rework]).submitted[0].reworks, 'cut cue at 150 s');
  refused([base({ notion: { target: 'new' } })], /notion: only a proposal with the notion intent/);
  refused(
    [base({ intents: ['notion'], notion: { target: 'duplicate' } })],
    /notion\.existing: name the note it repeats/,
  );
  refused([base({ end_seconds: 300 })], /end_seconds: the end must follow/);
  refused(
    [base({ kind: 'split', refines: { transcript_id: 'mic-old', line_id: 30 } })],
    /refines\.transcript_id: stale or unknown/,
  );
  refused(
    [base({ kind: 'split', refines: { transcript_id: 'mic-1', line_id: 2 } })],
    /refines\.line_id: line 2 holds no spoken cue/,
  );
  refused(
    [base({ kind: 'split', refines: { transcript_id: 'mic-1', line_id: 99 } })],
    /line 99 holds no spoken cue/,
  );
  refused(
    [base({ kind: 'clip', end_seconds: 170, refines: { transcript_id: 'mic-1', line_id: 30 } })],
    /line 30 is a cut cue; a clip proposal cannot rework it/,
  );
  stored.push(range, notion, rework, retitle);
  refused(
    [base({ kind: 'split', time_seconds: 149, refines: { transcript_id: 'mic-1', line_id: 30 } })],
    /another pending proposal already reworks that cue/,
  );

  // Accepting a range marker keeps its end; accepting a rework settles the spoken cue too.
  const camp = {
    ...model,
    clips: [
      ...model.clips,
      { id: 'c2', rid: 'r1', name: 'Camp', start: 100, end: 200, folder: 'Story', include: true },
    ],
  };
  const ranged = applyProposalCommand(model, range, command(range, 'accept-proposal', {}), newId);
  assert.equal(ranged.markers.r1.at(-1).end, 60);
  assert.equal(proposalDecision(ranged.cueDecisions, range.id).appliedEnd, 60);
  assert.throws(
    () =>
      applyProposalCommand(model, range, command(range, 'accept-proposal', { endTime: 10 }), newId),
    /Marker end must follow/,
  );
  const settled = applyProposalCommand(
    camp,
    rework,
    command(rework, 'accept-proposal', { clipId: 'c2' }),
    newId,
    '2026-10-07T03:00:00Z',
  );
  assert.deepEqual(settled.cueDecisions.at(-1), {
    id: 'r1:1:cut:600',
    sourceId: 'r1',
    track: 1,
    kind: 'cut',
    time: 150,
    status: 'accepted',
    decided: '2026-10-07T03:00:00Z',
    settledBy: rework.id,
  });
  validateEdits(settled);
  // Reopening takes back what accepting made: the split's clips join again under their old
  // name, and the spoken cue it settled returns to review with it.
  const reopen = (m, p) =>
    applyProposalCommand(
      m,
      p,
      { ...command(p, 'reopen-proposal'), expected: proposalDecision(m.cueDecisions, p.id).status },
      newId,
    );
  const unsplit = reopen(settled, rework);
  assert.deepEqual(
    unsplit.clips.map((c) => [c.id, c.name, c.start, c.end]),
    camp.clips.map((c) => [c.id, c.name, c.start, c.end]),
  );
  assert.deepEqual(unsplit.cueDecisions, []);
  const unranged = reopen(ranged, range);
  assert.equal(unranged.markers.r1?.length ?? 0, model.markers.r1?.length ?? 0);
  assert.equal(proposalDecision(unranged.cueDecisions, range.id), undefined);
  const turnedDown = applyProposalCommand(model, notion, command(notion, 'reject-proposal'), newId);
  assert.equal(proposalDecision(reopen(turnedDown, notion).cueDecisions, notion.id), undefined);
  const noted = applyProposalCommand(model, notion, command(notion, 'accept-proposal'), newId);
  assert.equal(noted.notes.length, model.notes.length + 1);
  assert.equal(reopen(noted, notion).notes.length, model.notes.length);
  assert.throws(
    () =>
      applyProposalCommand(
        noted,
        notion,
        { ...command(notion, 'reopen-proposal'), expected: 'rejected' },
        newId,
      ),
    /changed elsewhere/,
  );
  assert.throws(
    () =>
      applyProposalCommand(
        model,
        notion,
        { ...command(notion, 'reopen-proposal'), expected: 'accepted' },
        newId,
      ),
    /changed elsewhere/,
  );
  // A split whose clips changed since can't be put back; Undo still can.
  const moved = {
    ...settled,
    clips: settled.clips.map((c) => (c.id === 'c2' ? { ...c, end: 140 } : c)),
  };
  assert.throws(() => reopen(moved, rework), /changed since\. Use Undo/);
  // A cue already decided on its own is left as it was; rejecting a rework leaves the cue open.
  const own = {
    ...camp,
    cueDecisions: [
      { id: 'mine', sourceId: 'r1', track: 1, kind: 'cut', time: 150.2, status: 'rejected' },
    ],
  };
  assert.equal(
    applyProposalCommand(own, rework, command(rework, 'accept-proposal', { clipId: 'c2' }), newId)
      .cueDecisions.length,
    2,
  );
  assert.equal(
    applyProposalCommand(model, rework, command(rework, 'reject-proposal', {}), newId).cueDecisions
      .length,
    1,
  );
  const back = proposalDecisions(source, { proposal_ids: [notion.id, rework.id] }).proposals;
  assert.deepEqual(back[0].intents, ['general', 'notion']);
  assert.deepEqual(back[0].evidence, [{ role: 'mic', start: 5, end: 29 }]);
  assert.deepEqual(back[1].refines, { lineId: 30, kind: 'cut', time: 150, heard: 'Split.' });
  assert.deepEqual(proposalDecisions(source, { proposal_ids: [range.id] }).proposals[0].intents, [
    'marker',
  ]);
}
// An agent that cites a spoken cue's line without `refines` still reworks it (VC-155): one card.
{
  const cueAt = (transcriptId, lineId) =>
    transcriptId === 'mic-1' && lineId === 30
      ? { transcriptId, track: 1, lineId, kind: 'cut', time: 150, text: 'Split.' }
      : transcriptId === 'mic-1' && lineId === 31
        ? {
            transcriptId,
            track: 1,
            lineId,
            kind: 'mark',
            time: 155,
            text: 'Marker, Bertrand shows up.',
          }
        : undefined;
  const cites = (id, kind, lineIds, extra = {}) => ({
    id,
    kind,
    evidence: [{ role: 'mic', transcriptId: 'mic-1', lineIds, start: 0, end: 1, quote: '' }],
    ...extra,
  });
  const out = inferReworks(
    [
      cites('a', 'cut', [29, 30]),
      cites('b', 'cut', [30]),
      cites('c', 'clip', [31]),
      cites('d', 'note', [31]),
      cites('e', 'mark', [3], { refines: { transcriptId: 'mic-1', lineId: 3 } }),
      { id: 'f', kind: 'mark', evidence: [{ role: 'game', transcriptId: 'mic-1', lineIds: [31] }] },
    ],
    cueAt,
  );
  assert.deepEqual(
    out.map((p) => [p.id, p.refines?.lineId]),
    [
      ['a', 30],
      ['b', undefined],
      ['c', undefined],
      ['d', 31],
      ['e', 3],
      ['f', undefined],
    ],
  );
}
console.log('Agent proposals: submission checks, decisions and read-back passed.');
