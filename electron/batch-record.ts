import type { Clip, Marker, Model, Note } from './workflow-types.js';
import type { AgentProposal, EditFields } from './proposal-contracts.js';
import type { CueDecision, ProposalKindChange, ProposalWhy } from './transcript-contracts.js';
import type { ExportRecord } from './export-contracts.js';
import { proposalDecision, proposalIntents } from './proposal-edits.js';

/**
 * Batch records (VC-182): one small JSON per batch that keeps the agent's first pass beside the
 * state the user exported, so later passes can learn from the misses. It holds times, names and
 * notes only: no media, no paths and no copy of the import state, just pointers to what the
 * agent read. It lives in per-user data, outside the editable model and Undo.
 */
export const batchRecordVersion = 1;

export interface RecordClip {
  id: string;
  name: string;
  start: number;
  end: number;
  folder: string;
  include: boolean;
  note?: string;
}
export interface RecordMarker {
  id: string;
  time: number;
  end?: number;
  name: string;
  note?: string;
  color?: string;
}
export interface RecordNote {
  id: string;
  time?: number;
  title: string;
  text: string;
}
export interface RecordingState {
  clips: RecordClip[];
  markers: RecordMarker[];
  notes: RecordNote[];
}
/** One submit_proposals call, with what the agent read when it made it. */
export interface RecordRun {
  submissionId: string;
  recordingId: string;
  submitted: string;
  agent: string;
  model?: string;
  /** What the agent said this pass was for (submit_proposals run_intent). */
  intent?: string;
  proposals: number;
  /** Landed after the user had decided a proposal on this recording: not first pass. */
  afterDecisions?: boolean;
  read: {
    intentGuideVersion: string;
    transcripts: { role: 'mic' | 'game'; transcriptId: string; corrections: number }[];
    projectRevision: number;
  };
}
export interface RecordProposal {
  id: string;
  recordingId: string;
  /** change: an edit of a marker or clip already in the project (VC-204). */
  kind: 'marker' | 'note' | 'split' | 'clip' | 'change';
  time: number;
  end?: number;
  title: string;
  note?: string;
  clipNames?: { first: string; second: string };
  /** The marker color the agent suggested (VC-200). */
  color?: string;
  /** The Resolve clip color the agent suggested for a clip range (VC-204). */
  clipColor?: string;
  /** A change (VC-204): its target, and the touched fields as they were and as proposed. */
  change?: { target: 'marker' | 'clip'; targetId: string; before: EditFields; after: EditFields };
  intents: string[];
  submissionId: string;
}
export interface FirstPassRecording {
  id: string;
  title: string;
  duration: number;
  /** When the agent's first proposals for it landed, before any decision. */
  frozen: string;
  /** What the recording held when they landed (spoken cues, the user's earlier work). */
  before?: RecordingState;
  proposals: RecordProposal[];
}
export type ItemOrigin =
  | { proposalId: string }
  | 'before-first-pass'
  /** Added by the user, not from any proposal: what the agent missed. */
  | 'user';
export interface FieldChange<T> {
  from: T;
  to: T;
}
export interface Changes {
  start?: FieldChange<number>;
  end?: FieldChange<number | undefined>;
  name?: FieldChange<string>;
  note?: FieldChange<string>;
  /** A marker's color (VC-200). */
  color?: FieldChange<string | undefined>;
}
export interface FinalRecording {
  id: string;
  title: string;
  duration: number;
  /** `splitBy`: a clip from before the first pass that an accepted split proposal cut. */
  clips: (RecordClip & { origin: ItemOrigin; splitBy?: string; changed?: Changes })[];
  markers: (RecordMarker & { origin: ItemOrigin; changed?: Changes })[];
  notes: (RecordNote & { origin: ItemOrigin; changed?: Changes })[];
  /** What accepting made, or what was there before, that is gone by export. */
  removedItems: { kind: 'clip' | 'marker' | 'note'; id: string; origin: ItemOrigin }[];
  /** Spans of the recording outside every included clip; absent when it has no clips. */
  removedSpans?: { start: number; end: number }[];
}
/** One withdraw_proposals call on one recording (VC-201): the agent's, not the user's. */
export interface RecordWithdrawal {
  at: string;
  recordingId: string;
  agent: string;
  proposalIds: string[];
  reason?: string;
}
export interface FinalProposal {
  id: string;
  /** withdrawn: its agent took it back before the user decided it (VC-201). */
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  decided?: string;
  withdrawn?: { at: string; reason?: string };
  /** What accepting chose (position, end, title or clip names), before any later change. */
  chosen?: {
    time: number;
    end?: number;
    title?: string;
    note?: string;
    clipNames?: { first: string; second: string };
    /** The color of the marker accepting made (VC-200). */
    color?: string;
  };
  /**
   * How the chosen values differ from the proposal (VC-184): its time and end moved on the card
   * (nudged, typed or dragged on the timeline preview), and its title or note edited. Absent when
   * it was accepted as proposed.
   */
  changed?: Changes;
  /** Accepted as the other range kind: clip range ↔ range marker (VC-186). */
  kindChange?: ProposalKindChange;
  /** The user's reason: a reject's one-tap reason, or a line about either (VC-173). */
  why?: ProposalWhy;
  /**
   * What happened later to what accepting made (VC-173): moved, retitled, given or cleared an end
   * (a point marker dragged into a range in Cut), or removed. The same items carry `changed` in
   * `recordings`; this links them back to the proposal.
   */
  afterAccepting?: LaterChange[];
  firstPass: boolean;
}
export interface LaterChange {
  item: 'clip' | 'marker' | 'note';
  id: string;
  /** A clip from before the first pass that this split cut, not one accepting made. */
  splitClip?: true;
  changed?: Changes;
  removed?: true;
}
export interface BatchRecord {
  recordVersion: typeof batchRecordVersion;
  project: { id: string; name: string };
  batch: { id: string; name: string };
  updated: string;
  runs: RecordRun[];
  firstPass: FirstPassRecording[];
  /** Proposals the agent took back, newest last; absent until it withdraws one (VC-201). */
  withdrawals?: RecordWithdrawal[];
  /** The state at the latest export in this batch; absent until something is exported. */
  final?: {
    exported: string;
    projectRevision: number;
    recordings: FinalRecording[];
    proposals: FinalProposal[];
    exports: {
      exportId?: string;
      clipId: string;
      name: string;
      start: number;
      end: number;
      state: string;
    }[];
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const kindName = {
  mark: 'marker',
  note: 'note',
  cut: 'split',
  clip: 'clip',
  edit: 'change',
} as const;

/** The batch a recording answers for: the active batch if it holds it, else its own first. */
export function batchOf(model: Model, activeBatchId: string, recordingId: string) {
  const ids = model.recordings.find((r) => r.id === recordingId)?.batchIds || [];
  return ids.includes(activeBatchId) ? activeBatchId : ids[0];
}

function clipState(c: Clip): RecordClip {
  return {
    id: c.id,
    name: c.name,
    start: round(c.start),
    end: round(c.end),
    folder: c.folder,
    include: c.include,
    ...(c.note ? { note: c.note } : {}),
  };
}
function markerState(m: Marker): RecordMarker {
  return {
    id: m.id,
    time: round(m.time),
    ...(m.end !== undefined ? { end: round(m.end) } : {}),
    name: m.name,
    ...(m.note ? { note: m.note } : {}),
    ...(m.color ? { color: m.color } : {}),
  };
}
function noteState(n: Note): RecordNote {
  return {
    id: n.id,
    ...(n.time !== undefined ? { time: round(n.time) } : {}),
    title: n.title,
    text: n.text,
  };
}
export function recordingState(model: Model, recordingId: string): RecordingState {
  return {
    clips: model.clips.filter((c) => c.rid === recordingId).map(clipState),
    markers: (model.markers[recordingId] || []).map(markerState),
    notes: model.notes.filter((n) => n.sourceId === recordingId).map(noteState),
  };
}
export function recordProposal(p: AgentProposal): RecordProposal {
  return {
    id: p.id,
    recordingId: p.sourceId,
    kind: kindName[p.kind],
    time: round(p.time),
    ...(p.end !== undefined ? { end: round(p.end) } : {}),
    title: p.title,
    ...(p.text ? { note: p.text } : {}),
    ...(p.names ? { clipNames: p.names } : {}),
    ...(p.color ? { color: p.color } : {}),
    ...(p.clipColor ? { clipColor: p.clipColor } : {}),
    ...(p.edit
      ? {
          change: {
            target: p.edit.target,
            targetId: p.edit.targetId,
            before: p.edit.seen,
            after: p.edit.set,
          },
        }
      : {}),
    intents: proposalIntents(p),
    submissionId: p.submissionId,
  };
}
function emptyRecord(
  project: BatchRecord['project'],
  batch: BatchRecord['batch'],
  now: string,
): BatchRecord {
  return {
    recordVersion: batchRecordVersion,
    project,
    batch,
    updated: now,
    runs: [],
    firstPass: [],
  };
}

/**
 * Adds one submission. Proposals landing on a recording before any of its proposals is decided
 * join its first pass, which is frozen with what the recording held when the first ones landed.
 */
export function addSubmission(
  record: BatchRecord | undefined,
  input: {
    project: BatchRecord['project'];
    batch: BatchRecord['batch'];
    model: Model;
    proposals: AgentProposal[];
    /** Every stored proposal of this recording, the new ones included. */
    stored: AgentProposal[];
    runIntent?: string;
    intentGuideVersion: string;
    transcripts: RecordRun['read']['transcripts'];
    projectRevision: number;
    now: string;
  },
): BatchRecord {
  const next = record
    ? { ...structuredClone(record), batch: input.batch }
    : emptyRecord(input.project, input.batch, input.now);
  const first = input.proposals[0];
  const recording = input.model.recordings.find((r) => r.id === first.sourceId)!;
  // A decision or a withdrawal on this recording ends its first pass: what lands after it is a
  // revised pass (VC-201).
  const decided = input.stored.some(
    (p) => p.withdrawn || proposalDecision(input.model.cueDecisions || [], p.id),
  );
  next.runs.push({
    submissionId: first.submissionId,
    recordingId: recording.id,
    submitted: first.submitted,
    agent: first.agent.name,
    ...(first.agent.model ? { model: first.agent.model } : {}),
    ...(input.runIntent ? { intent: input.runIntent } : {}),
    proposals: input.proposals.length,
    ...(decided ? { afterDecisions: true } : {}),
    read: {
      intentGuideVersion: input.intentGuideVersion,
      transcripts: input.transcripts,
      projectRevision: input.projectRevision,
    },
  });
  if (!decided) {
    let pass = next.firstPass.find((r) => r.id === recording.id);
    if (!pass) {
      pass = {
        id: recording.id,
        title: recording.title,
        duration: round(recording.duration),
        frozen: input.now,
        before: recordingState(input.model, recording.id),
        proposals: [],
      };
      next.firstPass.push(pass);
    }
    pass.proposals.push(...input.proposals.map(recordProposal));
  }
  next.updated = input.now;
  return next;
}

/** Proposals on one recording that their agent withdrew in one call. */
export function addWithdrawal(
  record: BatchRecord | undefined,
  input: {
    project: BatchRecord['project'];
    batch: BatchRecord['batch'];
    recordingId: string;
    agent: string;
    proposalIds: string[];
    reason?: string;
    now: string;
  },
): BatchRecord {
  const next = record
    ? { ...structuredClone(record), batch: input.batch }
    : emptyRecord(input.project, input.batch, input.now);
  next.withdrawals = [
    ...(next.withdrawals || []),
    {
      at: input.now,
      recordingId: input.recordingId,
      agent: input.agent,
      proposalIds: input.proposalIds,
      ...(input.reason ? { reason: input.reason } : {}),
    },
  ];
  next.updated = input.now;
  return next;
}

function chosenOf(d: CueDecision | undefined, p: AgentProposal): FinalProposal['chosen'] {
  if (d?.status !== 'accepted') return undefined;
  const time = round(d.appliedTime ?? p.time);
  // A change keeps what accepting wrote (VC-204).
  if (d.edit) {
    const a = d.edit.applied;
    return {
      time,
      ...(a.end != null ? { end: round(a.end) } : {}),
      ...(a.name != null ? { title: a.name } : {}),
      ...(a.note != null ? { note: a.note } : {}),
      ...(a.color != null ? { color: a.color } : {}),
    };
  }
  // A split's decision keeps the two clip names in title and text.
  if (p.kind === 'cut')
    return {
      time,
      ...(d.title != null ? { clipNames: { first: d.title, second: d.text ?? '' } } : {}),
    };
  return {
    time,
    ...(d.appliedEnd !== undefined ? { end: round(d.appliedEnd) } : {}),
    ...(d.title != null ? { title: d.title } : {}),
    ...(d.text != null ? { note: d.text } : {}),
    ...(d.color ? { color: d.color } : {}),
  };
}
/** What accepting changed from the proposal itself; a split's names are in `chosen`. */
function proposalChanges(p: AgentProposal, chosen: NonNullable<FinalProposal['chosen']>) {
  // A change compares what the user wrote with what the agent proposed (VC-204).
  if (p.edit) {
    const set = p.edit.set;
    return changes(
      {
        start: round(set.time ?? chosen.time),
        end: set.end == null ? chosen.end : round(set.end),
        name: set.name ?? chosen.title,
        note: set.note ?? chosen.note,
        color: (set.color ?? chosen.color) || undefined,
      },
      {
        start: chosen.time,
        end: chosen.end,
        name: chosen.title,
        note: chosen.note,
        color: chosen.color,
      },
    );
  }
  const cut = p.kind === 'cut';
  return changes(
    {
      start: round(p.time),
      end: p.end === undefined || cut ? undefined : round(p.end),
      ...(cut ? {} : { name: p.title, note: p.text }),
      // The card showed Blue when the agent gave no color.
      ...(chosen.color ? { color: p.color ?? 'Blue' } : {}),
    },
    {
      start: chosen.time,
      end: chosen.end,
      name: chosen.title,
      note: chosen.note,
      color: chosen.color,
    },
  );
}
/** An item's position, end, name and note, whatever its kind. */
interface Comparable {
  start: number;
  end?: number;
  name?: string;
  note?: string;
  /** Markers only, and only compared when the earlier side has one. */
  color?: string;
}
function comparable(x: RecordClip | RecordMarker | RecordNote): Comparable {
  if ('start' in x) return { start: x.start, end: x.end, name: x.name, note: x.note };
  if ('name' in x) return { start: x.time, end: x.end, name: x.name, note: x.note, color: x.color };
  return { start: x.time ?? 0, name: x.title, note: x.text };
}
function changes(was: Comparable, now: Comparable): Changes | undefined {
  const out: Changes = {};
  if (Math.abs(was.start - now.start) > 0.0005) out.start = { from: was.start, to: now.start };
  if (
    was.end !== now.end &&
    !(was.end !== undefined && now.end !== undefined && Math.abs(was.end - now.end) <= 0.0005)
  )
    out.end = { from: was.end, to: now.end };
  if (was.name !== undefined && was.name !== now.name)
    out.name = { from: was.name, to: now.name ?? '' };
  if ((was.note ?? '') !== (now.note ?? ''))
    out.note = { from: was.note ?? '', to: now.note ?? '' };
  if (was.color !== undefined && was.color !== now.color)
    out.color = { from: was.color, to: now.color };
  return Object.keys(out).length ? out : undefined;
}
/** How an item differs from what was chosen, comparing only what was chosen. */
function changedFrom(chosen: Comparable, current: Comparable) {
  // A split's new clip has no chosen note, nor an end unless the clip it cut is known.
  return changes(chosen, {
    ...current,
    end: 'end' in chosen ? current.end : undefined,
    note: 'note' in chosen ? current.note : undefined,
  });
}
/**
 * What accepting a proposal made, with the values chosen on its card. A split's new clip runs
 * to where the clip it cut ended, when that is known (`splitEnd`).
 */
function madeBy(
  p: AgentProposal,
  d: CueDecision | undefined,
  splitEnd?: number,
): { id: string; kind: 'clip' | 'marker' | 'note'; chosen: Comparable } | undefined {
  if (d?.status !== 'accepted') return undefined;
  const start = round(d.appliedTime ?? p.time);
  const end = d.appliedEnd === undefined ? undefined : round(d.appliedEnd);
  if (d.markerId)
    return {
      id: d.markerId,
      kind: 'marker',
      chosen: {
        start,
        end,
        name: d.title ?? p.title,
        note: d.text ?? p.text,
        ...(d.color ? { color: d.color } : {}),
      },
    };
  if (d.noteId)
    return {
      id: d.noteId,
      kind: 'note',
      chosen: { start, name: d.title ?? p.title, note: d.text ?? p.text },
    };
  if (d.clipId && p.kind === 'cut')
    return {
      id: d.clipId,
      kind: 'clip',
      chosen: {
        start,
        ...(splitEnd !== undefined ? { end: splitEnd } : {}),
        ...(d.text != null ? { name: d.text } : {}),
      },
    };
  if (d.clipId)
    return {
      id: d.clipId,
      kind: 'clip',
      chosen: { start, end, name: d.title ?? p.title, note: d.text ?? p.text },
    };
  return undefined;
}
/**
 * Later changes to what accepting a proposal made, read from the project as it is now (VC-173):
 * for get_proposal_decisions, between exports. A split reports its new clip only.
 */
export function changesSinceAccepting(
  model: Model,
  p: AgentProposal,
  d: CueDecision | undefined,
): LaterChange[] {
  const m = madeBy(p, d);
  if (!m) return [];
  const now = recordingState(model, p.sourceId);
  const items: (RecordClip | RecordMarker | RecordNote)[] =
    m.kind === 'clip' ? now.clips : m.kind === 'marker' ? now.markers : now.notes;
  const item = items.find((x) => x.id === m.id);
  if (!item) return [{ item: m.kind, id: m.id, removed: true }];
  const changed = changedFrom(m.chosen, comparable(item));
  return changed ? [{ item: m.kind, id: m.id, changed }] : [];
}
/** The spans of a recording no included clip covers. */
export function removedSpans(
  duration: number,
  clips: Pick<RecordClip, 'start' | 'end' | 'include'>[],
) {
  const kept = clips
    .filter((c) => c.include)
    .map((c) => [c.start, c.end] as const)
    .sort((a, b) => a[0] - b[0]);
  const out: { start: number; end: number }[] = [];
  let at = 0;
  for (const [start, end] of kept) {
    if (start - at > 0.001) out.push({ start: round(at), end: round(start) });
    at = Math.max(at, end);
  }
  if (duration - at > 0.001) out.push({ start: round(at), end: round(duration) });
  return out;
}

/**
 * The state at export, each item linked to the proposal it came from, marked as there before
 * the first pass, or as the user's own; with what changed after accepting and what was removed.
 */
export function finalState(
  record: BatchRecord | undefined,
  input: {
    project: BatchRecord['project'];
    batch: BatchRecord['batch'];
    model: Model;
    /** Every stored proposal of the batch's recordings. */
    proposals: AgentProposal[];
    exports: ExportRecord[];
    projectRevision: number;
    now: string;
  },
): BatchRecord {
  const next = record
    ? { ...structuredClone(record), batch: input.batch }
    : emptyRecord(input.project, input.batch, input.now);
  const recordings = input.model.recordings.filter(
    (r) => !r.sample && !r.retained && r.batchIds?.includes(input.batch.id),
  );
  const ids = new Set(recordings.map((r) => r.id));
  const decisions = input.model.cueDecisions || [];
  const proposals = input.proposals.filter((p) => ids.has(p.sourceId));
  // Proposals that predate batch records: their first pass is rebuilt from the proposal store,
  // without the state they landed on.
  for (const r of recordings) {
    const own = proposals.filter((p) => p.sourceId === r.id);
    if (!own.length || next.firstPass.some((f) => f.id === r.id)) continue;
    next.firstPass.push({
      id: r.id,
      title: r.title,
      duration: round(r.duration),
      frozen: own[0].submitted,
      proposals: own.map(recordProposal),
    });
  }
  const inFirstPass = new Set(next.firstPass.flatMap((f) => f.proposals.map((p) => p.id)));
  // What accepting made, by item id, with the values chosen on the card.
  const made = new Map<
      string,
      { proposalId: string; kind: 'clip' | 'marker' | 'note'; chosen: Comparable }
    >(),
    splitBy = new Map<string, { proposalId: string; chosen: Comparable }>();
  for (const p of proposals) {
    const d = proposalDecision(decisions, p.id);
    if (d?.status !== 'accepted') continue;
    const time = d.appliedTime ?? p.time;
    let splitEnd: number | undefined;
    if (d.clipId && p.kind === 'cut') {
      // The clip it split, as it was when the first pass froze: it ends at the split now, and
      // the new clip runs from the split to its old end. Later changes to either are the user's.
      const held = (next.firstPass.find((f) => f.id === p.sourceId)?.before?.clips || []).filter(
        (c) => c.start < time - 0.001 && c.end > time + 0.001,
      );
      const split =
        held.find((c) =>
          input.model.clips.some((x) => x.id === c.id && Math.abs(x.end - time) < 0.001),
        ) || (held.length === 1 ? held[0] : undefined);
      if (split) {
        splitBy.set(split.id, {
          proposalId: p.id,
          chosen: { start: split.start, end: round(time), name: d.title ?? split.name },
        });
        splitEnd = split.end;
      }
    }
    const m = madeBy(p, d, splitEnd);
    if (m) made.set(m.id, { proposalId: p.id, kind: m.kind, chosen: m.chosen });
  }
  const finals: FinalRecording[] = recordings.map((r) => {
    const now = recordingState(input.model, r.id);
    const before = next.firstPass.find((f) => f.id === r.id)?.before;
    const origin = (kind: keyof RecordingState, id: string): ItemOrigin => {
      const m = made.get(id);
      if (m) return { proposalId: m.proposalId };
      return before?.[kind].some((x) => x.id === id) ? 'before-first-pass' : 'user';
    };
    const was = (kind: keyof RecordingState, id: string) => {
      const m = made.get(id) || splitBy.get(id);
      if (m) return m.chosen;
      const b = before?.[kind].find((x) => x.id === id);
      return b && comparable(b);
    };
    const changed = (kind: keyof RecordingState, id: string, current: Comparable) => {
      const w = was(kind, id);
      return w && changedFrom(w, current);
    };
    const withChanges = <T extends object>(item: T, c: Changes | undefined) =>
      c ? { ...item, changed: c } : item;
    const present = new Set([...now.clips, ...now.markers, ...now.notes].map((x) => x.id));
    const removedItems: FinalRecording['removedItems'] = [];
    for (const [id, m] of made)
      if (!present.has(id) && proposals.find((p) => p.id === m.proposalId)?.sourceId === r.id)
        removedItems.push({ kind: m.kind, id, origin: { proposalId: m.proposalId } });
    for (const kind of ['clips', 'markers', 'notes'] as const)
      for (const x of before?.[kind] || [])
        if (!present.has(x.id))
          removedItems.push({
            kind: kind === 'clips' ? 'clip' : kind === 'markers' ? 'marker' : 'note',
            id: x.id,
            origin: 'before-first-pass',
          });
    return {
      id: r.id,
      title: r.title,
      duration: round(r.duration),
      clips: now.clips.map((c) =>
        withChanges(
          {
            ...c,
            origin: origin('clips', c.id),
            ...(splitBy.has(c.id) ? { splitBy: splitBy.get(c.id)!.proposalId } : {}),
          },
          changed('clips', c.id, comparable(c)),
        ),
      ),
      markers: now.markers.map((m) =>
        withChanges(
          { ...m, origin: origin('markers', m.id) },
          changed('markers', m.id, comparable(m)),
        ),
      ),
      notes: now.notes.map((n) =>
        withChanges({ ...n, origin: origin('notes', n.id) }, changed('notes', n.id, comparable(n))),
      ),
      removedItems,
      ...(now.clips.length ? { removedSpans: removedSpans(r.duration, now.clips) } : {}),
    };
  });
  // Later changes per proposal, from the items above that point back to it.
  const later = new Map<string, LaterChange[]>();
  const link = (proposalId: string, change: LaterChange) =>
    later.set(proposalId, [...(later.get(proposalId) || []), change]);
  for (const r of finals) {
    for (const [item, list] of [
      ['clip', r.clips],
      ['marker', r.markers],
      ['note', r.notes],
    ] as const)
      for (const x of list as (
        | FinalRecording['clips'][number]
        | FinalRecording['markers'][number]
        | FinalRecording['notes'][number]
      )[]) {
        if (!x.changed) continue;
        if (typeof x.origin === 'object')
          link(x.origin.proposalId, { item, id: x.id, changed: x.changed });
        else if ('splitBy' in x && x.splitBy)
          link(x.splitBy, { item, id: x.id, splitClip: true, changed: x.changed });
      }
    for (const x of r.removedItems)
      if (typeof x.origin === 'object')
        link(x.origin.proposalId, { item: x.kind, id: x.id, removed: true });
  }
  next.final = {
    exported: input.now,
    projectRevision: input.projectRevision,
    recordings: finals,
    proposals: proposals.map((p) => {
      const d = proposalDecision(decisions, p.id);
      const chosen = chosenOf(d, p);
      const changed = chosen && proposalChanges(p, chosen);
      return {
        id: p.id,
        status: d?.status || (p.withdrawn ? 'withdrawn' : 'pending'),
        ...(d?.decided ? { decided: d.decided } : {}),
        ...(!d && p.withdrawn
          ? {
              withdrawn: {
                at: p.withdrawn.at,
                ...(p.withdrawn.reason ? { reason: p.withdrawn.reason } : {}),
              },
            }
          : {}),
        ...(chosen ? { chosen } : {}),
        ...(changed ? { changed } : {}),
        ...(d?.status === 'accepted' && d.kindChange ? { kindChange: d.kindChange } : {}),
        ...(d?.why ? { why: d.why } : {}),
        ...(later.has(p.id) ? { afterAccepting: later.get(p.id) } : {}),
        firstPass: inFirstPass.has(p.id),
      };
    }),
    exports: input.exports
      .filter((e) => ids.has(e.plan.sourceId) && e.state !== 'planned')
      .map((e) => ({
        exportId: e.plan.id,
        clipId: e.plan.clipId,
        name: e.plan.name,
        start: round(e.plan.requested.start),
        end: round(e.plan.requested.end),
        state: e.state,
      })),
  };
  next.updated = input.now;
  return next;
}
/** An export in the record finished or failed: bring its state up to date, nothing else. */
export function settleExports(record: BatchRecord, exports: ExportRecord[]) {
  let changed = false;
  for (const e of record.final?.exports || []) {
    const now = exports.find((x) => x.plan.id === e.exportId)?.state;
    if (now && now !== e.state) {
      e.state = now;
      changed = true;
    }
  }
  return changed;
}
