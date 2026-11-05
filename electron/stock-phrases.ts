/**
 * Stock phrases the speech model writes where nobody spoke (VC-166): over coughs, silence and
 * game noise it falls back on the endings of the videos it learned from. One list for the whole
 * app: microphone lines are dropped with it, and the vocabulary-hint guard (VC-164) sends it to
 * the speech worker, which redoes a hinted span that comes back as one of these.
 *
 * Entries are written already normalised (see `normalisePhrase`).
 */
export const stockPhrases: readonly string[] = [
  'thank you',
  'thank you very much',
  'thank you so much',
  'thanks',
  'thank you for watching',
  'thanks for watching',
  'thank you for watching and see you next time',
  'thanks for watching and see you next time',
  'see you next time',
  'see you in the next video',
  'please subscribe',
  'please like and subscribe',
  'like and subscribe',
  'subscribe',
  'bye',
  'bye bye',
  'goodbye',
  'you',
];

/** Lower case, letters, digits and apostrophes only, single spaces. The worker matches it. */
export function normalisePhrase(text: string) {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const known = new Set(stockPhrases);
export const isStockPhrase = (text: string) => known.has(normalisePhrase(text));
