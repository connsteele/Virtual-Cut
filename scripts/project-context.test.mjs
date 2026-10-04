import assert from 'node:assert/strict';
import {
  effectiveContext,
  defaultContext,
  validateContexts,
} from '../dist-electron/project-context.js';
import { mergeEdits, emptyModel, validateEdits } from '../dist-electron/project-edits.js';
const project = {
  ...defaultContext('project'),
  gameMode: 'set',
  game: { id: 'game-1', name: 'Fire Emblem', vocabulary: 'Cai, Bertrand' },
  brief: 'Examine the story.',
};
const batch = defaultContext('batch-1');
assert.deepEqual(effectiveContext([project, batch], batch.id), {
  game: project.game,
  brief: project.brief,
});
assert.equal(
  effectiveContext([project, { ...batch, gameMode: 'none', briefMode: 'none' }], batch.id).game,
  undefined,
);
assert.equal(
  effectiveContext([project, { ...batch, briefMode: 'append', brief: 'Opening battle' }], batch.id)
    .brief,
  'Examine the story.\n\nOpening battle',
);
assert.equal(
  effectiveContext(
    [project, { ...batch, briefMode: 'replace', brief: 'Different narrative' }],
    batch.id,
  ).brief,
  'Different narrative',
);
assert.throws(() => validateContexts([project, project]));
assert.throws(() => validateContexts([{ ...project, brief: 'x'.repeat(20001) }]));
const before = { ...emptyModel(), contexts: [project, batch] };
const current = structuredClone(before);
current.contexts[0].brief = 'Updated project brief';
const after = structuredClone(before);
after.contexts[1].gameMode = 'none';
const merged = validateEdits(mergeEdits(before, after, current));
assert.equal(merged.contexts[0].brief, 'Updated project brief');
assert.equal(merged.contexts[1].gameMode, 'none');
assert.throws(() =>
  mergeEdits(before, { ...before, contexts: [{ ...project, brief: 'conflict' }, batch] }, current),
);
console.log(
  'Project/batch inheritance, explicit clearing, validation and concurrent edits passed.',
);
