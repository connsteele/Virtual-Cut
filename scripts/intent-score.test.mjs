import assert from 'node:assert/strict';
import { parseTaggedNotes, splitTarget } from '../dist-electron/intent-notes.js';
import { scoreRecording } from '../dist-electron/intent-score.js';

// Tagged mic notes (VC-128, VC-155): the notes read as written, and the scorer credits each
// intent only when a proposal of that intent sits on the tagged speech.
const notes = parseTaggedNotes(`Notes
Context in [brackets], categories in {} such as {maker}, {general}
Time Format
MM:SS:FF

00:03:17
{general}
This is starting the big main quest

00:19:40
Split [The split here should occur at the scene change, around 18s 4f not at the exact time]

01:16:54
{maker, general}
It's the first time we see Orchel [the cat priest]

2:56:05
{general, notion}
There's a lot of things here with Theodora and then Orchel is kind of like
the resurrection of Yu Phas

04:41:59
Split [around 4m 40s]

04:55:16
[A lot of coughing, ignore it]

06:05:59
{notion}
Note [explicit cue] I really like the heroic games

09:49:26
split [this one is exactly where I'd want it]

27:52:14
{general, marker}
The drakes treasures with all our lords here {Cai's hand from earlier}

31:41:38
split [in the black area between scenes]
`);
const at = (written) => notes.entries.find((e) => e.written === written);
{
  assert.equal(notes.fps, 60);
  assert.equal(notes.micTrack, 2);
  assert.equal(notes.entries.length, 10);
  assert.equal(at('00:03:17').at, 3 + 17 / 60);
  assert.deepEqual(at('01:16:54').tags, ['marker', 'general'], '{maker} reads as marker');
  assert.equal(at('01:16:54').said, "It's the first time we see Orchel");
  assert.deepEqual(at('01:16:54').context, ['the cat priest']);
  assert.equal(at('2:56:05').at, 2 * 60 + 56 + 5 / 60, 'a time without a leading zero');
  assert.match(at('2:56:05').said, /like the resurrection of Yu Phas$/, 'speech spans lines');
  assert.equal(at('00:19:40').command, 'split');
  assert.deepEqual(at('00:19:40').splitAt, { kind: 'time', time: 18 + 4 / 60 });
  assert.deepEqual(at('04:41:59').splitAt, { kind: 'time', time: 280 });
  assert.deepEqual(at('09:49:26').splitAt, { kind: 'exact' });
  assert.deepEqual(at('31:41:38').splitAt, { kind: 'scene-change' });
  assert.equal(at('04:55:16').ignore, true);
  assert.equal(at('04:55:16').said, '');
  assert.equal(at('06:05:59').cueWord, 'note');
  assert.equal(at('06:05:59').ignore, false);
  assert.deepEqual(at('27:52:14').tags, ['general', 'marker']);
  assert.deepEqual(at('27:52:14').context, ["Cai's hand from earlier"], 'other braces are notes');
  assert.equal(splitTarget([]), undefined);
  assert.deepEqual(splitTarget(['would want it at 8m 7s during the loading screen']), {
    kind: 'time',
    time: 487,
  });
  assert.deepEqual(splitTarget(['around 18s']), { kind: 'time', time: 18 });
  assert.equal(splitTarget(['no idea']), undefined);
  const fps = parseTaggedNotes('FPS: 30\nMic track: 3\n00:01:15\n{edit}\ncut before this\n');
  assert.equal(fps.entries[0].at, 1.5);
  assert.equal(fps.micTrack, 3);
  assert.deepEqual(fps.entries[0].tags, ['edit']);
  assert.equal(fps.entries[0].command, undefined, 'a tagged "cut before this" is an edit');
  assert.equal(parseTaggedNotes('00:01:00\nCut.\n').entries[0].command, 'split');
  assert.equal(parseTaggedNotes('00:01:00\nclip in\n').entries[0].command, 'clip-start');
  assert.equal(parseTaggedNotes('00:01:00\nClip out\n').entries[0].command, 'clip-end');
  assert.equal(parseTaggedNotes('00:01:00\nMarker here\n').entries[0].cueWord, 'marker');
  assert.equal(parseTaggedNotes('00:01:00 - 00:02:00\nNote x\n').entries[0].end, 2);
}

const p = (id, values) => ({
  id,
  source: 'agent',
  kind: 'marker',
  title: id,
  intents: [],
  mic: [],
  status: 'pending',
  ...values,
});
{
  const score = scoreRecording(notes.entries, [
    // On the {marker, general} line, cited: covers both.
    p('orchel', {
      time: 76.5,
      intents: ['marker', 'general'],
      mic: [{ start: 76.6, end: 80 }],
      status: 'accepted',
      movedSeconds: -0.4,
    }),
    // A composite note cites two lines and covers {general} and {notion} on both.
    p('composite', {
      kind: 'note',
      time: 3,
      intents: ['general', 'notion'],
      mic: [
        { start: 3, end: 7 },
        { start: 175.8, end: 182 },
      ],
    }),
    // A game moment just before the speech, without mic evidence.
    p('treasure', { time: 1665, intents: ['marker'], status: 'rejected' }),
    // On the cough: false.
    p('cough', { time: 295.5, mic: [{ start: 295.2, end: 297 }] }),
    // Nowhere near tagged speech: false.
    p('stray', { time: 1000, intents: ['general'] }),
    // Past the tagged part: not scored.
    p('late', { time: 5000 }),
    // Splits: on the given time, late for a scene change, right where said, early enough.
    p('s1', { kind: 'split', time: 18.4 }),
    p('s2', { kind: 'split', time: 281.7, source: 'spoken' }),
    p('s3', { kind: 'split', time: 589.3 }),
    p('s4', { kind: 'split', time: 1899.1 }),
  ]);
  const entry = (w) => score.entries.find((e) => e.written === w);
  assert.equal(score.labelledUntil, Math.round((31 * 60 + 41 + 38 / 60 + 60) * 100) / 100);
  assert.deepEqual(entry('01:16:54').covered, ['marker', 'general']);
  assert.deepEqual(entry('00:03:17').covered, ['general']);
  assert.deepEqual(entry('2:56:05').covered, ['general', 'notion']);
  assert.deepEqual(entry('06:05:59').missing, ['notion']);
  assert.deepEqual(entry('27:52:14').covered, ['marker'], 'a marker without general');
  assert.deepEqual(entry('27:52:14').missing, ['general']);
  assert.deepEqual(entry('04:55:16').proposals, ['cough']);
  assert.deepEqual(
    score.falseProposals.map((f) => [f.id, f.reason]),
    [
      ['cough', 'on speech marked to ignore'],
      ['stray', 'no tagged speech nearby'],
    ],
  );
  assert.deepEqual(entry('00:19:40').split, {
    target: '18.07 s',
    proposal: 's1',
    offsetSeconds: 0.33,
    onTarget: true,
  });
  assert.equal(entry('04:41:59').split.onTarget, false, '1.7 s after 4:40');
  assert.equal(entry('09:49:26').split.onTarget, true);
  assert.equal(entry('31:41:38').split.onTarget, true, '2.5 s before the word');
  const intent = (n) => score.intents.find((i) => i.intent === n);
  assert.deepEqual(intent('marker'), {
    intent: 'marker',
    tagged: 2,
    covered: 2,
    proposals: 4,
    matched: 2,
    accepted: 1,
    rejected: 1,
  });
  assert.deepEqual(intent('notion'), {
    intent: 'notion',
    tagged: 2,
    covered: 1,
    proposals: 1,
    matched: 1,
    accepted: 0,
    rejected: 0,
  });
  assert.deepEqual(intent('general').covered, 3);
  assert.deepEqual(intent('split'), {
    intent: 'split',
    tagged: 4,
    covered: 3,
    proposals: 4,
    matched: 4,
    accepted: 0,
    rejected: 0,
  });
  assert.deepEqual(score.decisions, { accepted: 1, rejected: 1, pending: 7, moved: 1 });
}
{
  const empty = scoreRecording([], []);
  assert.equal(empty.labelledUntil, 60);
  assert.deepEqual(empty.falseProposals, []);
  const none = scoreRecording(notes.entries, []);
  assert.equal(none.entries.find((e) => e.command).split.proposal, undefined);
  assert.equal(none.entries.find((e) => e.command).split.onTarget, false);
}
console.log('Intent notes and scoring checks passed.');
