import assert from 'node:assert/strict';
import {
  AgentReadError,
  annotations,
  contextPacket,
  currentView,
  projectSummary,
  readableName,
  transcriptLines,
} from '../dist-electron/agent-tools.js';
import { defaultContext } from '../dist-electron/project-context.js';

// Read-only agent tools (VC-160): answers come from the live project and never carry
// file paths, media URLs or recognition that a correction replaced without saying so.
const segments = Array.from({ length: 250 }, (_, i) => ({
  id: i,
  start: i * 2,
  end: i * 2 + 1.5,
  text: ` line ${i}`,
  words: [],
  noSpeechProbability: 0,
  averageLogProbability: 0,
}));
const transcript = (id, role, fingerprint, state = 'complete') => ({
  id,
  sourceId: 'r1',
  fingerprint,
  role,
  state,
  track: 1,
  language: 'en',
  duration: 500,
  offset: 0,
  model: 'm',
  device: 'cpu',
  created: '2026-10-06T00:00:00Z',
  context: { vocabulary: '', brief: '' },
  segmentCount: segments.length,
  wordCount: 0,
});
const recording = {
  id: 'r1',
  title: 'Cai session 1',
  url: 'media://video/secret',
  poster: 'media://video/poster',
  sourcePath: 'I:\\Recordings\\cai.mkv',
  frames: [],
  base: 0,
  duration: 600,
  position: 42.25,
  sample: false,
  context: '',
  batchIds: ['b1'],
};
const source = {
  project: { id: 'p1', name: 'Fortune' },
  batches: [
    { id: 'b1', name: 'Cai', created: '2026-10-05' },
    { id: 'b2', name: 'Empty', created: '2026-10-06' },
  ],
  activeBatchId: 'b1',
  revision: 7,
  model: {
    selectedRecordingId: 'r1',
    recordings: [recording, { ...recording, id: 'sample', sample: true, batchIds: ['b1'] }],
    clips: [
      { id: 'c1', rid: 'r1', name: 'Fort', start: 10, end: 20, folder: 'Story', include: true },
    ],
    markers: { r1: [{ id: 'm1', time: 5, name: 'Bertrand', category: 'Story', topic: '' }] },
    terms: [
      { id: 't1', name: 'Cai', kind: 'Character', aliases: '', definition: '', pronunciation: '' },
    ],
    links: [],
    notes: [
      { id: 'n1', sourceId: 'r1', time: 12, title: 'Note', text: 'Fort battle', url: 'C:\\x' },
    ],
    sequence: [],
    targets: [],
    folders: [],
    transcriptEdits: [
      { id: 'mic-1:3:phrase', transcriptId: 'mic-1', segmentId: 3, text: ' line three' },
    ],
    cueDecisions: [{ id: 'd1', sourceId: 'r1', kind: 'mark', time: 30, status: 'accepted' }],
    contexts: [
      {
        ...defaultContext('project'),
        gameMode: 'set',
        game: { id: 'g', name: 'Fire Emblem Fortune', vocabulary: 'Cai, Bertrand\nLapis' },
        brief: 'Character study.',
      },
      { ...defaultContext('b1'), briefMode: 'append', brief: 'Chapter 11, after the fort.' },
    ],
  },
  fingerprints: { r1: 'fp-now' },
  transcripts: {
    list: () => [
      transcript('old-mic', 'mic', 'fp-old'),
      transcript('mic-1', 'mic', 'fp-now'),
      transcript('failed', 'game', 'fp-now', 'failed'),
    ],
    *segments(_id, after = -1) {
      for (const s of segments) if (s.id > after) yield s;
    },
  },
  view: { projectId: 'p1', page: 'cut', recordingId: 'r1', playhead: 43, clipId: 'c1' },
};

const view = currentView(source);
assert.equal(view.page, 'cut');
assert.equal(view.playheadSeconds, 43);
assert.deepEqual(view.selection, {
  kind: 'clip',
  id: 'c1',
  name: 'Fort',
  recordingId: 'r1',
  start: 10,
  end: 20,
});
// A view reported for another project is ignored; the synced position is used instead.
assert.equal(
  currentView({ ...source, view: { ...source.view, projectId: 'p2' } }).playheadSeconds,
  42.25,
);
assert.equal(
  currentView({ ...source, view: { ...source.view, markerId: 'm1' } }).selection.kind,
  'marker',
);

const overview = projectSummary(source);
assert.deepEqual(
  overview.batches.map((b) => [b.name, b.recordings, b.clips, b.game]),
  [
    ['Cai', 1, 1, 'Fire Emblem Fortune'],
    ['Empty', 0, 0, 'Fire Emblem Fortune'],
  ],
);
const batch = projectSummary(source, 'b1');
assert.equal(batch.brief, 'Character study.\n\nChapter 11, after the fort.');
assert.deepEqual(batch.recordings[0].transcripts, ['mic']);
assert.throws(() => projectSummary(source, 'nope'), AgentReadError);

const packet = contextPacket(source);
assert.deepEqual(packet.game.vocabulary, ['Cai', 'Bertrand', 'Lapis']);
assert.equal(packet.game.from, 'project');
assert.equal(packet.brief.how, 'append');
assert.equal(packet.alreadyMarked[0].markers, 1);
assert.match(packet.contextRevision, /^[0-9a-f]{16}$/);
assert.equal(contextPacket(source).contextRevision, packet.contextRevision);
assert.notEqual(
  contextPacket({ ...source, model: { ...source.model, terms: [] } }).contextRevision,
  packet.contextRevision,
);

const page = transcriptLines(source, { recordingId: 'r1', role: 'mic', start: 5, end: 300 });
assert.equal(page.transcriptId, 'mic-1', 'the transcript of the current file, not a stale one');
assert.equal(page.lines.length, 100);
assert.equal(page.lines[0].id, 2, 'the line ending after the start is included');
assert.deepEqual(page.lines[1], {
  id: 3,
  start: 6,
  end: 7.5,
  text: 'line three',
  recognized: 'line 3',
});
const next = transcriptLines(source, {
  recordingId: 'r1',
  role: 'mic',
  start: 5,
  end: 300,
  cursor: page.nextCursor,
});
assert.equal(next.lines[0].id, 102);
assert.equal(next.lines.at(-1).id, 149);
assert.equal(next.nextCursor, undefined);
assert.throws(
  () => transcriptLines(source, { recordingId: 'r1', role: 'game' }),
  /no finished game/,
);
assert.throws(
  () => transcriptLines(source, { recordingId: 'sample', role: 'mic' }),
  AgentReadError,
);
assert.throws(
  () => transcriptLines(source, { recordingId: 'r1', role: 'mic', start: 9, end: 3 }),
  AgentReadError,
);
assert.throws(
  () => transcriptLines(source, { recordingId: 'r1', role: 'mic', cursor: '-4' }),
  AgentReadError,
);

const marked = annotations(source);
assert.equal(marked.recordings[0].markers[0].name, 'Bertrand');
assert.equal(marked.notes[0].text, 'Fort battle');
assert.equal(marked.cueDecisions[0].status, 'accepted');
// A recording answers for its own batch and is refused under another (found in testing).
assert.equal(annotations(source, undefined, 'r1').batch.id, 'b1');
assert.throws(() => annotations(source, 'b2', 'r1'), /is not in the batch "Empty"/);
assert.equal(
  annotations({ ...source, activeBatchId: 'b2' }, undefined, 'r1').batch.id,
  'b1',
  'with the active batch elsewhere, the recording keeps its own batch',
);
assert.equal(readableName(source, 'r1'), 'Cai session 1');
assert.equal(readableName(source, 'b1'), 'Cai');
assert.equal(readableName(undefined, 'made-up'), 'made-up');

// No answer may carry a path, media URL or note link.
const everything = JSON.stringify([
  view,
  overview,
  batch,
  packet,
  page,
  next,
  marked,
  annotations(source, 'b1', 'r1'),
]);
for (const secret of ['I:\\\\Recordings', 'media://', 'C:\\\\x', 'sourcePath', 'poster'])
  assert.ok(!everything.includes(secret), `answers leak ${secret}`);
console.log('Agent read tools: views, summaries, context, paging and no paths passed.');
