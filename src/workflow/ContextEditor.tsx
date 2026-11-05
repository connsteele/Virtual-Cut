import type { CreativeContext } from '../../electron/project-context';
import { defaultContext, effectiveContext } from '../../electron/project-context';
import { cleanHeardAs, heardAsRules, heardList, type HeardAs } from '../../electron/heard-as';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button, Field } from './ui';
import { gameChoices, pickGame, rememberGame, savedGames } from './gameLibrary';
import { background } from './background';
import s from './Workflow.module.css';
import h from './ContextEditor.module.css';

/** What a game's Heard as rows would correct in the open project's transcripts (VC-194). */
export interface HeardAsPreview {
  transcripts: number;
  words: number;
  own: number;
  heard: string[];
}
export interface HeardAsOffer {
  preview(gameId: string, rows: HeardAs[]): Promise<HeardAsPreview | null>;
  apply(gameId: string, rows: HeardAs[]): Promise<HeardAsPreview | null>;
}

export function ContextEditor({
  value,
  onChange,
  contexts = [],
  heardAsOffer,
}: {
  value: CreativeContext;
  onChange: (value: CreativeContext) => void;
  contexts?: CreativeContext[];
  /** Offered where a project is open: apply the game's spellings to its existing transcripts. */
  heardAsOffer?: HeardAsOffer;
}) {
  const batch = value.id !== 'project';
  const listId = useId();
  const [saved, setSaved] = useState(() => savedGames(storage()));
  const choices = gameChoices(
    saved,
    contexts.filter((c) => c.id !== value.id).map((c) => c.game),
  );
  const remember = (game = value.game) => {
    rememberGame(game, storage());
    setSaved(savedGames(storage()));
  };
  const known = !!value.game && choices.some((g) => g.id === value.game!.id);
  const update = (patch: Partial<CreativeContext>) => onChange({ ...value, ...patch });
  const game = value.game || { id: '', name: '', vocabulary: '' };
  const updateGame = (patch: Partial<NonNullable<CreativeContext['game']>>) =>
    update({ game: { ...game, id: game.id || crypto.randomUUID(), ...patch } });
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
          {/* Searchable saved or custom title (VC-53); a saved title keeps its game identity. */}
          <Field label="Game name">
            <input
              maxLength={300}
              list={listId}
              placeholder="Search saved games or type a new title"
              value={value.game?.name || ''}
              onChange={(e) =>
                update({
                  game: pickGame(e.target.value, value.game, choices, () => crypto.randomUUID()),
                })
              }
              onBlur={() => remember()}
            />
          </Field>
          <datalist id={listId}>
            {choices.map((g) => (
              <option key={g.id} value={g.name} />
            ))}
          </datalist>
          {!!value.game?.name.trim() && (
            <p className={s.muted}>
              {known ? 'Saved game' : 'New game'} · it is offered in every project on this computer.
            </p>
          )}
          <Field label="Names and game terms (optional)">
            <textarea
              maxLength={10000}
              placeholder="Character names, places and fictional terms"
              onBlur={() => remember()}
              value={value.game?.vocabulary || ''}
              onChange={(e) => updateGame({ vocabulary: e.target.value })}
            />
          </Field>
          <HeardAsList
            key={game.id}
            rows={game.heardAs || []}
            vocabulary={game.vocabulary}
            onChange={(heardAs) => updateGame({ heardAs })}
            onLeave={() => remember()}
            offer={
              heardAsOffer && game.id && game.name.trim()
                ? { offer: heardAsOffer, gameId: game.id, gameName: game.name.trim() }
                : undefined
            }
          />
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
        {effective.brief ? ' · video brief supplied' : ''}. Context is saved locally. Heard-as
        spellings are written into transcripts as corrections you can undo; nothing else rewrites
        recognized speech.
      </p>
    </section>
  );
}

type Draft = { name: string; heard: string }[];
const toDraft = (rows: HeardAs[]): Draft =>
  rows.map((r) => ({ name: r.name, heard: r.heard.join(', ') }));
const fromDraft = (draft: Draft): HeardAs[] =>
  draft.map((r) => ({ name: r.name, heard: heardList(r.heard) }));
const same = (a: HeardAs[], b: HeardAs[]) =>
  JSON.stringify(cleanHeardAs(a)) === JSON.stringify(cleanHeardAs(b));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * VC-194: one row per name the transcript keeps spelling wrong. The rows are the game's own, so
 * they travel with the saved game. Mistakes are named under the rows, but not for the row being
 * typed in until it is left.
 */
function HeardAsList({
  rows,
  vocabulary,
  onChange,
  onLeave,
  offer,
}: {
  rows: HeardAs[];
  vocabulary: string;
  onChange: (rows: HeardAs[]) => void;
  onLeave: () => void;
  offer?: { offer: HeardAsOffer; gameId: string; gameName: string };
}) {
  const [draft, setDraft] = useState<Draft>(() => (rows.length ? toDraft(rows) : []));
  const [editing, setEditing] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const focusNext = useRef<number | null>(null);
  // Undo, or another window, can change the saved rows; the draft follows unless it already says so.
  useEffect(() => {
    if (!same(rows, fromDraft(draft))) setDraft(toDraft(rows));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  useEffect(() => {
    if (focusNext.current == null) return;
    const input = list.current?.querySelector<HTMLInputElement>(
      `input[data-row="${focusNext.current}"][data-field="name"]`,
    );
    focusNext.current = null;
    input?.scrollIntoView({ block: 'nearest' });
    input?.focus();
  });
  const change = (next: Draft) => {
    setDraft(next);
    onChange(cleanHeardAs(fromDraft(next)));
  };
  const add = () => {
    focusNext.current = draft.length;
    setDraft([...draft, { name: '', heard: '' }]);
  };
  const { rules, problems } = heardAsRules(fromDraft(draft), vocabulary);
  const shown = problems.filter((p) => p.row !== editing);
  const bad = new Set(shown.map((p) => `${p.row}:${p.field}`));
  const filled = draft.filter((r) => r.name.trim() || r.heard.trim()).length;
  const first = [...rules][0];
  const [checked, setChecked] = useState<{ key: string; preview: HeardAsPreview } | null>(null);
  const [dismissed, setDismissed] = useState('');
  const [applied, setApplied] = useState<{ key: string; text: string } | null>(null);
  const rulesKey = JSON.stringify([...rules].sort());
  const check = () => {
    if (!offer || !rules.size) return setChecked(null);
    const key = rulesKey;
    background(
      offer.offer
        .preview(offer.gameId, cleanHeardAs(fromDraft(draft)))
        .then((preview) => setChecked(preview ? { key, preview } : null)),
    );
  };
  // On opening, offer what earlier rows still leave uncorrected.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(check, [offer?.gameId]);
  const apply = () => {
    if (!offer || !checked) return;
    const key = rulesKey;
    background(
      offer.offer.apply(offer.gameId, cleanHeardAs(fromDraft(draft))).then((done) => {
        if (!done) return;
        const names = [
          ...new Set(
            [...rules]
              .filter(([heard]) => checked.preview.heard.some((x) => x.toLowerCase() === heard))
              .map(([, name]) => name),
          ),
        ];
        setApplied({
          key,
          text: `Applied to ${plural(done.transcripts, 'transcript', 'transcripts')}: ${plural(done.words, 'word now says', 'words now say')} ${names.join(', ')}.`,
        });
        setChecked(null);
      }),
    );
  };
  const preview = checked?.key === rulesKey ? checked.preview : null;
  return (
    <>
      <section
        className={h.heardAs}
        aria-labelledby={`${offer?.gameId || 'game'}-heard-as`}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setEditing(null);
          onLeave();
          check();
        }}
      >
        <h4 className={h.title} id={`${offer?.gameId || 'game'}-heard-as`}>
          Heard as {filled > 0 && <span>{plural(filled, 'name', 'names')}</span>}
        </h4>
        <p className={h.about}>
          Names the transcript keeps spelling wrong. After recognition, each heard spelling becomes
          the game spelling as a correction you can undo.
        </p>
        {draft.length > 0 && (
          <div className={h.head} aria-hidden="true">
            <span>Game spelling</span>
            <span>Heard as (commas between)</span>
            <span />
          </div>
        )}
        {draft.length > 0 && (
          <div
            ref={list}
            className={`${h.rows} ${draft.length > 5 ? h.scrolls : ''}`}
            onKeyDown={(e) => {
              const input = e.target as HTMLInputElement;
              if (e.key !== 'Enter' || !input.dataset.field) return;
              e.preventDefault();
              const row = Number(input.dataset.row);
              const next =
                input.dataset.field === 'name'
                  ? `input[data-row="${row}"][data-field="heard"]`
                  : `input[data-row="${row + 1}"][data-field="name"]`;
              const target = list.current?.querySelector<HTMLInputElement>(next);
              if (target) target.focus();
              else add();
            }}
          >
            {draft.map((row, index) => (
              <div className={h.row} key={index}>
                <input
                  data-row={index}
                  data-field="name"
                  className={bad.has(`${index}:name`) ? h.bad : ''}
                  maxLength={100}
                  aria-label={`Game spelling, row ${index + 1}`}
                  value={row.name}
                  onFocus={() => setEditing(index)}
                  onChange={(e) =>
                    change(draft.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)))
                  }
                />
                <input
                  data-row={index}
                  data-field="heard"
                  className={bad.has(`${index}:heard`) ? h.bad : ''}
                  maxLength={500}
                  aria-label={`Heard as, row ${index + 1}`}
                  value={row.heard}
                  onFocus={() => setEditing(index)}
                  onChange={(e) =>
                    change(draft.map((r, i) => (i === index ? { ...r, heard: e.target.value } : r)))
                  }
                />
                <Button
                  className={h.remove}
                  aria-label={`Remove ${row.name.trim() || `row ${index + 1}`}`}
                  onClick={() => change(draft.filter((_, i) => i !== index))}
                >
                  <X size={15} />
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className={h.foot}>
          <Button disabled={draft.length >= 200} onClick={add}>
            Add a heard-as spelling
          </Button>
          {draft.length > 5 && (
            <span className={s.muted}>Showing 5 of {draft.length}; scroll for the rest</span>
          )}
        </div>
        {(first || shown.length > 0) && (
          <ul className={h.notes} aria-live="polite">
            {first && (
              <li>
                Whole words in any case: {cap(first[0])}’s becomes {first[1]}’s, and words that only
                start the same are left alone. Game spellings here are also sent as hints, so they
                don’t need to be in the names box too.
              </li>
            )}
            {shown.map((p) => (
              <li key={`${p.row}:${p.text}`} className={h.problem}>
                {p.text}
              </li>
            ))}
          </ul>
        )}
      </section>
      {offer && applied?.key === rulesKey && (
        <div className={h.offer} role="status">
          <p className={h.done}>{applied.text}</p>
          <p className={h.small}>
            Original still shows what was heard. Undo in the main window takes the whole apply back;
            Restore original on a word takes back one.
          </p>
        </div>
      )}
      {offer &&
        preview &&
        preview.words > 0 &&
        applied?.key !== rulesKey &&
        (dismissed === rulesKey ? (
          <p className={h.later}>
            {plural(preview.transcripts, 'transcript', 'transcripts')} of {offer.gameName} still use
            the heard spelling.
            <button type="button" className={h.link} onClick={apply}>
              Apply to {plural(preview.transcripts, 'transcript', 'transcripts')}
            </button>
          </p>
        ) : (
          <div className={h.offer} role="status">
            <p>
              {plural(preview.words, 'word', 'words')} in{' '}
              {plural(preview.transcripts, 'transcript', 'transcripts')} of {offer.gameName} in this
              project still {preview.words === 1 ? 'says' : 'say'} {preview.heard.join(' or ')}.
            </p>
            {preview.own > 0 && (
              <p className={h.small}>
                {plural(preview.own, 'word', 'words')} you corrected or restored yourself{' '}
                {preview.own === 1 ? 'stays' : 'stay'} as you left{' '}
                {preview.own === 1 ? 'it' : 'them'}.
              </p>
            )}
            <div className={h.actions}>
              <Button primary onClick={apply}>
                Apply to {plural(preview.transcripts, 'transcript', 'transcripts')}
              </Button>
              <Button onClick={() => setDismissed(rulesKey)}>Not now</Button>
            </div>
          </div>
        ))}
    </>
  );
}
const cap = (word: string) => word.replace(/^./u, (c) => c.toLocaleUpperCase());

export { defaultContext };
function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
