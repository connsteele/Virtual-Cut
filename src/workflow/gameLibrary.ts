import type { HeardAs } from '../../electron/heard-as';
// Saved games for the searchable game picker (VC-53). A game keeps one stable id wherever it is
// chosen, so later glossary and agent work can tell "the same game" apart from a similar title.
// The list lives in this computer's app storage; projects still save their own copy of the game.
export interface SavedGame {
  id: string;
  name: string;
  vocabulary: string;
  /** Spellings the speech model gets wrong, corrected after recognition (VC-194). */
  heardAs?: HeardAs[];
}
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const key = 'virtual-cut-games-v1';
const limit = 50;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
// Same shape check as the project's (electron/heard-as.ts); a bad saved list drops the game.
const rows = (value: unknown) =>
  Array.isArray(value) &&
  value.length <= 200 &&
  value.every(
    (r) =>
      r &&
      typeof r.name === 'string' &&
      Array.isArray(r.heard) &&
      r.heard.every((h: unknown) => typeof h === 'string'),
  );
const valid = (g: unknown): g is SavedGame =>
  !!g &&
  typeof (g as SavedGame).id === 'string' &&
  !!(g as SavedGame).id &&
  typeof (g as SavedGame).name === 'string' &&
  !!(g as SavedGame).name.trim() &&
  typeof (g as SavedGame).vocabulary === 'string' &&
  ((g as SavedGame).heardAs === undefined || rows((g as SavedGame).heardAs));

export function savedGames(storage?: Store): SavedGame[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter(valid).slice(0, limit) : [];
  } catch {
    return [];
  }
}
/** Most recent first; one entry per id and per title. */
export function rememberGame(game: SavedGame | undefined, storage?: Store) {
  if (!storage || !valid(game)) return;
  const next = [
    {
      id: game.id,
      name: game.name.trim(),
      vocabulary: game.vocabulary,
      ...(game.heardAs?.length ? { heardAs: game.heardAs } : {}),
    },
    ...savedGames(storage).filter((g) => g.id !== game.id && !same(g.name, game.name)),
  ].slice(0, limit);
  try {
    storage.setItem(key, JSON.stringify(next));
  } catch {
    // A full or blocked store only loses the suggestion, never the project's game.
  }
}
/** Saved games plus any used in this project, without duplicate titles. */
export function gameChoices(saved: SavedGame[], project: (SavedGame | undefined)[]) {
  const out: SavedGame[] = [];
  for (const g of [...project, ...saved])
    if (valid(g) && !out.some((x) => x.id === g.id || same(x.name, g.name))) out.push(g);
  return out;
}
/**
 * The game after typing a title: a saved title reuses that game's identity (and its terms when
 * none are typed yet); a new title becomes a new game, so renaming never relabels another game.
 */
export function pickGame(
  name: string,
  current: SavedGame | undefined,
  choices: SavedGame[],
  newId: () => string,
): SavedGame {
  const match = choices.find((g) => same(g.name, name));
  if (match) {
    const heardAs = current?.heardAs?.length ? current.heardAs : match.heardAs;
    return {
      id: match.id,
      name,
      vocabulary: current?.vocabulary?.trim() ? current.vocabulary : match.vocabulary,
      ...(heardAs?.length ? { heardAs } : {}),
    };
  }
  const known = current && choices.some((g) => g.id === current.id);
  return {
    id: current && !known ? current.id : newId(),
    name,
    vocabulary: current?.vocabulary || '',
    ...(current?.heardAs?.length ? { heardAs: current.heardAs } : {}),
  };
}
