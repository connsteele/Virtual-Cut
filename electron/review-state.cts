import { createHash } from 'node:crypto';
import { reviewContent, localDestinationIssues } from './review-plan.js';
import type { Clip, Model } from './workflow-types.js' with { 'resolution-mode': 'import' };
export const reviewKey = (model: Model, clip: Clip, issues = localDestinationIssues(model)) =>
  createHash('sha256')
    .update(reviewContent(model, clip, issues))
    .digest('hex');
export function reconcileReview(model: Model, previous?: Model) {
  const issues = localDestinationIssues(model);
  const previousIssues = previous ? localDestinationIssues(previous) : undefined;
  const previousClips = new Map(previous?.clips.map((c) => [c.id, c]));
  model.clips = model.clips.map((clip) => {
    const key = reviewKey(model, clip, issues);
    const old = previousClips.get(clip.id);
    const changed = old && reviewKey(previous!, old, previousIssues) !== key;
    const accepting = old && !old.accepted && clip.accepted && !changed;
    const acceptedKey = accepting ? key : old ? old.acceptedKey : clip.acceptedKey;
    const accepted = Boolean(clip.accepted && !clip.held && !changed && acceptedKey === key);
    return { ...clip, accepted, acceptedKey: accepted ? acceptedKey : undefined, filed: false };
  });
}
