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
    clip.end = start;
    clip.accepted = false;
    next.clips.push({
      ...clip,
      id: newId(),
      name: `${clip.name} · 2`,
      start,
      end,
      accepted: false,
    });
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
    decision.markerId = newId();
    next.markers[record.id] = [
      ...(next.markers[record.id] || []),
      {
        id: decision.markerId,
        time: start,
        name: title.slice(0, 100) || 'Agent marker',
        note: text,
        category: 'Context',
        topic: '',
        color: 'Blue',
      },
    ];
  }
  next.cueDecisions = [...(next.cueDecisions || []), decision];
  return next;
}
