import { intentTags, type IntentTag, type TaggedEntry } from './intent-notes.js';

/**
 * Scoring proposals against tagged mic notes (VC-128). Pure: the caller supplies the parsed
 * notes and the proposals with their decisions (from a project, a get_proposal_decisions answer
 * or a saved agent run). Adding a recording needs only its tagged .txt.
 */
export interface ScoredProposal {
  id: string;
  source: 'agent' | 'spoken';
  kind: 'marker' | 'note' | 'split' | 'clip';
  time: number;
  end?: number;
  title: string;
  intents: IntentTag[];
  /** Spans of the mic lines the proposal cites. */
  mic: { start: number; end: number }[];
  status: 'pending' | 'accepted' | 'rejected';
  movedSeconds?: number;
}
export interface EntryResult {
  written: string;
  at: number;
  said: string;
  tags: IntentTag[];
  command?: string;
  ignore: boolean;
  proposals: string[];
  covered: IntentTag[];
  missing: IntentTag[];
  split?: {
    target?: string;
    proposal?: string;
    /** Proposed cut minus the target (or the spoken time when the target is not a time). */
    offsetSeconds?: number;
    onTarget: boolean;
  };
}
export interface IntentSummary {
  intent: IntentTag | 'split';
  tagged: number;
  covered: number;
  proposals: number;
  matched: number;
  accepted: number;
  rejected: number;
}
export interface RecordingScore {
  labelledUntil: number;
  entries: EntryResult[];
  intents: IntentSummary[];
  falseProposals: { id: string; time: number; title: string; reason: string; status: string }[];
  decisions: { accepted: number; rejected: number; pending: number; moved: number };
}

const round = (n: number) => Math.round(n * 100) / 100;
/** Connor's written times run up to about 0.5 s after the recognizer's; allow some slack. */
const lead = 2,
  trail = 3;
/** A proposal without mic evidence matches speech this close, or a game moment up to `before` earlier. */
const near = 5,
  before = 20;

function speechWindow(entry: TaggedEntry, next?: TaggedEntry) {
  return [entry.at - lead, Math.min(entry.at + trail, next ? next.at - 0.5 : Infinity)] as const;
}
function matches(p: ScoredProposal, entry: TaggedEntry, next?: TaggedEntry) {
  const [from, to] = speechWindow(entry, next);
  if (p.mic.length) return p.mic.some((m) => m.start <= to && m.end >= from);
  // An uncited split answers a spoken Split (matched separately) or an {edit} line only.
  if (p.kind === 'split' && !entry.tags.includes('edit')) return false;
  return p.time >= entry.at - before && p.time <= entry.at + near;
}
function covers(p: ScoredProposal, tag: IntentTag) {
  if (tag === 'marker') return p.kind === 'marker' || p.intents.includes('marker');
  if (tag === 'edit') return p.kind === 'split' || p.kind === 'clip' || p.intents.includes('edit');
  return p.intents.includes(tag);
}
/** A split proposal's offset from where the spoken Split should cut, and whether it is close enough. */
function splitCheck(entry: TaggedEntry, p: ScoredProposal) {
  const t = entry.splitAt;
  if (t?.kind === 'time') {
    const offset = p.time - t.time!;
    return { offset, onTarget: Math.abs(offset) <= 1 };
  }
  const offset = p.time - entry.at;
  // The scene change ends before the word (1–4 s on Cai Ch4), so a cut at the word is late.
  // Without the picture the scorer only checks that the cut moved back by a plausible amount.
  if (t?.kind === 'scene-change') return { offset, onTarget: offset >= -8 && offset <= -0.5 };
  return { offset, onTarget: Math.abs(offset) <= 1.5 };
}

export function scoreRecording(
  entries: TaggedEntry[],
  proposals: ScoredProposal[],
  options: { labelledUntil?: number } = {},
): RecordingScore {
  const sorted = [...entries].sort((a, b) => a.at - b.at);
  const labelledUntil = options.labelledUntil ?? (sorted.at(-1)?.at ?? 0) + 60;
  const inRange = proposals.filter((p) => p.time <= labelledUntil);
  const used = new Map<string, TaggedEntry[]>();
  const results: EntryResult[] = sorted.map((entry, i) => {
    const next = sorted[i + 1];
    let found = inRange.filter((p) => matches(p, entry, next));
    let split: EntryResult['split'];
    if (entry.command === 'split') {
      // A spoken Split is matched by the nearest split proposal around it, cited or not.
      const candidates = inRange
        .filter((p) => p.kind === 'split' && p.time >= entry.at - 12 && p.time <= entry.at + 3)
        .map((p) => ({ p, ...splitCheck(entry, p) }))
        .sort(
          (a, b) =>
            Number(b.onTarget) - Number(a.onTarget) || Math.abs(a.offset) - Math.abs(b.offset),
        );
      const best = candidates[0];
      found = [...new Set([...found.filter((p) => p.kind !== 'split'), ...(best ? [best.p] : [])])];
      split = {
        target: entry.splitAt
          ? entry.splitAt.kind === 'time'
            ? `${round(entry.splitAt.time!)} s`
            : entry.splitAt.kind
          : undefined,
        proposal: best?.p.id,
        offsetSeconds: best ? round(best.offset) : undefined,
        onTarget: !!best?.onTarget,
      };
    }
    for (const p of found) used.set(p.id, [...(used.get(p.id) || []), entry]);
    const covered = entry.tags.filter((t) => found.some((p) => covers(p, t)));
    return {
      written: entry.written,
      at: round(entry.at),
      said: entry.said,
      tags: entry.tags,
      ...(entry.command ? { command: entry.command } : {}),
      ignore: entry.ignore,
      proposals: found.map((p) => p.id),
      covered,
      missing: entry.tags.filter((t) => !covered.includes(t)),
      ...(split ? { split } : {}),
    };
  });
  const falseProposals = inRange
    .filter((p) => {
      const hits = used.get(p.id) || [];
      return !hits.length || hits.every((e) => e.ignore);
    })
    .map((p) => ({
      id: p.id,
      time: round(p.time),
      title: p.title,
      reason: used.get(p.id)?.length ? 'on speech marked to ignore' : 'no tagged speech nearby',
      status: p.status,
    }));
  const tagged = (tag: IntentTag) => sorted.filter((e) => e.tags.includes(tag));
  const intents: IntentSummary[] = intentTags.map((intent) => {
    // Counted by what the proposal says it is; a split only covers an {edit} entry it matches.
    const withIntent = inRange.filter((p) =>
      intent === 'marker' ? covers(p, intent) : p.intents.includes(intent),
    );
    return {
      intent,
      tagged: tagged(intent).length,
      covered: results.filter((r) => r.covered.includes(intent)).length,
      proposals: withIntent.length,
      matched: withIntent.filter((p) => (used.get(p.id) || []).some((e) => e.tags.includes(intent)))
        .length,
      accepted: withIntent.filter((p) => p.status === 'accepted').length,
      rejected: withIntent.filter((p) => p.status === 'rejected').length,
    };
  });
  const splits = results.filter((r) => r.split),
    splitProposals = inRange.filter((p) => p.kind === 'split');
  intents.push({
    intent: 'split',
    tagged: splits.length,
    covered: splits.filter((r) => r.split!.onTarget).length,
    proposals: splitProposals.length,
    matched: splitProposals.filter((p) => splits.some((r) => r.split!.proposal === p.id)).length,
    accepted: splitProposals.filter((p) => p.status === 'accepted').length,
    rejected: splitProposals.filter((p) => p.status === 'rejected').length,
  });
  return {
    labelledUntil: round(labelledUntil),
    entries: results,
    intents,
    falseProposals,
    decisions: {
      accepted: inRange.filter((p) => p.status === 'accepted').length,
      rejected: inRange.filter((p) => p.status === 'rejected').length,
      pending: inRange.filter((p) => p.status === 'pending').length,
      moved: inRange.filter((p) => Math.abs(p.movedSeconds ?? 0) >= 0.001).length,
    },
  };
}
