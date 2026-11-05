import { correctionId } from './transcript-edits.js';
import type { Model } from './workflow-types.js';
import type {
  TranscriptEdit,
  TranscriptSegment,
  TranscriptSummary,
} from './transcript-contracts.js';

/**
 * VC-194: a game's Heard as list. Each row names the game's spelling and the spellings the speech
 * model writes instead, e.g. Cai heard as Kai. After recognition every whole-word match of a heard
 * spelling becomes the game's spelling as an ordinary, visible correction: Original still shows
 * what was heard, and Restore original or Undo takes it back. Works the same for every game.
 *
 * One word for one word: a word correction in Virtual Cut is one word, so a row with spaces on
 * either side (Yu Phas heard as Euphos) stays a vocabulary hint only and says so.
 */
export interface HeardAs {
  name: string;
  heard: string[];
}
export const heardAsLimits = { rows: 200, heard: 20, length: 100 };

export interface HeardAsProblem {
  row: number;
  field: 'name' | 'heard';
  text: string;
}

/** A word's letters and digits, with inner apostrophes or hyphens (Tali'Zorah, C-Sec). */
const core = /^(\s*[^\p{L}\p{N}]*)([\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*)([^\p{L}\p{N}]*\s*)$/u;
const possessive = /^(.+?)(['’]s)$/iu;
const single = /^[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*$/u;
const lower = (s: string) => s.toLocaleLowerCase();
/** Spoken cue words are frozen (AGENTS.md): a heard-as row never rewrites one. */
const cueWords = new Set(['marker', 'mark', 'note', 'cut', 'split', 'clip']);

/** Names and terms from the vocabulary box: comma or line separated. */
export function vocabularyTerms(vocabulary = '') {
  return vocabulary
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Splits a heard-as box ("Kai, Kye") into spellings. */
export const heardList = (text: string) =>
  text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

/** The spellings that will be corrected, keyed by lower case, plus what is wrong with the rows. */
export function heardAsRules(rows: HeardAs[] = [], vocabulary = '') {
  const rules = new Map<string, string>();
  const problems: HeardAsProblem[] = [];
  const terms = new Set(vocabularyTerms(vocabulary).map(lower));
  rows.forEach((row, index) => {
    const name = row.name.trim();
    const heard = row.heard.map((h) => h.trim()).filter(Boolean);
    if (!name && !heard.length) return;
    if (!name) {
      problems.push({
        row: index,
        field: 'name',
        text: `Row ${index + 1}: add the game spelling for ${heard.join(', ')}.`,
      });
      return;
    }
    if (!heard.length) {
      problems.push({
        row: index,
        field: 'heard',
        text: `${name}: add the spelling it is heard as.`,
      });
      return;
    }
    for (const h of heard) {
      if (!single.test(name) || !single.test(h)) {
        problems.push({
          row: index,
          field: 'heard',
          text: `${name} heard as ${h}: heard-as works one word for one word for now, so ${name} is only a hint.`,
        });
        continue;
      }
      if (lower(h) === lower(name)) continue;
      if (cueWords.has(lower(h))) {
        problems.push({
          row: index,
          field: 'heard',
          text: `${h} is a spoken cue word, so it is never replaced.`,
        });
        continue;
      }
      const taken = rules.get(lower(h));
      if (taken) {
        problems.push({
          row: index,
          field: 'heard',
          text: `${h} is heard as both ${taken} and ${name}; ${taken} is used.`,
        });
        continue;
      }
      if (terms.has(lower(h)))
        problems.push({
          row: index,
          field: 'heard',
          text: `${h} is also in the names box, so it would be both hinted and replaced. Remove one of them.`,
        });
      rules.set(lower(h), name);
    }
  });
  return { rules, problems };
}

/**
 * The vocabulary hint the speech model gets: the names box plus each Heard as row's game spelling
 * that the box doesn't already list. Heard spellings are never hinted (VC-164).
 */
export function hintVocabulary(game?: { vocabulary: string; heardAs?: HeardAs[] }) {
  if (!game) return '';
  const terms = new Set(vocabularyTerms(game.vocabulary).map(lower));
  const extra: string[] = [];
  for (const row of game.heardAs || []) {
    const name = row.name.trim();
    if (name && !terms.has(lower(name))) {
      terms.add(lower(name));
      extra.push(name);
    }
  }
  if (!extra.length) return game.vocabulary;
  return [game.vocabulary.trim(), extra.join(', ')].filter(Boolean).join(', ');
}

/** The corrected word, keeping its spacing, punctuation and a possessive 's; null when no rule applies. */
export function heardAsWord(text: string, rules: Map<string, string>) {
  const m = core.exec(text);
  if (!m) return null;
  const before = m[1];
  let [, , word, after] = m;
  let name = rules.get(lower(word));
  if (!name) {
    const p = possessive.exec(word);
    name = p ? rules.get(lower(p[1])) : undefined;
    if (!name || !p) return null;
    word = p[1];
    after = p[2] + after;
  }
  if (name === word) return null;
  return { text: before + name + after, heard: word };
}

/**
 * Heard-as corrections for one transcript. Words or phrases the user already corrected, and
 * words the user restored from a heard-as correction, are left as they are and counted as `own`.
 */
export function heardAsEdits(
  model: Pick<Model, 'transcriptEdits' | 'heardAsKept'>,
  transcript: Pick<TranscriptSummary, 'id'>,
  segments: Iterable<TranscriptSegment>,
  rules: Map<string, string>,
) {
  const edits: TranscriptEdit[] = [];
  let own = 0;
  if (!rules.size) return { edits, own };
  const existing = new Map(
    (model.transcriptEdits || [])
      .filter((e) => e.transcriptId === transcript.id)
      .map((e) => [e.id, e]),
  );
  const kept = new Set(model.heardAsKept || []);
  for (const segment of segments) {
    const phrase = existing.has(correctionId(transcript.id, segment.id));
    segment.words.forEach((word, index) => {
      const fixed = heardAsWord(word.text, rules);
      if (!fixed) return;
      const id = correctionId(transcript.id, segment.id, index);
      // Already corrected by an earlier heard-as pass: nothing to do, and not the user's own.
      if (!phrase && existing.get(id)?.heardAs) return;
      if (phrase || existing.has(id) || kept.has(id)) {
        own++;
        return;
      }
      edits.push({
        id,
        transcriptId: transcript.id,
        segmentId: segment.id,
        wordIndex: index,
        text: fixed.text,
        heardAs: fixed.heard,
      });
    });
  }
  return { edits, own };
}

/** "Kai → Cai" with its word count, for the transcript header. */
export function heardAsUsed(edits: TranscriptEdit[]) {
  const used = new Map<string, number>();
  for (const edit of edits) {
    if (!edit.heardAs) continue;
    const name = core.exec(edit.text)?.[2].replace(possessive, '$1') || edit.text.trim();
    const heard = edit.heardAs.replace(/^./u, (c) => c.toLocaleUpperCase());
    const key = `${heard} → ${name}`;
    used.set(key, (used.get(key) || 0) + 1);
  }
  return [...used].map(([pair, words]) => ({ pair, words }));
}

/** Rows as saved: trimmed, empty rows dropped. */
export function cleanHeardAs(rows: HeardAs[] = []): HeardAs[] {
  return rows
    .map((r) => ({ name: r.name.trim(), heard: r.heard.map((h) => h.trim()).filter(Boolean) }))
    .filter((r) => r.name || r.heard.length);
}

export function validHeardAs(rows: unknown): rows is HeardAs[] {
  const text = (s: unknown) => typeof s === 'string' && s.length <= heardAsLimits.length;
  return (
    Array.isArray(rows) &&
    rows.length <= heardAsLimits.rows &&
    rows.every(
      (r) =>
        r &&
        text(r.name) &&
        Array.isArray(r.heard) &&
        r.heard.length <= heardAsLimits.heard &&
        r.heard.every(text),
    )
  );
}
