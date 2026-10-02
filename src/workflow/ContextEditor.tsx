import type { CreativeContext } from '../../electron/project-context';
import { defaultContext, effectiveContext } from '../../electron/project-context';
import { Field } from './ui';
import s from './Workflow.module.css';

export function ContextEditor({
  value,
  onChange,
  contexts = [],
}: {
  value: CreativeContext;
  onChange: (value: CreativeContext) => void;
  contexts?: CreativeContext[];
}) {
  const batch = value.id !== 'project';
  const update = (patch: Partial<CreativeContext>) => onChange({ ...value, ...patch });
  const effective = effectiveContext(
    [...contexts.filter((c) => c.id !== value.id), value],
    batch ? value.id : undefined,
  );
  return (
    <section aria-label={batch ? 'Batch context' : 'Project context'}>
      <Field label="Game context">
        <select
          value={value.gameMode}
          onChange={(e) => update({ gameMode: e.target.value as CreativeContext['gameMode'] })}
        >
          {batch && <option value="inherit">Use project game</option>}
          <option value="none">Unspecified / mixed games</option>
          <option value="set">Choose a game</option>
        </select>
      </Field>
      {value.gameMode === 'set' && (
        <>
          <Field label="Game name">
            <input
              maxLength={300}
              value={value.game?.name || ''}
              onChange={(e) =>
                update({
                  game: {
                    id: value.game?.id || crypto.randomUUID(),
                    vocabulary: value.game?.vocabulary || '',
                    name: e.target.value,
                  },
                })
              }
            />
          </Field>
          <Field label="Names and game terms (optional)">
            <textarea
              maxLength={10000}
              placeholder="Character names, places and fictional terms"
              value={value.game?.vocabulary || ''}
              onChange={(e) =>
                update({
                  game: {
                    id: value.game?.id || crypto.randomUUID(),
                    name: value.game?.name || '',
                    vocabulary: e.target.value,
                  },
                })
              }
            />
          </Field>
        </>
      )}
      {batch && (
        <Field label="Video brief">
          <select
            value={value.briefMode}
            onChange={(e) => update({ briefMode: e.target.value as CreativeContext['briefMode'] })}
          >
            <option value="inherit">Use project brief</option>
            <option value="append">Add to project brief</option>
            <option value="replace">Use a separate brief</option>
            <option value="none">No brief for this batch</option>
          </select>
        </Field>
      )}
      {(!batch || ['append', 'replace'].includes(value.briefMode)) && (
        <Field label={batch ? 'Batch brief' : 'Video brief (optional)'}>
          <textarea
            maxLength={20000}
            placeholder="What is the video about? Audience, purpose, narrative and observations to watch for."
            value={value.brief}
            onChange={(e) => update({ brief: e.target.value })}
          />
        </Field>
      )}
      <p className={s.muted}>
        Using: {effective.game?.name || 'no specific game'}
        {effective.brief ? ' · video brief supplied' : ''}. Context is saved locally. It does not
        automatically rewrite recognized speech.
      </p>
    </section>
  );
}
export { defaultContext };
