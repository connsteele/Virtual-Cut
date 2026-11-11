import type { Model, Recording } from './workflow-types.js';
import type { CueDecision } from './transcript-contracts.js';

/**
 * A Split accepted on a recording with no clip yet (VC-243), spoken or proposed by an agent:
 * it makes both clips, start to `at` and `at` to the end. Without names they are named after
 * the recording, like Whole recording names its clip. The decision keeps both ids, so
 * reopening it removes them.
 */
export function splitWithoutClip(
  next: Model,
  record: Recording,
  at: number,
  names: [string, string],
  decision: CueDecision,
  newId: () => string,
) {
  if (at <= 0.001 || at >= record.duration - 0.001)
    throw new Error('Choose a split position inside this recording, away from its ends.');
  const first = names[0] || record.title.trim().slice(0, 200) || 'Clip',
    made = { rid: record.id, folder: '_Review', include: true, accepted: false };
  decision.firstClipId = newId();
  decision.clipId = newId();
  next.clips.push(
    { ...made, id: decision.firstClipId, name: first, start: 0, end: at },
    {
      ...made,
      id: decision.clipId,
      name: names[1] || `${first} · 2`.slice(0, 200),
      start: at,
      end: record.duration,
    },
  );
  return { first: next.clips.at(-2)!, second: next.clips.at(-1)! };
}

/**
 * Reopening a decided cue or proposal (VC-155): the decision goes, and so does what accepting
 * made: the marker, the note, the clip, or the split (its two clips become one again, with the
 * name it had; a split that made both clips removes them, VC-243). Decisions that went with it
 * (a clip's other boundary, a spoken cue settled by the proposal) go too. When what it made is
 * already gone (the user joined the split's clips again by hand, deleted the marker), reopening
 * only puts it back in review.
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
  // A change proposal (VC-204): the fields go back to what they were, if the target is still
  // there. A field changed again by hand since keeps the user's later value.
  if (decision.edit) {
    const { target, targetId, prior, applied } = decision.edit;
    const item =
      target === 'marker'
        ? (next.markers[source] || []).find((m) => m.id === targetId)
        : next.clips.find((c) => c.id === targetId);
    if (!item) return next;
    const rec = item as unknown as Record<string, unknown>;
    for (const [k, was] of Object.entries(prior)) {
      const field = target === 'clip' && k === 'time' ? 'start' : k;
      const now = rec[field] ?? (k === 'note' ? '' : null);
      const wrote = applied[k as keyof typeof applied] ?? (k === 'note' ? '' : null);
      if (JSON.stringify(now) !== JSON.stringify(wrote)) continue;
      if (was == null || (k === 'note' && was === '' && target === 'clip')) delete rec[field];
      else rec[field] = was;
    }
    return next;
  }
  if (decision.markerId)
    next.markers[source] = (next.markers[source] || []).filter((m) => m.id !== decision.markerId);
  if (decision.noteId) next.notes = next.notes.filter((n) => n.id !== decision.noteId);
  if (decision.kind === 'cut' && decision.firstClipId) {
    // A split that made both clips (VC-243) takes both back while they still meet at the split.
    const first = next.clips.find((c) => c.id === decision.firstClipId),
      second = next.clips.find((c) => c.id === decision.clipId);
    if (first && second && Math.abs(first.end - second.start) < 0.001)
      next.clips = next.clips.filter((c) => c !== first && c !== second);
  } else if (decision.kind === 'cut') {
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
