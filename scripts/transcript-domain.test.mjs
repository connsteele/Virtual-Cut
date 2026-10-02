import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import {
  emptyModel,
  mergeEdits,
  editorial,
  validateEdits,
} from '../dist-electron/project-edits.js';
import {
  applyTranscriptCommand,
  correctedText,
  correctionId,
  cueCandidate,
  reviewedCue,
} from '../dist-electron/transcript-edits.js';
import {
  transcriptHandoff,
  transcriptSrt,
  subtitleTime,
} from '../dist-electron/transcript-export.js';
const { TranscriptStore } = createRequire(import.meta.url)('../dist-electron/transcript-store.cjs');
const transcript = {
  id: 'speech',
  sourceId: 'source',
  role: 'mic',
  track: 2,
  state: 'complete',
  context: { gameName: 'Example', vocabulary: 'Cai', brief: 'Review' },
};
const model = () => ({
  ...emptyModel(),
  recordings: [{ id: 'source', duration: 100 }],
  clips: [{ id: 'clip', rid: 'source', name: 'Original', start: 0, end: 100 }],
});
const phrase = (id = 0, text = 'This is Kai speaking.') => ({
  id,
  start: 10,
  end: 14,
  text,
  words: text.split(' ').map((text, i) => ({
    text: (i ? ' ' : '') + text,
    start: 10 + i,
    end: 11 + i,
    probability: 0.9,
  })),
});
const command = (action = 'correct', extra = {}) => ({
  projectId: 'project',
  sourceId: 'source',
  transcriptId: 'speech',
  segmentId: 0,
  action,
  expected: 'null',
  ...extra,
});
test('project edits reject malformed transcript records before persistence', () => {
  const edit = { id: 'x', transcriptId: 'speech', segmentId: 0, text: 'Cai' };
  for (const bad of [
    { id: null },
    { transcriptId: null },
    { segmentId: 1.5 },
    { segmentId: -1 },
    { wordIndex: -1 },
    { wordIndex: NaN },
    { text: 'x'.repeat(10001) },
  ])
    assert.throws(
      () => validateEdits({ ...emptyModel(), transcriptEdits: [{ ...edit, ...bad }] }),
      /transcript correction/,
    );
  const decision = {
    id: 'cue',
    status: 'accepted',
    sourceId: 'source',
    track: 2,
    kind: 'note',
    time: 2,
    noteId: 'note',
  };
  for (const bad of [
    { id: null },
    { status: 'automatic' },
    { markerId: 1 },
    { noteId: 1 },
    { sourceId: 1 },
    { track: -1 },
    { track: 1.5 },
    { kind: 'delete' },
    { time: NaN },
    { time: -1 },
  ])
    assert.throws(
      () => validateEdits({ ...emptyModel(), cueDecisions: [{ ...decision, ...bad }] }),
      /cue decision/,
    );
  assert.equal(
    validateEdits({
      ...emptyModel(),
      transcriptEdits: [{ ...edit, wordIndex: 0 }],
      cueDecisions: [decision],
    }).cueDecisions.length,
    1,
  );
  for (const field of ['transcriptEdits', 'cueDecisions'])
    assert.throws(
      () => validateEdits({ ...emptyModel(), [field]: Array(100001).fill({}) }),
      /Too many transcript/,
    );
  for (const bad of [{ time: -1 }, { time: NaN }, { sourceId: 1 }])
    assert.throws(
      () =>
        validateEdits({
          ...emptyModel(),
          notes: [{ id: 'note', title: 'Timed note', text: 'Text', url: '', ...bad }],
        }),
      /project note/,
    );
});
test('word corrections preserve spaces and originals; stale edits and invented word alignment fail', () => {
  const original = phrase(),
    before = JSON.stringify(original);
  const updated = applyTranscriptCommand(
    model(),
    transcript,
    original,
    command('correct', { wordIndex: 2, text: 'Cai' }),
    () => 'new',
  );
  assert.equal(correctedText(updated, 'speech', original), 'This is Cai speaking.');
  assert.equal(JSON.stringify(original), before);
  assert.throws(
    () =>
      applyTranscriptCommand(
        updated,
        transcript,
        original,
        command('correct', { wordIndex: 2, text: 'Blaze' }),
        () => 'new',
      ),
    /changed elsewhere/,
  );
  assert.throws(
    () =>
      applyTranscriptCommand(
        model(),
        transcript,
        original,
        command('correct', { wordIndex: 2, text: 'Blaze Arts' }),
        () => 'new',
      ),
    /Edit phrase/,
  );
  const edited = applyTranscriptCommand(
    updated,
    transcript,
    original,
    command('correct', { text: 'Blaze Arts is powerful.' }),
    () => 'new',
  );
  assert.equal(correctedText(edited, 'speech', original), 'Blaze Arts is powerful.');
  const restored = applyTranscriptCommand(
    edited,
    transcript,
    original,
    command('restore', { expected: JSON.stringify(edited.transcriptEdits.at(-1)) }),
    () => 'new',
  );
  assert.equal(correctedText(restored, 'speech', original), 'This is Cai speaking.');
});
test('older projects do not gain Undo entries merely through unchanged merges', () => {
  const current = model();
  assert.equal(editorial(current), editorial(mergeEdits(current, current, current)));
  const withEmptyFields = { ...current, transcriptEdits: [], cueDecisions: [], contexts: [] };
  assert.equal(editorial(current), editorial(withEmptyFields));
  assert.equal(editorial(current), editorial(mergeEdits(current, withEmptyFields, current)));
});
test('mic cues require review, distinguish Mark/Note/Cut, and reject ambiguous clip splits', () => {
  let next = model();
  for (const [i, text] of ['Mark remember Cai', 'Note longer thought', 'Cut'].entries()) {
    const segment = phrase(i, text);
    assert.equal(cueCandidate({ ...transcript, role: 'game' }, segment), null);
    next = applyTranscriptCommand(
      next,
      transcript,
      segment,
      command('accept-cue', { segmentId: i }),
      () => `generated-${i}`,
    );
  }
  assert.equal(next.markers.source[0].name, 'remember Cai');
  assert.equal(next.notes[0].text, 'longer thought');
  assert.equal(next.notes[0].time, 10);
  const rerun = {
    ...phrase(99, 'Mark remember Cai'),
    words: [{ text: 'Mark', start: 10.2, end: 10.5 }],
  };
  assert.equal(
    reviewedCue(next.cueDecisions, { ...transcript, id: 'rerun' }, rerun)?.status,
    'accepted',
  );
  assert.throws(
    () =>
      applyTranscriptCommand(
        next,
        { ...transcript, id: 'rerun' },
        rerun,
        command('accept-cue', { transcriptId: 'rerun', segmentId: 99 }),
        () => 'duplicate',
      ),
    /already reviewed/,
  );
  assert.deepEqual(
    next.clips.map((c) => [c.start, c.end]),
    [
      [0, 10],
      [10, 100],
    ],
  );
  assert.equal(cueCandidate(transcript, phrase(0, 'Mark is a character')), null);
  const overlap = model();
  overlap.clips.push({ ...overlap.clips[0], id: 'other' });
  assert.throws(
    () =>
      applyTranscriptCommand(
        overlap,
        transcript,
        phrase(0, 'Cut'),
        command('accept-cue'),
        () => 'new',
      ),
    /exactly one clip/,
  );
});
test('paged literal search, corrected matches, shared context and continuation across silence', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  try {
    const store = new TranscriptStore(db);
    store.put(transcript);
    store.put({ ...transcript, id: 'other' });
    assert.equal(db.prepare('SELECT count(*) AS n FROM transcript_contexts').get().n, 1);
    store.append('speech', phrase(0, 'Note first thought'));
    store.append('speech', { ...phrase(1, 'continuation after a long pause'), start: 80, end: 84 });
    store.append('speech', phrase(2, 'Mark next thought'));
    for (let i = 3; i < 65; i++) store.append('speech', phrase(i));
    assert.deepEqual(store.cueSegment('speech', 0).cueSegmentIds, [0, 1]);
    assert.match(store.cueSegment('speech', 0).cueText, /long pause/);
    assert.equal(store.segment('speech', 0).text, 'Note first thought');
    assert.equal(store.page('speech', 0, '').segments.length, 60);
    assert.equal(store.page('speech', 1, '').segments.length, 5);
    assert.equal(store.page('speech', 0, '%').total, 0);
    assert.equal(store.page('speech', 0, 'Cai', [3]).total, 1);
    const corrected = {
      transcriptEdits: [
        {
          id: correctionId('speech', 3),
          transcriptId: 'speech',
          segmentId: 3,
          text: 'Note restored after checking the audio',
        },
      ],
    };
    const candidate = store.page('speech', 0, '', [], corrected).segments.find((s) => s.id === 3);
    assert.equal(cueCandidate(transcript, candidate).kind, 'note');
    const accepted = applyTranscriptCommand(
      { ...model(), ...corrected },
      transcript,
      candidate,
      command('accept-cue', { segmentId: 3 }),
      () => 'recovered-note',
    );
    assert.match(accepted.notes[0].text, /restored after checking/);
    assert.equal(
      store.segment('speech', 3).text,
      phrase(3).text,
      'A manually recovered cue keeps its recognition original.',
    );
    store.removeSource('source');
    assert.equal(db.prepare('SELECT count(*) AS n FROM transcript_segments').get().n, 0);
  } finally {
    db.close();
  }
});
test('overlapping exported clips use source offsets, boundary words, corrections, and honest phrase precision', () => {
  const original = phrase(),
    edits = {
      transcriptEdits: [
        {
          id: correctionId('speech', 0, 2),
          transcriptId: 'speech',
          segmentId: 0,
          wordIndex: 2,
          text: ' Cai',
        },
      ],
    };
  const handoff = transcriptHandoff(transcript, [original], edits, {
    start: 11,
    end: 13,
    sourceStart: 5,
    timestampShift: -16,
    name: 'Clip',
  });
  assert.equal(handoff.spans[0].subtitleText, ' is Cai');
  assert.equal(handoff.spans[0].containerStart, 0);
  assert.equal(handoff.spans[0].clipStart, 0);
  assert.equal(handoff.spans[0].clipEnd, 2);
  assert.equal(handoff.spans[0].original.text, original.text);
  assert.equal(handoff.spans[0].partialPhrase, true);
  assert.match(transcriptSrt(handoff), /00:00:00,000 --> 00:00:02,000\nis Cai/);
  assert.equal(
    transcriptHandoff(transcript, [original], edits, {
      start: 12,
      end: 14,
      sourceStart: 0,
      timestampShift: -12,
      name: 'Overlapping clip',
    }).spans[0].subtitleText,
    ' Cai speaking.',
  );
  assert.equal(subtitleTime(90061.234), '25:01:01,234');
  edits.transcriptEdits.push({
    id: correctionId('speech', 0),
    transcriptId: 'speech',
    segmentId: 0,
    text: 'Different word count here now',
  });
  assert.equal(
    transcriptHandoff(transcript, [original], edits, {
      start: 10,
      end: 14,
      sourceStart: 0,
      timestampShift: -10,
      name: 'Full phrase',
    }).spans[0].timingPrecision,
    'phrase',
  );
});
