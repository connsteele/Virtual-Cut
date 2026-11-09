import assert from 'node:assert/strict';
import * as z from 'zod';
import { DatabaseSync } from 'node:sqlite';
import {
  amendInput,
  changesInput,
  prepareAmend,
  prepareChanges,
} from '../dist-electron/agent-changes.js';
import { prepareSubmission, proposalDecisions } from '../dist-electron/agent-proposals.js';
import { AgentReadError } from '../dist-electron/agent-tools.js';
import { applyProposalCommand, proposalDecision } from '../dist-electron/proposal-edits.js';
import { proposalPreviews } from '../dist-electron/proposal-previews.js';
import { recordProposal } from '../dist-electron/batch-record.js';
import { emptyModel, validateEdits } from '../dist-electron/project-edits.js';
import { require } from './shared.mjs';

const { ProposalStore } = require('../dist-electron/proposal-store.cjs');

// VC-204: change proposals for markers and clips already in the project, clip colors on new clip
// ranges, and amend_proposal. Nothing changes until the user accepts; accepting edits the model,
// so Undo and Reopen take it back.
const recording = {
  id: 'r1',
  title: 'Eden Prime',
  url: 'media://video/secret',
  frames: [],
  base: 0,
  duration: 360,
  sample: false,
  context: '',
  batchIds: ['b1'],
};
const baseModel = () => ({
  ...emptyModel(),
  recordings: [recording],
  markers: {
    r1: [
      {
        id: 'm1',
        time: 72.4,
        name: 'Eden Prime landing',
        category: 'Context',
        topic: '',
        note: 'Landing.',
        color: 'Blue',
      },
      { id: 'm2', time: 200, end: 210, name: 'Ashley', category: 'Context', topic: '', note: '' },
    ],
  },
  clips: [
    {
      id: 'k1',
      rid: 'r1',
      name: 'Eden Prime arrival',
      start: 70,
      end: 250,
      folder: 'Eden Prime',
      include: true,
      accepted: true,
    },
  ],
});
const db = new DatabaseSync(':memory:');
const store = new ProposalStore(db);
let model = baseModel();
const source = () => ({
  project: { id: 'p1', name: 'Mass Effect' },
  batches: [{ id: 'b1', name: 'ME', created: '2026-11-08' }],
  activeBatchId: 'b1',
  revision: 1,
  model,
  fingerprints: { r1: 'fp' },
  transcripts: { list: () => [], *segments() {} },
  proposals: store,
});
let n = 0;
const ids = () => ({ submission: `s${n}`, proposal: () => `p${++n}` });
const agent = { clientId: 'cl', name: 'Claude Code' };
const now = '2026-11-09T18:00:00Z';
const propose = (changes) =>
  prepareChanges(source(), { recording_id: 'r1', changes }, agent, ids(), now);
const refused = (run, message) =>
  assert.throws(run, (e) => e instanceof AgentReadError && message.test(e.message));
const command = (p, action, extra = {}) => ({
  projectId: 'p1',
  sourceId: 'r1',
  transcriptId: '',
  segmentId: 0,
  proposalId: p.id,
  action,
  expected: action === 'accept-proposal' || action === 'reject-proposal' ? 'null' : 'accepted',
  ...extra,
});
const apply = (p, action, extra) =>
  (model = applyProposalCommand(model, p, command(p, action, extra), () => `new${++n}`, now));
const marker = (id) => model.markers.r1.find((m) => m.id === id);
const clip = (id) => model.clips.find((c) => c.id === id);

// The tool schemas the SDK publishes.
assert.deepEqual(Object.keys(z.toJSONSchema(changesInput).properties).sort(), [
  'agent_model',
  'changes',
  'recording_id',
  'run_intent',
]);
assert.ok(z.toJSONSchema(amendInput).properties.clip_color);

// Checks name the field and change nothing.
refused(() => propose([{ reason: 'r', color: 'Green' }]), /changes\[0\]: name exactly one/);
refused(() => propose([{ marker_id: 'nope', reason: 'r', color: 'Green' }]), /no marker "nope"/);
refused(() => propose([{ clip_id: 'k1', reason: 'r', color: 'Green' }]), /clip_color/);
refused(() => propose([{ marker_id: 'm1', reason: 'r', clip_color: 'Teal' }]), /use color/);
refused(() => propose([{ marker_id: 'm1', reason: 'r', color: 'Blue' }]), /changes nothing/);
refused(() => propose([{ clip_id: 'k1', reason: 'r', end_seconds: 60 }]), /end must follow/);
refused(() => propose([{ clip_id: 'k1', reason: 'r', end_seconds: null }]), /always has an end/);
refused(() => propose([{ marker_id: 'm1', reason: 'r', title: 'x'.repeat(101) }]), /100/);
assert.equal(store.count('r1'), 0);

// A marker change proposes only what differs, and keeps what the agent saw.
const [toGreen] = propose([
  {
    marker_id: 'm1',
    color: 'Green',
    note: 'The Normandy lands; first squad moment.',
    title: 'Eden Prime landing',
    reason: 'Squad moments are Green in the color key.',
  },
]);
assert.equal(toGreen.kind, 'edit');
assert.deepEqual(toGreen.edit, {
  target: 'marker',
  targetId: 'm1',
  seen: { color: 'Blue', note: 'Landing.' },
  set: { color: 'Green', note: 'The Normandy lands; first squad moment.' },
});
assert.equal(toGreen.time, 72.4);
store.add([toGreen]);
// One pending change per target: the agent amends instead.
refused(
  () => propose([{ marker_id: 'm1', reason: 'r', color: 'Red' }]),
  /already targets this marker; amend it/,
);
assert.equal(recordProposal(toGreen).kind, 'change');
assert.deepEqual(recordProposal(toGreen).change.after, toGreen.edit.set);
assert.equal(proposalPreviews([toGreen], model)[0].kind, 'marker');

// Accepting writes the values through a model edit; the decision keeps before and after.
apply(toGreen, 'accept-proposal');
assert.equal(marker('m1').color, 'Green');
assert.equal(marker('m1').note, 'The Normandy lands; first squad moment.');
const d1 = proposalDecision(model.cueDecisions, toGreen.id);
assert.deepEqual(d1.edit.prior, { color: 'Blue', note: 'Landing.' });
assert.equal(d1.markerId, undefined, 'a change makes no marker of its own');
assert.deepEqual(validateEdits(model), model);
// Reopening puts the marker back as it was; a field changed again by hand keeps the hand edit.
model.markers.r1[0].note = 'Hand note.';
apply(toGreen, 'reopen-proposal');
assert.equal(marker('m1').color, 'Blue');
assert.equal(marker('m1').note, 'Hand note.');
assert.equal(proposalDecision(model.cueDecisions, toGreen.id), undefined);
model.markers.r1[0].note = 'Landing.';

// The user's own values on the card win, and the decision says which fields they changed.
apply(toGreen, 'accept-proposal', { edit: { color: 'Mint', note: toGreen.edit.set.note } });
assert.equal(marker('m1').color, 'Mint');
const read = proposalDecisions(source(), { proposal_ids: [toGreen.id] }).proposals[0];
assert.equal(read.kind, 'change');
assert.equal(read.markerId, 'm1');
assert.deepEqual(read.before, { color: 'Blue', note: 'Landing.' });
assert.deepEqual(read.chosen.color, 'Mint');
assert.deepEqual(read.userChanged, ['color']);
refused(
  () => prepareAmend(source(), { proposal_id: toGreen.id, color: 'Red' }, 'cl', now),
  /already accepted/,
);
apply(toGreen, 'reopen-proposal');

// A range marker can become a point marker; a clip change trims, renames and recolors.
const [point, trim] = propose([
  { marker_id: 'm2', end_seconds: null, reason: 'A moment, not a scene.' },
  {
    clip_id: 'k1',
    end_seconds: 238.2,
    title: 'Eden Prime: first contact',
    clip_color: 'Teal',
    reason: 'The beacon walk has its own clip.',
  },
]);
assert.deepEqual(point.edit.set, { end: null });
assert.deepEqual(trim.edit.seen, { name: 'Eden Prime arrival', end: 250, color: null });
assert.equal(proposalPreviews([trim], model)[0].kind, 'clip');
store.add([point, trim]);
apply(point, 'accept-proposal');
assert.equal(marker('m2').end, undefined);
apply(trim, 'accept-proposal');
assert.equal(clip('k1').end, 238.2);
assert.equal(clip('k1').color, 'Teal');
assert.equal(clip('k1').accepted, false, 'a trimmed clip needs accepting again in Cut');
assert.deepEqual(validateEdits(model), model);
apply(trim, 'reopen-proposal');
assert.equal(clip('k1').end, 250);
assert.equal(clip('k1').color, undefined);
assert.equal(clip('k1').name, 'Eden Prime arrival');
apply(point, 'reopen-proposal');
assert.equal(marker('m2').end, 210);
// Settled, so the next changes may target the same marker and clip.
apply(point, 'reject-proposal');
apply(trim, 'reject-proposal');

// A deleted target leaves only Reject.
const [gone] = propose([{ marker_id: 'm2', color: 'Red', reason: 'Plot objective.' }]);
store.add([gone]);
const kept = model.markers.r1;
model.markers.r1 = kept.filter((m) => m.id !== 'm2');
assert.throws(() => apply(gone, 'accept-proposal'), /marker is gone/);
apply(gone, 'reject-proposal');
model.markers.r1 = kept;

// New clip ranges carry a Resolve clip color; accepting as a clip keeps it, or the card's choice.
const submit = (proposals) =>
  prepareSubmission(source(), { recording_id: 'r1', proposals }, agent, ids(), now);
refused(
  () => submit([{ kind: 'marker', time_seconds: 5, title: 'x', reason: 'r', clip_color: 'Teal' }]),
  /only a clip range has a clip color/,
);
const [fight, fight2] = submit([
  {
    kind: 'clip',
    time_seconds: 205,
    end_seconds: 244,
    title: 'Ashley holds the line',
    clip_color: 'Purple',
    color: 'Blue',
    reason: 'The whole fight is a clip.',
  },
  { kind: 'clip', time_seconds: 300, end_seconds: 330, title: 'Beacon', reason: 'r' },
]);
assert.equal(fight.clipColor, 'Purple');
store.add([fight, fight2]);
apply(fight, 'accept-proposal');
assert.equal(clip(proposalDecision(model.cueDecisions, fight.id).clipId).color, 'Purple');
assert.throws(() => apply(fight2, 'accept-proposal', { clipColor: 'Mint' }), /clip colors/);
apply(fight2, 'accept-proposal', { clipColor: 'Navy' });
assert.equal(clip(proposalDecision(model.cueDecisions, fight2.id).clipId).color, 'Navy');
assert.deepEqual(validateEdits(model), model);
apply(fight2, 'reopen-proposal');

// Amending: the agent's own pending card changes in place and keeps every earlier version.
const [nihlus] = submit([
  { kind: 'marker', time_seconds: 151.1, title: 'Nihlus goes alone', reason: 'He leaves.' },
]);
store.add([nihlus]);
refused(
  () => prepareAmend(source(), { proposal_id: 'nope', color: 'Red' }, 'cl', now),
  /no proposal/,
);
refused(
  () => prepareAmend(source(), { proposal_id: nihlus.id, color: 'Red' }, 'other-app', now),
  /another paired app/,
);
refused(
  () => prepareAmend(source(), { proposal_id: nihlus.id, title: 'Nihlus goes alone' }, 'cl', now),
  /changes nothing/,
);
refused(
  () => prepareAmend(source(), { proposal_id: nihlus.id, clip_color: 'Teal' }, 'cl', now),
  /only a clip range/,
);
const v2 = prepareAmend(
  source(),
  {
    proposal_id: nihlus.id,
    color: 'Yellow',
    title: 'Nihlus splits off',
    reason: 'Squad departures are Yellow.',
  },
  'cl',
  '2026-11-09T18:01:00Z',
);
store.amend(v2);
assert.equal(store.get(nihlus.id).title, 'Nihlus splits off');
assert.equal(v2.versions.length, 1);
assert.equal(v2.versions[0].values.title, 'Nihlus goes alone');
assert.equal(v2.versions[0].at, now);
assert.deepEqual(v2.amended, {
  at: '2026-11-09T18:01:00Z',
  reason: 'Squad departures are Yellow.',
});
const v3 = prepareAmend(
  source(),
  { proposal_id: nihlus.id, end_seconds: 161, reason: 'The scene runs to the cutaway.' },
  'cl',
  '2026-11-09T18:02:00Z',
);
store.amend(v3);
assert.equal(v3.versions.length, 2);
assert.equal(v3.versions[1].reason, 'Squad departures are Yellow.');
assert.equal(v3.end, 161);
apply(v3, 'accept-proposal');
const d3 = proposalDecision(model.cueDecisions, nihlus.id);
assert.equal(d3.version, 3);
assert.equal(marker(d3.markerId).color, 'Yellow');
const history = proposalDecisions(source(), { proposal_ids: [nihlus.id] }).proposals[0];
assert.equal(history.version, 3);
assert.equal(history.decidedVersion, 3);
assert.deepEqual(
  history.versions.map((v) => [v.version, v.title ?? null, v.reason ?? null]),
  [
    [1, 'Nihlus goes alone', null],
    [2, 'Nihlus splits off', 'Squad departures are Yellow.'],
    [3, null, 'The scene runs to the cutaway.'],
  ],
);
apply(v3, 'reopen-proposal');

// Amending a change card changes what it proposes; the target as it is now stays the "before".
const [pending] = propose([{ clip_id: 'k1', clip_color: 'Teal', reason: 'First visit.' }]);
store.add([pending]);
const amendedChange = prepareAmend(
  source(),
  { proposal_id: pending.id, clip_color: 'Orange', title: 'Eden Prime: arrival' },
  'cl',
  now,
);
assert.deepEqual(amendedChange.edit.set, { name: 'Eden Prime: arrival', color: 'Orange' });
assert.deepEqual(amendedChange.edit.seen, { name: 'Eden Prime arrival', color: null });
assert.equal(amendedChange.versions[0].values.edit.set.color, 'Teal');
refused(
  () => prepareAmend(source(), { proposal_id: pending.id, clip_color: null }, 'cl', now),
  /already has those values/,
);
refused(
  () => prepareAmend(source(), { proposal_id: pending.id, color: 'Red' }, 'cl', now),
  /use clip_color/,
);
// A withdrawn card is proposed again rather than amended.
store.withdraw([pending.id], { at: now, clientId: 'cl' });
refused(
  () => prepareAmend(source(), { proposal_id: pending.id, clip_color: 'Lime' }, 'cl', now),
  /withdrawn/,
);
console.log('agent changes and amends: all checks passed');
