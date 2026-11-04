import assert from 'node:assert/strict';
import {
  AgentReadError,
  annotations,
  contextPacket,
  currentView,
  projectSummary,
  readableName,
  numbersOnly,
  screenArea,
  screenTextLines,
  transcriptLines,
  visualEventLines,
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

// Picture events (VC-171): the stored events of the current file, as text lines for a window.
const events = [
  { kind: 'black', start: 15.45, end: 18.583 },
  { kind: 'cut', start: 240.1, score: 31.2 },
  { kind: 'cut', start: 240.4, score: 18 },
  { kind: 'cut', start: 240.75, score: 22.5 },
  { kind: 'still', start: 250, end: 253.5, brightness: 61 },
  { kind: 'cut', start: 300, score: 15.4 },
  { kind: 'fade', start: 359.5, end: 360.3, from: 120, to: 20 },
  { kind: 'black', start: 590, end: 600, toEnd: true },
];
const jobs = [];
const pictured = {
  ...source,
  pictureEvents: (id) => (id === 'r1' ? { events } : null),
  jobs: () => jobs,
};
const scenes = visualEventLines(pictured, { recordingId: 'r1', start: 240, end: 360 });
assert.equal(scenes.state, 'ready');
assert.deepEqual(scenes.events, [
  '240.10-240.75  cuts  3 in 0.7s, top score 31.2  [4:00.1-4:00.8]',
  '250.00-253.50  still picture  3.5s  brightness 61  [4:10.0-4:13.5]',
  '300.00  cut  score 15.4  [5:00.0]',
  '359.50-360.30  darker  brightness 120 -> 20  [5:59.5-6:00.3]',
]);
assert.deepEqual(scenes.counts, { black: 0, still: 1, cut: 4, fade: 1 });
assert.match(scenes.how, /recording/);
// A span reaching into the window counts; the window ends at the recording's end.
const tail = visualEventLines(pictured, { recordingId: 'r1', start: 595, end: 900 });
assert.equal(tail.toSeconds, 600);
assert.deepEqual(tail.events, ['590.00-600.00  black  10.0s  [9:50.0-10:00.0]']);
assert.deepEqual(
  visualEventLines(pictured, { recordingId: 'r1', kinds: ['black'] }).events.length,
  2,
);
// Paging: 200 lines a page, then the rest from next_cursor.
const many = Array.from({ length: 450 }, (_, i) => ({ kind: 'cut', start: i, score: 20 }));
const paged = { ...pictured, pictureEvents: () => ({ events: many }) };
const first = visualEventLines(paged, { recordingId: 'r1' });
assert.equal(first.events.length, 200);
assert.equal(first.nextCursor, '200');
const last = visualEventLines(paged, { recordingId: 'r1', cursor: '400' });
assert.equal(last.events.length, 50);
assert.equal(last.nextCursor, undefined);
assert.throws(() => visualEventLines(paged, { recordingId: 'r1', cursor: 'x' }), AgentReadError);
assert.throws(
  () => visualEventLines(pictured, { recordingId: 'r1', start: 700 }),
  AgentReadError,
  'a window after the end of the recording is refused',
);
assert.throws(() => visualEventLines(pictured, { recordingId: 'sample' }), AgentReadError);
// No stored events: say where the pass stands, never an empty list that reads as no changes.
const unread = { ...pictured, pictureEvents: () => null };
const none = visualEventLines(unread, { recordingId: 'r1' });
assert.equal(none.state, 'not analysed');
assert.equal(none.events, undefined);
assert.match(none.note, /Analyse picture now/);
jobs.push({
  id: 'j1',
  sourceId: 'r1',
  kind: 'visual',
  state: 'failed',
  progress: 0.2,
  message: 'FFmpeg stopped',
  updated: '2026-11-04T01:00:00Z',
});
assert.equal(visualEventLines(unread, { recordingId: 'r1' }).state, 'failed');
jobs.unshift({
  ...jobs[0],
  id: 'j2',
  state: 'queued',
  message: 'Paused: transcription running',
  updated: '2026-11-04T02:00:00Z',
});
assert.match(
  visualEventLines(unread, { recordingId: 'r1' }).note,
  /waiting \(Paused: transcription/,
);
jobs.unshift({ ...jobs[0], id: 'j3', state: 'running', progress: 0.425 });
const reading = visualEventLines(unread, { recordingId: 'r1' });
assert.equal(reading.state, 'reading');
assert.match(reading.note, /42%/);

// Screen text (VC-191): every line the screen showed, as facts, filtered and paged; no labels.
const text = (t, first, last, box, seen = 2, score = 0.95) => ({
  text: t,
  box,
  first,
  last,
  seen,
  score,
});
const readText = {
  version: 1,
  width: 1920,
  height: 1080,
  keyframes: 600,
  read: 580,
  gpu: true,
  elapsedMs: 60000,
  created: '2026-11-04T00:00:00Z',
  lines: [
    text('Orchel', 10, 13, [588, 714, 700, 750], 4, 0.98),
    text("Got it. I'll do my very best.", 10, 13, [495, 760, 1700, 800], 4),
    text('Only...', 10, 13, [700, 805, 1100, 840], 4, 0.9),
    text('128', 12, 12, [1500, 100, 1560, 130], 1, 0.7),
    text('Objective: Reach the bridge', 0, 300, [40, 40, 400, 70], 300),
    text('42', 20, 25, [150, 903, 190, 933], 6),
    text('HP', 20, 25, [100, 900, 140, 930], 6),
    text('Save', 400, 401, [1800, 1000, 1880, 1040]),
  ],
};
const shown = {
  ...source,
  screenText: (id) => (id === 'r1' ? readText : null),
  screenTextEngine: () => '',
  jobs: () => [],
};
assert.equal(screenArea([588, 714, 700, 750], 1920, 1080), 'bottom centre');
assert.equal(screenArea([40, 40, 400, 70], 1920, 1080), 'top left');
assert.equal(screenArea([0, 0, 1920, 1080], 1920, 1080), 'centre');
assert.equal(screenArea([1900, 1070, 1920, 1080], 1920, 1080), 'bottom right');
assert.ok(
  numbersOnly('128') && numbersOnly('-1,250') && numbersOnly('12:05') && numbersOnly('50%'),
);
assert.ok(!numbersOnly('HP 42') && !numbersOnly('...') && !numbersOnly('x2'));
// By default (M391): pieces on screen over the same keyframes in one area are one compact line,
// in reading order; nothing says what they are.
const window = screenTextLines(shown, { recordingId: 'r1', start: 9, end: 15 });
assert.equal(window.state, 'ready');
assert.equal(window.frame, undefined);
assert.equal(window.totalLines, 3);
assert.deepEqual(window.lines, [
  '10-13 bottom centre "Orchel / Got it. I\'ll do my very best. / Only..."',
  '12-12 top right "128"',
  '0-300 top left "Objective: Reach the bridge"',
]);
assert.deepEqual(window.areas, { 'bottom centre': 1, 'top right': 1, 'top left': 1 });
assert.match(window.how, /nothing is labelled/);
// A row reads left to right even when its pieces sit a few pixels apart.
assert.deepEqual(screenTextLines(shown, { recordingId: 'r1', start: 20, end: 25 }).lines, [
  '0-300 top left "Objective: Reach the bridge"',
  '20-25 bottom left "HP / 42"',
]);
// detail: every piece on its own line with its box, keyframes and confidence.
const detailed = screenTextLines(shown, { recordingId: 'r1', start: 9, end: 15, detail: true });
assert.equal(detailed.frame, '1920x1080');
assert.equal(detailed.totalLines, 5);
assert.deepEqual(detailed.lines.slice(0, 2), [
  '10.0-13.0  bottom centre 588,714,700,750  3.0s/4kf  0.98  "Orchel"',
  '10.0-13.0  bottom centre 495,760,1700,800  3.0s/4kf  0.95  "Got it. I\'ll do my very best."',
]);
assert.match(detailed.how, /confidence/);
// Filters the agent chooses: screen areas, time on screen, and lines that are only numbers.
assert.equal(
  screenTextLines(shown, { recordingId: 'r1', areas: ['bottom centre'], detail: true }).totalLines,
  3,
);
assert.deepEqual(
  screenTextLines(shown, { recordingId: 'r1', minSeconds: 3.5 }).lines.map((l) => l.split('"')[1]),
  ['Objective: Reach the bridge', 'HP / 42'],
);
assert.deepEqual(
  screenTextLines(shown, { recordingId: 'r1', start: 20, end: 25, numbers: false }).lines,
  ['0-300 top left "Objective: Reach the bridge"', '20-25 bottom left "HP"'],
);
assert.equal(screenTextLines(shown, { recordingId: 'r1' }).totalLines, 5, 'Defaults return all');
assert.throws(() => screenTextLines(shown, { recordingId: 'r1', minSeconds: -1 }), AgentReadError);
assert.throws(() => screenTextLines(shown, { recordingId: 'r1', cursor: 'x' }), AgentReadError);
assert.throws(() => screenTextLines(shown, { recordingId: 'r1', start: 700 }), AgentReadError);
// 200 lines a page with next_cursor; each page counts its own areas.
const crowded = {
  ...shown,
  screenText: () => ({
    ...readText,
    lines: Array.from({ length: 450 }, (_, i) => text(`${i}`, i, i + 1, [10, 10, 40, 30])),
  }),
};
const p1 = screenTextLines(crowded, { recordingId: 'r1' });
assert.equal(p1.lines.length, 200);
assert.equal(p1.nextCursor, '200');
assert.deepEqual(p1.areas, { 'top left': 200 });
const p3 = screenTextLines(crowded, { recordingId: 'r1', cursor: '400' });
assert.equal(p3.lines.length, 50);
assert.equal(p3.nextCursor, undefined);
// Not ready: where the pass stands, never an empty list; get_context says it per recording.
const textJobs = [];
const unreadText = { ...shown, screenText: () => null, jobs: () => textJobs };
const notRead = screenTextLines(unreadText, { recordingId: 'r1' });
assert.equal(notRead.state, 'not analysed');
assert.equal(notRead.lines, undefined);
assert.match(notRead.note, /Analyse picture now/);
assert.equal(
  screenTextLines(
    { ...unreadText, screenTextEngine: () => 'Screen text engine not installed.' },
    {
      recordingId: 'r1',
    },
  ).state,
  'engine not installed',
);
textJobs.push({
  id: 't1',
  sourceId: 'r1',
  kind: 'text',
  state: 'queued',
  progress: 0,
  message: 'Waiting for this recording’s picture events',
  updated: '2026-11-04T01:00:00Z',
});
const waitingText = screenTextLines(unreadText, { recordingId: 'r1' });
assert.equal(waitingText.state, 'waiting');
assert.match(waitingText.note, /picture events/);
textJobs[0] = { ...textJobs[0], state: 'running', progress: 0.37 };
assert.equal(screenTextLines(unreadText, { recordingId: 'r1' }).state, 'reading');
textJobs[0] = { ...textJobs[0], state: 'failed', message: 'The screen text engine stopped.' };
assert.equal(screenTextLines(unreadText, { recordingId: 'r1' }).state, 'failed');
assert.deepEqual(
  contextPacket(shown).alreadyMarked.map((r) => [r.recordingId, r.screenText]),
  contextPacket(source).alreadyMarked.map((r) => [
    r.recordingId,
    r.recordingId === 'r1' ? 'ready' : 'not analysed',
  ]),
);
assert.equal(contextPacket(unreadText).alreadyMarked[0].screenText, 'failed');

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
  scenes,
  none,
  window,
  notRead,
]);
for (const secret of ['I:\\\\Recordings', 'media://', 'C:\\\\x', 'sourcePath', 'poster'])
  assert.ok(!everything.includes(secret), `answers leak ${secret}`);
console.log(
  'Agent read tools: views, summaries, context, paging, picture events, screen text and no paths passed.',
);
