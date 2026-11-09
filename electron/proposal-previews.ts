import type { Model } from './workflow-types.js';
import type { AgentProposal } from './proposal-contracts.js';
import type { CueKind, TranscriptSegment, TranscriptSummary } from './transcript-contracts.js';
import { correctedText, cueCandidate, reviewedCue } from './transcript-edits.js';
import { proposalStatus } from './proposal-edits.js';

/**
 * A proposal still waiting for review, as the main timeline previews it (VC-170): a faint band
 * for ranges and clip ranges, a faint line for markers, notes and Splits, in the proposer's
 * colour. Read-only; deciding stays on the transcript window's cards.
 */
export interface ProposalPreview {
  /** The transcript window cards it stands for; focusing any of them brightens it. */
  cards: string[];
  who: 'spoken' | 'agent' | 'both';
  kind: 'marker' | 'range' | 'note' | 'split' | 'clip';
  start: number;
  /** Ranges and clip ranges only. */
  end?: number;
  label: string;
}

const kindLabel: Record<ProposalPreview['kind'], string> = {
  marker: 'Marker',
  range: 'Range marker',
  note: 'Timed note',
  split: 'Split',
  clip: 'Clip range',
};
export const previewKindLabel = (kind: ProposalPreview['kind']) => kindLabel[kind];

interface HeardCue {
  card: string;
  lineId: number;
  kind: CueKind;
  time: number;
  text: string;
  pending: boolean;
}
const boundary = (kind: CueKind) => kind === 'clip-start' || kind === 'clip-end';

/**
 * Every pending proposal for one recording: the agent's, and the spoken cues heard in its
 * current microphone transcript. A spoken cue an agent reworked shows once, as the agent's.
 */
export function proposalPreviews(
  proposals: AgentProposal[],
  model: Pick<Model, 'transcriptEdits' | 'cueDecisions'>,
  mic?: TranscriptSummary,
  segments: Iterable<TranscriptSegment> = [],
): ProposalPreview[] {
  const decisions = model.cueDecisions || [];
  const previews: ProposalPreview[] = [];
  for (const p of proposals) {
    if (proposalStatus(decisions, p.id) !== 'pending') continue;
    // A change previews the marker or clip as accepting would leave it (VC-204).
    const kind =
      p.kind === 'cut'
        ? 'split'
        : p.kind === 'clip' || p.edit?.target === 'clip'
          ? 'clip'
          : p.kind === 'note'
            ? 'note'
            : p.end != null
              ? 'range'
              : 'marker';
    previews.push({
      cards: [p.id],
      who: p.refines ? 'both' : 'agent',
      kind,
      start: p.time,
      ...((kind === 'range' || kind === 'clip') && p.end != null ? { end: p.end } : {}),
      label: p.kind === 'cut' && p.names ? `${p.names.first} | ${p.names.second}` : p.title,
    });
  }
  if (mic?.role === 'mic') {
    // A rework that isn't rejected takes the spoken cue's card (VC-155), and its preview.
    const claimed = new Set(
      proposals
        .filter(
          (p) =>
            p.refines?.transcriptId === mic.id && proposalStatus(decisions, p.id) !== 'rejected',
        )
        .map((p) => p.refines!.lineId),
    );
    const heard: HeardCue[] = [];
    for (const original of segments) {
      const segment = { ...original, text: correctedText(model, mic.id, original) };
      const cue = cueCandidate(mic, segment);
      if (!cue) continue;
      heard.push({
        card: `cue:${mic.id}:${segment.id}`,
        lineId: segment.id,
        kind: cue.kind,
        time: cue.time,
        text: cue.text,
        pending: !reviewedCue(decisions, mic, segment),
      });
    }
    heard.forEach((cue, i) => {
      if (claimed.has(cue.lineId)) return;
      if (boundary(cue.kind)) {
        // Clip start and end pair only with the adjacent boundary cue, as on the cards.
        const next = heard.slice(i + 1).find((c) => boundary(c.kind));
        const previous = heard
          .slice(0, i)
          .reverse()
          .find((c) => boundary(c.kind));
        if (cue.kind === 'clip-end' && previous?.kind === 'clip-start') return;
        const partner = cue.kind === 'clip-start' && next?.kind === 'clip-end' ? next : undefined;
        const pair = partner ? [cue, partner] : [cue];
        const cards = pair.filter((c) => c.pending && !claimed.has(c.lineId)).map((c) => c.card);
        if (!cards.length) return;
        previews.push({
          cards,
          who: 'spoken',
          kind: 'clip',
          start: cue.time,
          ...(partner ? { end: partner.time } : {}),
          label: cue.text || partner?.text || 'Clip',
        });
        return;
      }
      if (!cue.pending) return;
      const kind = cue.kind === 'cut' ? 'split' : cue.kind === 'note' ? 'note' : 'marker';
      previews.push({
        cards: [cue.card],
        who: 'spoken',
        kind,
        start: cue.time,
        label: cue.text || kindLabel[kind],
      });
    });
  }
  return previews.sort((a, b) => a.start - b.start);
}

/** A card's times while they are edited (VC-174): a start, and an end for a range. */
export interface PreviewTimes {
  start: number;
  end?: number;
}

/** Times a transcript window may send with its focused card: finite and not negative. */
export function previewTimes(value: unknown): value is PreviewTimes {
  if (!value || typeof value !== 'object') return false;
  const { start, end, ...rest } = value as Record<string, unknown>;
  const time = (t: unknown) => typeof t === 'number' && Number.isFinite(t) && t >= 0;
  return !Object.keys(rest).length && time(start) && (end === undefined || time(end));
}

/**
 * Where a dragged preview edge lands (VC-184): `edge` of a range, or the point itself, set to
 * `value` inside the recording, in milliseconds like the card's fields. A range keeps at least
 * `min` seconds between its edges, so an edge can't be dragged past the other one.
 */
export function adjustPreview(
  from: PreviewTimes,
  edge: 'start' | 'end',
  value: number,
  duration: number,
  min: number,
): PreviewTimes {
  const ms = (t: number) => Math.round(t * 1000) / 1000;
  const clamp = (t: number, lo: number, hi: number) => ms(Math.max(lo, Math.min(hi, t)));
  if (from.end === undefined) return { start: clamp(value, 0, duration) };
  return edge === 'start'
    ? { start: clamp(value, 0, Math.max(0, from.end - min)), end: from.end }
    : { start: from.start, end: clamp(value, Math.min(duration, from.start + min), duration) };
}

/**
 * The previews with the focused card's edited times in place of its saved ones, so the timeline
 * shows where a nudge lands before the proposal is accepted (VC-174).
 */
export function previewsAt(
  previews: ProposalPreview[],
  card: string | null,
  at: PreviewTimes | undefined,
): ProposalPreview[] {
  if (card == null || !at) return previews;
  return previews.map((p) => {
    if (!p.cards.includes(card)) return p;
    const end = at.end ?? p.end;
    // A start nudged past its end still draws, edges in order, until the card says otherwise.
    return end === undefined
      ? { ...p, start: at.start }
      : { ...p, start: Math.min(at.start, end), end: Math.max(at.start, end) };
  });
}
