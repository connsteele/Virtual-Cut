import assert from 'node:assert/strict';
import {
  adjustPreview,
  proposalPreviews,
  previewKindLabel,
  previewTimes,
  previewsAt,
} from '../dist-electron/proposal-previews.js';

// VC-170: every pending proposal for a recording previews on the main timeline, a band for
// ranges and clip ranges and a line for the rest; decided ones drop off, and a spoken cue an
// agent reworked shows once, as the agent's.
const spoken = [
  'Okay, the fort chapter.',
  'Marker, Bertrand shows up.',
  'Clip start, siege begins.',
  'Note, check the music here.',
  'Clip end.',
  'Split.',
  'Clip end.',
  'Clip start.',
];
const segments = spoken.map((text, i) => ({
  id: i,
  start: i * 10,
  end: i * 10 + 4,
  text,
  words: [{ text, start: i * 10 + 0.5, end: i * 10 + 4, probability: 1 }],
  noSpeechProbability: 0,
  averageLogProbability: 0,
}));
const mic = {
  id: 'mic',
  sourceId: 'r1',
  fingerprint: 'f',
  role: 'mic',
  state: 'complete',
  track: 2,
  language: 'en',
  duration: 100,
  offset: 0,
};
const proposal = (id, kind, time, extra = {}) => ({
  id,
  sourceId: 'r1',
  kind,
  time,
  title: `${kind} ${id}`,
  text: '',
  reason: 'r',
  evidence: [],
  agent: { clientId: 'c', name: 'Claude Code' },
  submitted: '2026-10-16T00:00:00Z',
  submissionId: 's',
  projectRevision: 1,
  ...extra,
});
const proposals = [
  proposal('range', 'mark', 30, { end: 45 }),
  proposal('point', 'mark', 12, {
    refines: { transcriptId: 'mic', track: 2, lineId: 1, kind: 'mark', time: 10.5, text: '' },
  }),
  proposal('split', 'cut', 55, { names: { first: 'Fort', second: 'Siege' } }),
  proposal('clip', 'clip', 60, { end: 70 }),
  proposal('note', 'note', 33),
  proposal('gone', 'clip', 5, { end: 8 }),
];
const decided = (proposalId, status) => ({ id: `agent:${proposalId}`, proposalId, status });
const model = { cueDecisions: [decided('gone', 'accepted')] };
const previews = proposalPreviews(proposals, model, mic, segments);
const shape = (list) =>
  list.map((p) => [p.cards.join('+'), p.who, p.kind, p.start, p.end ?? null, p.label]);
assert.deepEqual(shape(previews), [
  ['point', 'both', 'marker', 12, null, 'mark point'],
  ['cue:mic:2+cue:mic:4', 'spoken', 'clip', 20.5, 40.5, 'siege begins.'],
  ['range', 'agent', 'range', 30, 45, 'mark range'],
  ['cue:mic:3', 'spoken', 'note', 30.5, null, 'check the music here.'],
  ['note', 'agent', 'note', 33, null, 'note note'],
  ['cue:mic:5', 'spoken', 'split', 50.5, null, 'Split'],
  ['split', 'agent', 'split', 55, null, 'Fort | Siege'],
  ['clip', 'agent', 'clip', 60, 70, 'clip clip'],
  ['cue:mic:6', 'spoken', 'clip', 60.5, null, 'Clip'],
  ['cue:mic:7', 'spoken', 'clip', 70.5, null, 'Clip'],
]);
assert.equal(previewKindLabel('range'), 'Range marker');

// Decided proposals and cues drop off; a rejected rework gives the spoken cue its card back.
const cue = (kind, time) => ({ sourceId: 'r1', track: 2, kind, time, status: 'accepted' });
const after = proposalPreviews(
  proposals,
  {
    cueDecisions: [
      decided('range', 'accepted'),
      decided('point', 'rejected'),
      decided('split', 'rejected'),
      cue('cut', 50.5),
      cue('clip-start', 20.5),
    ],
  },
  mic,
  segments,
);
assert.deepEqual(
  after.map((p) => p.cards.join('+')),
  ['gone', 'cue:mic:1', 'cue:mic:4', 'cue:mic:3', 'note', 'clip', 'cue:mic:6', 'cue:mic:7'],
);
assert.equal(after.find((p) => p.cards[0] === 'cue:mic:4').end, 40.5, 'the pair keeps its span');
assert.equal(after.find((p) => p.cards[0] === 'cue:mic:1').who, 'spoken');

// Without a finished mic transcript only the agent's proposals preview.
assert.deepEqual(
  proposalPreviews(proposals, model).map((p) => p.cards[0]),
  ['point', 'range', 'note', 'split', 'clip'],
);
assert.deepEqual(proposalPreviews([], {}, { ...mic, role: 'game' }, segments), []);

// VC-174: while a card is edited its drafted times stand in for the saved ones, so a nudge
// shows on the timeline before the proposal is accepted.
const shown = proposalPreviews(proposals, model);
assert.equal(previewsAt(shown, null, { start: 1 }), shown, 'no focused card, nothing moves');
assert.equal(previewsAt(shown, 'point', undefined), shown, 'no drafted times, nothing moves');
const nudged = previewsAt(shown, 'point', { start: 12.3 });
assert.equal(nudged.find((p) => p.cards[0] === 'point').start, 12.3);
assert.equal(nudged.find((p) => p.cards[0] === 'point').end, undefined, 'a point stays a point');
assert.deepEqual(
  nudged.filter((p) => p.cards[0] !== 'point'),
  shown.filter((p) => p.cards[0] !== 'point'),
  'other previews stay put',
);
const range = shown.find((p) => p.cards[0] === 'range');
const startOnly = previewsAt(shown, 'range', { start: range.start + 1 }).find(
  (p) => p.cards[0] === 'range',
);
assert.deepEqual([startOnly.start, startOnly.end], [range.start + 1, range.end]);
const both = previewsAt(shown, 'range', { start: 2, end: 9 }).find((p) => p.cards[0] === 'range');
assert.deepEqual([both.start, both.end], [2, 9]);
const crossed = previewsAt(shown, 'range', { start: range.end + 5 }).find(
  (p) => p.cards[0] === 'range',
);
assert.deepEqual([crossed.start, crossed.end], [range.end, range.end + 5], 'edges stay in order');
assert(previewTimes({ start: 0 }) && previewTimes({ start: 1.5, end: 0.5 }));
for (const bad of [
  null,
  3,
  {},
  { start: -1 },
  { start: Infinity },
  { start: '1' },
  { start: 1, end: NaN },
  { start: 1, x: 2 },
])
  assert(!previewTimes(bad), `rejects ${JSON.stringify(bad)}`);

// VC-184: a dragged edge lands inside the recording, in milliseconds, and never past the other
// edge; a point moves whole.
assert.deepEqual(adjustPreview({ start: 10 }, 'start', 12.34567, 100, 0.05), { start: 12.346 });
assert.deepEqual(adjustPreview({ start: 10 }, 'start', -3, 100, 0.05), { start: 0 });
assert.deepEqual(adjustPreview({ start: 10 }, 'start', 140, 100, 0.05), { start: 100 });
const span = { start: 10, end: 20 };
assert.deepEqual(adjustPreview(span, 'start', 8.5, 100, 0.05), { start: 8.5, end: 20 });
assert.deepEqual(adjustPreview(span, 'start', 25, 100, 0.05), { start: 19.95, end: 20 });
assert.deepEqual(adjustPreview(span, 'end', 31.2, 100, 0.05), { start: 10, end: 31.2 });
assert.deepEqual(adjustPreview(span, 'end', 2, 100, 0.05), { start: 10, end: 10.05 });
assert.deepEqual(adjustPreview(span, 'end', 140, 100, 0.05), { start: 10, end: 100 });
console.log('proposal previews: ok');
