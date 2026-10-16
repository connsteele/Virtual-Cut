import assert from 'node:assert/strict';
import { proposalPreviews, previewKindLabel } from '../dist-electron/proposal-previews.js';

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
console.log('proposal previews: ok');
