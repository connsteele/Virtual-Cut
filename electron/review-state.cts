import { createHash } from 'node:crypto';
import { reviewContent } from './review-plan.js';
import type { Clip, Model } from './workflow-types.js' with { 'resolution-mode': 'import' };
export const reviewKey = (model: Model, clip: Clip) =>
  createHash('sha256').update(reviewContent(model, clip)).digest('hex');
export function reconcileReview(model: Model, previous?: Model) {
  model.clips = model.clips.map((clip) => {
    const key = reviewKey(model, clip);
    const old = previous?.clips.find((c) => c.id === clip.id);
    const changed = old && reviewKey(previous!, old) !== key;
    const accepting = old && !old.accepted && clip.accepted && !changed;
    const acceptedKey = accepting ? key : old ? old.acceptedKey : clip.acceptedKey;
    const accepted = Boolean(clip.accepted && !clip.held && !changed && acceptedKey === key);
    return { ...clip, accepted, acceptedKey: accepted ? acceptedKey : undefined, filed: false };
  });
}
