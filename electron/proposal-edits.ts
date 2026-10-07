import type { Model } from './workflow-types.js';
import type { CueDecision, CueKind, TranscriptCommand } from './transcript-contracts.js';
import type { AgentProposal } from './proposal-contracts.js';

/**
 * Deciding an agent proposal on its cue card (VC-162). Accepting does what accepting a spoken
 * cue of the same kind does; the decision goes into the model like a cue decision, so Undo
 * returns the proposal to review.
 */
export const proposalDecisionId = (proposalId: string) => `agent:${proposalId}`;
export const proposalCueKind = (proposal: Pick<AgentProposal, 'kind'>): CueKind =>
  proposal.kind === 'clip' ? 'clip-start' : proposal.kind;
export function proposalDecision(decisions: CueDecision[], proposalId: string) {
  return decisions.find((d) => d.proposalId === proposalId);
}
export function proposalStatus(decisions: CueDecision[], proposalId: string) {
  return proposalDecision(decisions, proposalId)?.status || 'pending';
}
/** A proposal's intent tags, whichever field stored them. */
export const proposalIntents = (p: Pick<AgentProposal, 'intent' | 'intents'>) =>
  p.intents ?? (p.intent ? [p.intent] : []);
export const proposalLabel = (kind: AgentProposal['kind']) =>
  kind === 'clip'
    ? 'Clip range'
    : kind === 'cut'
      ? 'Split'
      : kind === 'note'
        ? 'Timed note'
        : 'Point marker';

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
  };
  if (command.action === 'reject-proposal') {
    return { ...structuredClone(model), cueDecisions: [...(model.cueDecisions || []), decision] };
  }
  if (command.action !== 'accept-proposal') throw new Error('Unknown proposal action.');
  const next = structuredClone(model);
  const start = command.time ?? proposal.time;
  if (!Number.isFinite(start) || start < 0 || start > record.duration)
    throw new Error('Choose a position inside this recording.');
  decision.appliedTime = start;
  if (command.title != null && (typeof command.title !== 'string' || command.title.length > 200))
    throw new Error('Enter a title of up to 200 characters.');
  if (command.text != null && (typeof command.text !== 'string' || command.text.length > 10000))
    throw new Error('Enter a note of up to 10,000 characters.');
  const title = (command.title ?? proposal.title).trim(),
    text = (command.text ?? proposal.text).trim();
  if (proposal.kind !== 'cut') {
    decision.title = title.slice(0, 200);
    decision.text = text;
  }
  if (proposal.kind === 'cut') {
    const intersecting = next.clips.filter(
      (c) =>
        c.rid === record.id &&
        start > c.start + 0.001 &&
        start < c.end - 0.001 &&
        (!command.clipId || c.id === command.clipId),
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
    if (names[0]) clip.name = names[0];
    clip.end = start;
    clip.accepted = false;
    next.clips.push({
      ...clip,
      id: newId(),
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
  } else if (proposal.kind === 'clip') {
    const end = command.endTime ?? proposal.end ?? Number.NaN;
    if (!Number.isFinite(end) || end > record.duration || end - start < 0.001)
      throw new Error('Clip end must follow its start within this recording.');
    decision.appliedEnd = end;
    decision.clipId = newId();
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
    // A range marker labels part of a continuous scene (VC-155).
    const end = command.endTime ?? proposal.end;
    if (
      end !== undefined &&
      (!Number.isFinite(end) || end > record.duration || end - start < 0.001)
    )
      throw new Error('Marker end must follow its start within this recording.');
    if (end !== undefined) decision.appliedEnd = end;
    decision.markerId = newId();
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
        color: 'Blue',
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
