import { clipColors, markerColors, type Model } from './workflow-types.js';
import {
  rejectReasons,
  type CueDecision,
  type CueKind,
  type ProposalWhy,
  type RejectReason,
  type TranscriptCommand,
} from './transcript-contracts.js';
import type { AgentProposal, EditFields } from './proposal-contracts.js';
import { reopenDecision } from './decision-reopen.js';

/**
 * Deciding an agent proposal on its cue card (VC-162). Accepting does what accepting a spoken
 * cue of the same kind does; the decision goes into the model like a cue decision, so Undo
 * returns the proposal to review.
 */
export const proposalDecisionId = (proposalId: string) => `agent:${proposalId}`;
export const proposalCueKind = (proposal: Pick<AgentProposal, 'kind' | 'edit'>): CueKind =>
  proposal.kind === 'clip' || (proposal.kind === 'edit' && proposal.edit?.target === 'clip')
    ? 'clip-start'
    : proposal.kind === 'edit'
      ? 'mark'
      : proposal.kind;
export function proposalDecision(decisions: CueDecision[], proposalId: string) {
  return decisions.find((d) => d.proposalId === proposalId);
}
export function proposalStatus(decisions: CueDecision[], proposalId: string) {
  return proposalDecision(decisions, proposalId)?.status || 'pending';
}
/** Whether a proposal of this kind can rework a spoken cue of that kind (marker and note swap). */
export function reworkFits(kind: AgentProposal['kind'], cue: CueKind) {
  const fits = cue === 'clip-start' || cue === 'clip-end' ? 'clip' : cue;
  return (
    fits === kind || (kind === 'note' && fits === 'mark') || (kind === 'mark' && fits === 'note')
  );
}

/**
 * A proposal that cites a spoken cue's mic line as evidence reworks that cue, even when the agent
 * left out `refines` (VC-155): the user sees one card, not the cue and a copy of it. Each cue is
 * claimed by the first proposal that names or cites it.
 */
export function inferReworks(
  proposals: AgentProposal[],
  cueAt: (transcriptId: string, lineId: number) => AgentProposal['refines'] | undefined,
) {
  const claimed = new Set(
    proposals
      .filter((p) => p.refines)
      .map((p) => `${p.refines!.transcriptId}:${p.refines!.lineId}`),
  );
  return proposals.map((p) => {
    if (p.refines) return p;
    for (const e of p.evidence)
      if (e.role === 'mic')
        for (const lineId of e.lineIds) {
          const key = `${e.transcriptId}:${lineId}`;
          if (claimed.has(key)) continue;
          const cue = cueAt(e.transcriptId, lineId);
          if (!cue || !reworkFits(p.kind, cue.kind)) continue;
          claimed.add(key);
          return { ...p, refines: cue };
        }
    return p;
  });
}

const roundMs = (n: number) => Math.round(n * 1000) / 1000;
/** Edit fields in the tools' own names. */
export function answerFields(target: 'marker' | 'clip', f: EditFields) {
  return {
    ...(f.name !== undefined ? { title: f.name } : {}),
    ...(f.time !== undefined ? { timeSeconds: roundMs(f.time) } : {}),
    ...(f.end !== undefined ? { endSeconds: f.end === null ? null : roundMs(f.end) } : {}),
    ...(f.color !== undefined ? { [target === 'marker' ? 'color' : 'clipColor']: f.color } : {}),
    ...(f.note !== undefined ? { note: f.note } : {}),
  };
}

/** A proposal's intent tags, whichever field stored them. */
export const proposalIntents = (p: Pick<AgentProposal, 'intent' | 'intents'>) =>
  p.intents ?? (p.intent ? [p.intent] : []);
export const proposalLabel = (kind: AgentProposal['kind']) =>
  kind === 'edit'
    ? 'Change'
    : kind === 'clip'
      ? 'Clip range'
      : kind === 'cut'
        ? 'Split'
        : kind === 'note'
          ? 'Timed note'
          : 'Point marker';

/** The longest reason line: a short sentence, not a note. */
export const whyNoteLimit = 300;
export const rejectReasonLabel: Record<RejectReason, string> = {
  'wrong-moment': 'Wrong moment',
  'not-needed': 'Not needed',
  'wrong-intent': 'Wrong intent',
  other: 'Other',
};
/** Whether a stored reason is well formed for a decision with this status. */
export function validWhy(why: unknown, status: CueDecision['status']): why is ProposalWhy {
  if (!why || typeof why !== 'object') return false;
  const { reason, note, ...rest } = why as Record<string, unknown>;
  if (Object.keys(rest).length) return false;
  if (note != null && (typeof note !== 'string' || !note.trim() || note.length > whyNoteLimit))
    return false;
  if (reason == null) return note != null;
  // Only a reject has a one-tap reason, and "other" says what in its line.
  return (
    status === 'rejected' &&
    rejectReasons.includes(reason as RejectReason) &&
    (reason !== 'other' || note != null)
  );
}
function cleanWhy(why: ProposalWhy, status: CueDecision['status']): ProposalWhy | undefined {
  const note = typeof why.note === 'string' ? why.note.trim() : undefined;
  const value = { ...(why.reason ? { reason: why.reason } : {}), ...(note ? { note } : {}) };
  if (!value.reason && !value.note) return undefined;
  if (!validWhy(value, status))
    throw new Error(
      status === 'accepted'
        ? `An accept takes one line of up to ${whyNoteLimit} characters.`
        : `Pick a reason; "Other" needs a line of up to ${whyNoteLimit} characters.`,
    );
  return value;
}

export function applyProposalCommand(
  model: Model,
  proposal: AgentProposal,
  command: TranscriptCommand,
  newId: () => string,
  now = new Date().toISOString(),
): Model {
  if (proposal.id !== command.proposalId || proposal.sourceId !== command.sourceId)
    throw new Error('This proposal changed. Reopen the transcript.');
  const record = model.recordings.find((r) => r.id === proposal.sourceId);
  if (!record) throw new Error('This recording is no longer in the project.');
  const current = proposalDecision(model.cueDecisions || [], proposal.id);
  // Reopening puts the proposal back in review and takes back what accepting made.
  if (command.action === 'reopen-proposal') {
    if (!current || command.expected !== current.status)
      throw new Error('This proposal changed elsewhere. Reopen the transcript.');
    return reopenDecision(model, current);
  }
  // The reason is added after deciding, on the folded card, and changes nothing else (VC-173).
  if (command.action === 'why-proposal') {
    if (!current || command.expected !== current.status)
      throw new Error('This proposal changed elsewhere. Reopen the transcript.');
    const why = command.why && cleanWhy(command.why, current.status);
    return {
      ...structuredClone(model),
      cueDecisions: (model.cueDecisions || []).map((d) => {
        if (d !== current) return d;
        const { why: _, ...rest } = d;
        return why ? { ...rest, why } : rest;
      }),
    };
  }
  if (current || command.expected !== 'null')
    throw new Error('This proposal was already decided. Undo its decision before changing it.');
  const decision: CueDecision = {
    id: proposalDecisionId(proposal.id),
    proposalId: proposal.id,
    sourceId: proposal.sourceId,
    kind: proposalCueKind(proposal),
    time: proposal.time,
    status: command.action === 'accept-proposal' ? 'accepted' : 'rejected',
    decided: now,
    // An amended card is decided at its newest version (VC-204).
    ...(proposal.versions?.length ? { version: proposal.versions.length + 1 } : {}),
  };
  // A clip range may be kept as a range marker and a range marker as a clip (VC-186); a point
  // marker and the other kinds keep their kind.
  const asRange = command.acceptAs === 'range-marker',
    asClip = command.acceptAs === 'clip';
  if (
    command.acceptAs != null &&
    (command.action !== 'accept-proposal' ||
      !(asRange
        ? proposal.kind === 'clip'
        : asClip && proposal.kind === 'mark' && proposal.end !== undefined))
  )
    throw new Error('Only a clip range or a range marker can be accepted as the other kind.');
  if (command.action === 'reject-proposal') {
    return { ...structuredClone(model), cueDecisions: [...(model.cueDecisions || []), decision] };
  }
  if (command.action !== 'accept-proposal') throw new Error('Unknown proposal action.');
  if (proposal.kind === 'edit') return acceptChange(model, proposal, command, decision);
  const next = structuredClone(model);
  const start = command.time ?? proposal.time;
  if (!Number.isFinite(start) || start < 0 || start > record.duration)
    throw new Error('Choose a position inside this recording.');
  decision.appliedTime = start;
  if (command.title != null && (typeof command.title !== 'string' || command.title.length > 200))
    throw new Error('Enter a title of up to 200 characters.');
  if (command.text != null && (typeof command.text !== 'string' || command.text.length > 10000))
    throw new Error('Enter a note of up to 10,000 characters.');
  if (command.color != null && !Object.hasOwn(markerColors, command.color))
    throw new Error('Choose one of the marker colors.');
  // The marker's color (VC-200): the card's choice, else the agent's, else the default.
  const color = command.color ?? proposal.color ?? 'Blue';
  const title = (command.title ?? proposal.title).trim(),
    text = (command.text ?? proposal.text).trim();
  if (proposal.kind !== 'cut') {
    decision.title = title.slice(0, asRange ? 100 : 200);
    decision.text = text;
  }
  if (asRange) decision.kindChange = { from: 'clip-range', to: 'range-marker' };
  if (asClip) decision.kindChange = { from: 'range-marker', to: 'clip-range' };
  if (proposal.kind === 'cut') {
    const intersecting = next.clips.filter(
      (c) =>
        c.rid === record.id &&
        start > c.start + 0.001 &&
        start < c.end - 0.001 &&
        (!command.clipId || c.id === command.clipId),
    );
    if (!next.clips.some((c) => c.rid === record.id))
      throw new Error(
        'This recording has no clips to split yet. Make a clip in Cut (Whole recording), then split it.',
      );
    if (intersecting.length !== 1)
      throw new Error(
        'Split needs exactly one clip containing this position. Select a target for overlapping clips.',
      );
    const clip = intersecting[0],
      end = clip.end;
    const names = [command.firstName, command.secondName].map((n) =>
      typeof n === 'string' ? n.trim() : '',
    );
    if (names.some((n) => n.length > 200))
      throw new Error('Enter clip names of up to 200 characters.');
    const second = names[1] || `${names[0] || clip.name} · 2`;
    decision.priorName = clip.name;
    if (names[0]) clip.name = names[0];
    clip.end = start;
    clip.accepted = false;
    decision.clipId = newId();
    next.clips.push({
      ...clip,
      id: decision.clipId,
      name: second,
      start,
      end,
      accepted: false,
    });
    // The names chosen for both halves, read back as the split's clip names.
    if (names[0] || names[1]) {
      decision.title = clip.name;
      decision.text = second;
    }
  } else if ((proposal.kind === 'clip' && !asRange) || asClip) {
    const end = command.endTime ?? proposal.end ?? Number.NaN;
    if (!Number.isFinite(end) || end > record.duration || end - start < 0.001)
      throw new Error('Clip end must follow its start within this recording.');
    decision.appliedEnd = end;
    decision.clipId = newId();
    // The clip's Resolve color (VC-204): the card's choice, else the agent's, else none.
    if (command.clipColor != null && !Object.hasOwn(clipColors, command.clipColor))
      throw new Error('Choose one of the clip colors.');
    const clipColor =
      command.clipColor === undefined ? proposal.clipColor : (command.clipColor ?? undefined);
    if (clipColor) decision.clipColor = clipColor;
    next.clips.push({
      id: decision.clipId,
      rid: record.id,
      name: title.slice(0, 200) || 'Agent clip',
      start,
      end,
      folder: '_Review',
      include: true,
      accepted: false,
      ...(text ? { note: text } : {}),
      ...(clipColor ? { color: clipColor } : {}),
    });
  } else if (proposal.kind === 'note') {
    decision.noteId = newId();
    next.notes.push({
      id: decision.noteId,
      title: title.slice(0, 100) || 'Agent note',
      text,
      url: '',
      sourceId: record.id,
      time: start,
    });
  } else {
    // A range marker labels part of a continuous scene (VC-155), a clip range kept as one too.
    const end = command.endTime ?? proposal.end;
    if (
      (end !== undefined || asRange) &&
      (!Number.isFinite(end) || end! > record.duration || end! - start < 0.001)
    )
      throw new Error('Marker end must follow its start within this recording.');
    if (end !== undefined) decision.appliedEnd = end;
    decision.markerId = newId();
    decision.color = color;
    next.markers[record.id] = [
      ...(next.markers[record.id] || []),
      {
        id: decision.markerId,
        time: start,
        ...(end !== undefined ? { end } : {}),
        name: title.slice(0, 100) || 'Agent marker',
        note: text,
        category: 'Context',
        topic: '',
        color,
      },
    ];
  }
  next.cueDecisions = [...(next.cueDecisions || []), decision];
  // Accepting a proposal that reworked a spoken cue settles that cue too, unless it was already
  // decided on its own.
  const cue = proposal.refines;
  if (
    cue &&
    !next.cueDecisions.some(
      (d) =>
        !d.proposalId &&
        d.sourceId === record.id &&
        d.track === cue.track &&
        d.kind === cue.kind &&
        d.time != null &&
        Math.abs(d.time - cue.time) <= 0.5,
    )
  )
    next.cueDecisions.push({
      id: `${record.id}:${cue.track}:${cue.kind}:${Math.round(cue.time * 4)}`,
      sourceId: record.id,
      track: cue.track,
      kind: cue.kind,
      time: cue.time,
      status: 'accepted',
      decided: now,
      settledBy: proposal.id,
    });
  return next;
}

/**
 * Accepting a change proposal (VC-204): the values the card shows (the agent's, or the user's
 * edits of them) are written to the marker or clip as an edit of the model, so Undo takes it back.
 * The decision keeps the fields as they were, for reopening, and as written.
 */
function acceptChange(
  model: Model,
  proposal: AgentProposal,
  command: TranscriptCommand,
  decision: CueDecision,
): Model {
  const e = proposal.edit;
  if (!e) throw new Error('This change proposal has nothing to change.');
  const record = model.recordings.find((r) => r.id === proposal.sourceId)!;
  const next = structuredClone(model);
  const wanted: EditFields = command.edit ?? e.set;
  const keys = (['name', 'time', 'end', 'color', 'note'] as const).filter((k) => k in wanted);
  if (!keys.length) throw new Error('This change has nothing left to change.');
  const prior: EditFields = {},
    applied: EditFields = {};
  if (e.target === 'marker') {
    const marker = (next.markers[record.id] || []).find((m) => m.id === e.targetId);
    if (!marker) throw new Error('This marker is gone, so the change can only be rejected.');
    const time = wanted.time ?? marker.time;
    const end = wanted.end === undefined ? marker.end : (wanted.end ?? undefined);
    checkSpan(time, end, record.duration, 'Marker');
    for (const k of keys) {
      const v = wanted[k];
      if (k === 'name') {
        if (typeof v !== 'string' || !v.trim() || v.length > 100)
          throw new Error('Enter a marker name of up to 100 characters.');
        prior.name = marker.name;
        marker.name = applied.name = v.trim();
      } else if (k === 'note') {
        if (typeof v !== 'string' || v.length > 10000)
          throw new Error('Enter a note of up to 10,000 characters.');
        prior.note = marker.note ?? '';
        marker.note = applied.note = v.trim();
      } else if (k === 'color') {
        if (typeof v !== 'string' || !Object.hasOwn(markerColors, v))
          throw new Error('Choose one of the marker colors.');
        prior.color = marker.color ?? null;
        marker.color = v as keyof typeof markerColors;
        applied.color = v;
      } else if (k === 'time') {
        prior.time = marker.time;
        marker.time = applied.time = time;
      } else {
        prior.end = marker.end ?? null;
        if (end === undefined) delete marker.end;
        else marker.end = end;
        applied.end = end ?? null;
      }
    }
  } else {
    const clip = next.clips.find((c) => c.id === e.targetId && c.rid === record.id);
    if (!clip) throw new Error('This clip is gone, so the change can only be rejected.');
    if (wanted.end === null) throw new Error('A clip always has an end.');
    const start = wanted.time ?? clip.start;
    const end = wanted.end ?? clip.end;
    checkSpan(start, end, record.duration, 'Clip');
    for (const k of keys) {
      const v = wanted[k];
      if (k === 'name') {
        if (typeof v !== 'string' || !v.trim() || v.length > 200)
          throw new Error('Enter a clip name of up to 200 characters.');
        prior.name = clip.name;
        clip.name = applied.name = v.trim();
      } else if (k === 'note') {
        if (typeof v !== 'string' || v.length > 10000)
          throw new Error('Enter a note of up to 10,000 characters.');
        prior.note = clip.note ?? '';
        const note = v.trim();
        if (note) clip.note = note;
        else delete clip.note;
        applied.note = note;
      } else if (k === 'color') {
        if (v != null && (typeof v !== 'string' || !Object.hasOwn(clipColors, v)))
          throw new Error('Choose one of the clip colors.');
        prior.color = clip.color ?? null;
        if (v) clip.color = v as keyof typeof clipColors;
        else delete clip.color;
        applied.color = v ?? null;
      } else if (k === 'time') {
        prior.time = clip.start;
        clip.start = applied.time = start;
      } else {
        prior.end = clip.end;
        clip.end = applied.end = end;
      }
    }
    // A clip whose span changed needs accepting again in Cut, as when it is trimmed there.
    if ('time' in applied || 'end' in applied) clip.accepted = false;
  }
  decision.appliedTime = applied.time ?? proposal.time;
  decision.edit = { target: e.target, targetId: e.targetId, prior, applied };
  next.cueDecisions = [...(next.cueDecisions || []), decision];
  return next;
}
function checkSpan(start: number, end: number | undefined, duration: number, what: string) {
  if (!Number.isFinite(start) || start < 0 || start > duration)
    throw new Error('Choose a position inside this recording.');
  if (end !== undefined && (!Number.isFinite(end) || end > duration || end - start < 0.001))
    throw new Error(`${what} end must follow its start within this recording.`);
}
