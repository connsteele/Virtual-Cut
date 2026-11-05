import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  heardAsEdits,
  heardAsRules,
  heardAsUsed,
  heardAsWord,
  hintVocabulary,
  validHeardAs,
} from '../dist-electron/heard-as.js';
import { validateContexts, defaultContext } from '../dist-electron/project-context.js';
import { applyTranscriptCommand, correctedText } from '../dist-electron/transcript-edits.js';
import { emptyModel, mergeEdits, validateEdits } from '../dist-electron/project-edits.js';

const rules = heardAsRules([{ name: 'Cai', heard: ['Kai', 'Kye'] }]).rules;

test('whole words in any case, keeping spacing, punctuation and a possessive', () => {
  assert.deepEqual(heardAsWord(' Kai,', rules), { text: ' Cai,', heard: 'Kai' });
  assert.deepEqual(heardAsWord(" Kai's", rules), { text: " Cai's", heard: 'Kai' });
  assert.deepEqual(heardAsWord(' KAI’s.', rules), { text: ' Cai’s.', heard: 'KAI' });
  assert.deepEqual(heardAsWord('"kye?"', rules), { text: '"Cai?"', heard: 'kye' });
  for (const word of [' Kaiser', ' Kai-like', ' Cai', ' Okai', ' Kais', ' 3Kai'])
    assert.equal(heardAsWord(word, rules), null, word);
});

test('rows: one word for one word, cue words never, names box conflicts named', () => {
  const { rules: r, problems } = heardAsRules(
    [
      { name: 'Cai', heard: ['Kai'] },
      { name: 'Yu Phas', heard: ['Euphos'] },
      { name: 'Leda', heard: [] },
      { name: '', heard: ['Tiala'] },
      { name: 'Marc', heard: ['Mark'] },
      { name: 'Kye', heard: ['Kai'] },
      { name: 'Orchel', heard: ['Archel', 'orchel'] },
      { name: '', heard: [] },
    ],
    'Orchel, Archel\nTheodora',
  );
  assert.deepEqual(
    [...r],
    [
      ['kai', 'Cai'],
      ['archel', 'Orchel'],
    ],
  );
  assert.deepEqual(
    problems.map((p) => [p.row, p.field]),
    [
      [1, 'heard'],
      [2, 'heard'],
      [3, 'name'],
      [4, 'heard'],
      [5, 'heard'],
      [6, 'heard'],
    ],
  );
  assert.match(problems[0].text, /one word for one word/);
  assert.match(problems[3].text, /spoken cue word/);
  assert.match(problems[4].text, /both Cai and Kye; Cai is used/);
  assert.match(problems[5].text, /also in the names box/);
});

test('hints carry each row’s game spelling once, never the heard spelling', () => {
  assert.equal(hintVocabulary({ vocabulary: 'Orchel, Theodora' }), 'Orchel, Theodora');
  assert.equal(
    hintVocabulary({
      vocabulary: 'Orchel, cai',
      heardAs: [
        { name: 'Cai', heard: ['Kai'] },
        { name: 'Leda', heard: ['Lida'] },
        { name: 'Leda', heard: ['Leeda'] },
      ],
    }),
    'Orchel, cai, Leda',
  );
  assert.equal(
    hintVocabulary({ vocabulary: '', heardAs: [{ name: 'Cai', heard: ['Kai'] }] }),
    'Cai',
  );
  assert.equal(hintVocabulary(undefined), '');
});

const transcript = { id: 't1', sourceId: 'r1', role: 'mic', state: 'complete', track: 2 };
const segments = [
  {
    id: 0,
    start: 0,
    end: 2,
    text: ' With Kai, I believe.',
    words: words(' With', ' Kai,', ' I', ' believe.'),
  },
  {
    id: 1,
    start: 3,
    end: 5,
    text: " Kai's grandma, Kaiser.",
    words: words(" Kai's", ' grandma,', ' Kaiser.'),
  },
  { id: 2, start: 6, end: 8, text: ' Theodora and Kai', words: words(' Theodora', ' and', ' Kai') },
  { id: 3, start: 9, end: 9.5, text: ' Kai here.', words: words(' Kai', ' here.') },
];
function words(...texts) {
  return texts.map((text, i) => ({ start: i, end: i + 0.5, text, probability: 0.9 }));
}

test('edits skip the user’s own corrections, phrase edits and restored words', () => {
  const model = {
    transcriptEdits: [
      { id: 't1:2:2', transcriptId: 't1', segmentId: 2, wordIndex: 2, text: ' Kye' },
      { id: 't1:3:phrase', transcriptId: 't1', segmentId: 3, text: 'Cai is here.' },
      { id: 't2:0:1', transcriptId: 't2', segmentId: 0, wordIndex: 1, text: ' Other' },
    ],
    heardAsKept: ['t1:1:0'],
  };
  const { edits, own } = heardAsEdits(model, transcript, segments, rules);
  assert.deepEqual(edits, [
    { id: 't1:0:1', transcriptId: 't1', segmentId: 0, wordIndex: 1, text: ' Cai,', heardAs: 'Kai' },
  ]);
  assert.equal(own, 3);
  // A second pass after applying finds nothing new and counts nothing as the user's.
  const again = heardAsEdits(
    { ...model, transcriptEdits: [...model.transcriptEdits, ...edits] },
    transcript,
    segments,
    rules,
  );
  assert.deepEqual(again, { edits: [], own: 3 });
  assert.deepEqual(heardAsEdits({}, transcript, segments, new Map()), { edits: [], own: 0 });
  assert.deepEqual(heardAsUsed(edits), [{ pair: 'Kai → Cai', words: 1 }]);
  assert.deepEqual(
    heardAsUsed([
      { text: " Cai's", heardAs: 'kai' },
      { text: ' Cai.', heardAs: 'Kai' },
      { text: ' Typed' },
    ]),
    [{ pair: 'Kai → Cai', words: 2 }],
  );
});

test('a restored heard-as word is kept; Undo-able like any correction', () => {
  const base = {
    ...emptyModel(),
    recordings: [{ id: 'r1', title: 'Battle', context: '', url: '', poster: '', duration: 10 }],
  };
  const { edits } = heardAsEdits(base, transcript, segments, rules);
  const corrected = validateEdits({ ...base, transcriptEdits: edits });
  assert.equal(correctedText(corrected, 't1', segments[1]), " Cai's grandma, Kaiser.");
  const restored = applyTranscriptCommand(
    corrected,
    transcript,
    segments[0],
    {
      action: 'restore',
      projectId: 'p',
      sourceId: 'r1',
      transcriptId: 't1',
      segmentId: 0,
      wordIndex: 1,
      expected: JSON.stringify(edits[0]),
    },
    () => 'x',
  );
  assert.deepEqual(restored.heardAsKept, ['t1:0:1']);
  assert.equal(correctedText(restored, 't1', segments[0]), ' With Kai, I believe.');
  assert.deepEqual(heardAsEdits(restored, transcript, segments, rules), { edits: [], own: 1 });
  // The kept list merges and validates like the other edit collections.
  const merged = validateEdits(mergeEdits(corrected, restored, corrected));
  assert.deepEqual(merged.heardAsKept, ['t1:0:1']);
  assert.throws(() => validateEdits({ ...base, heardAsKept: [42] }), /kept heard-as/);
  assert.throws(
    () => validateEdits({ ...base, transcriptEdits: [{ ...edits[0], heardAs: 'x'.repeat(101) }] }),
    /Invalid transcript correction/,
  );
});

test('a game’s rows are validated with its context', () => {
  const context = (heardAs) => ({
    ...defaultContext('project'),
    gameMode: 'set',
    game: { id: 'g', name: "Fortune's Weave", vocabulary: '', heardAs },
  });
  assert.doesNotThrow(() => validateContexts([context([{ name: 'Cai', heard: ['Kai'] }])]));
  assert.doesNotThrow(() => validateContexts([context(undefined)]));
  for (const bad of [
    'Cai',
    [{ name: 'Cai', heard: 'Kai' }],
    [{ name: 'x'.repeat(101), heard: [] }],
    Array.from({ length: 201 }, () => ({ name: 'a', heard: [] })),
    [{ name: 'Cai', heard: Array.from({ length: 21 }, () => 'k') }],
  ]) {
    assert.equal(validHeardAs(bad), false);
    assert.throws(() => validateContexts([context(bad)]));
  }
});
