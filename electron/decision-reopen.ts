import type { Model } from './workflow-types.js';
import type { CueDecision } from './transcript-contracts.js';

/**
 * Reopening a decided cue or proposal (VC-155): the decision goes, and so does what accepting
 * made: the marker, the note, the clip, or the split (its two clips become one again, with the
 * name it had). Decisions that went with it (a clip's other boundary, a spoken cue settled by
 * the proposal) go too. When what it made is already gone (the user joined the split's clips
 * again by hand, deleted the marker), reopening only puts it back in review.
 */
export function reopenDecision(model: Model, decision: CueDecision): Model {
  const next = structuredClone(model);
  const related = (d: CueDecision) =>
    d.id === decision.id ||
    (decision.proposalId != null && d.settledBy === decision.proposalId) ||
    (decision.status === 'accepted' &&
      decision.clipId != null &&
      d.clipId === decision.clipId &&
      (d.kind === 'clip-start' || d.kind === 'clip-end'));
  next.cueDecisions = (model.cueDecisions || []).filter((d) => !related(d));
  if (decision.status !== 'accepted') return next;
  const source = decision.sourceId || '';
  if (decision.markerId)
    next.markers[source] = (next.markers[source] || []).filter((m) => m.id !== decision.markerId);
  if (decision.noteId) next.notes = next.notes.filter((n) => n.id !== decision.noteId);
  if (decision.kind === 'cut') {
    const second = next.clips.find((c) => c.id === decision.clipId);
    const first =
      second &&
      next.clips.find(
        (c) => c.rid === second.rid && c.id !== second.id && Math.abs(c.end - second.start) < 0.001,
      );
    if (second && first) {
      first.end = second.end;
      if (decision.priorName != null) first.name = decision.priorName;
      next.clips = next.clips.filter((c) => c.id !== second.id);
    }
  } else if (decision.clipId) next.clips = next.clips.filter((c) => c.id !== decision.clipId);
  return next;
}
