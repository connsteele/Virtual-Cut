import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gameChoices, pickGame, rememberGame, savedGames } from '../src/workflow/gameLibrary.ts';

const store = () => {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
};
const weave = { id: 'g-weave', name: "Fortune's Weave", vocabulary: 'Cai, Castor' };

test('saved games are most recent first, one per id and title, and survive bad storage', () => {
  const s = store();
  assert.deepEqual(savedGames(s), []);
  rememberGame(weave, s);
  rememberGame({ id: 'g-other', name: 'Other', vocabulary: '' }, s);
  rememberGame({ ...weave, name: " fortune's weave " }, s);
  assert.deepEqual(
    savedGames(s).map((g) => [g.id, g.name]),
    [
      ['g-weave', "fortune's weave"],
      ['g-other', 'Other'],
    ],
  );
  rememberGame({ id: 'blank', name: '  ', vocabulary: '' }, s);
  assert.equal(savedGames(s).length, 2);
  s.setItem('virtual-cut-games-v1', '{not json');
  assert.deepEqual(savedGames(s), []);
  for (let i = 0; i < 60; i++) rememberGame({ id: `g${i}`, name: `Game ${i}`, vocabulary: '' }, s);
  assert.equal(savedGames(s).length, 50);
  assert.doesNotThrow(() =>
    rememberGame(weave, {
      getItem: () => '[]',
      setItem: () => {
        throw new Error('full');
      },
    }),
  );
});

test('a saved title keeps its identity; a new title never relabels another game', () => {
  let n = 0;
  const id = () => `new-${++n}`;
  const choices = gameChoices(
    [weave],
    [undefined, { id: 'g-project', name: 'Project game', vocabulary: '' }],
  );
  assert.deepEqual(
    choices.map((g) => g.id),
    ['g-project', 'g-weave'],
  );
  // Choosing a saved title, whatever the case, reuses its id and terms.
  assert.deepEqual(pickGame("FORTUNE'S WEAVE", undefined, choices, id), {
    id: 'g-weave',
    name: "FORTUNE'S WEAVE",
    vocabulary: 'Cai, Castor',
  });
  // Typed terms win over the saved ones.
  assert.equal(
    pickGame("Fortune's Weave", { ...weave, vocabulary: 'Mine' }, choices, id).vocabulary,
    'Mine',
  );
  // Editing a saved game's title makes a new game instead of renaming the saved one.
  const renamed = pickGame("Fortune's Weave DLC", weave, choices, id);
  assert.equal(renamed.id, 'new-1');
  // While a new title is typed it keeps one id.
  assert.equal(pickGame("Fortune's Weave DLC 2", renamed, choices, id).id, 'new-1');
});
