import { useState, type ReactNode } from 'react';
import type { TranscriptCommand, TranscriptSession } from '../../electron/transcript-contracts';
import type { AgentProposal, EditFields } from '../../electron/proposal-contracts';
import { proposalDecision } from '../../electron/proposal-edits';
import { ProposalCard, type PreviewAt } from './ProposalCard';
import { ProposalWhy } from './ProposalWhy';
import { TimeField } from './TimeField';
import { useCardAdjust, useCardDraft, type CardAdjust } from './useCardDraft';
import { formatTimecode } from './transcriptTime';
import {
  changeChip,
  Chips,
  ColorPicker,
  ColorSwatch,
  fieldLabel,
  KindIcon,
  SectionHead,
  type SwatchKind,
} from './ProposalParts';
import { ProposalVersions } from './ProposalVersions';
import s from './TranscriptWindow.module.css';

type Field = keyof EditFields;
const fieldOrder: Field[] = ['name', 'time', 'end', 'color', 'note'];
const same = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) < 0.0005
    : (a ?? null) === (b ?? null);

/** The marker's or clip's values now, in the fields a change compares; undefined once deleted. */
function targetNow(session: TranscriptSession, e: NonNullable<AgentProposal['edit']>) {
  if (e.target === 'marker') {
    const m = session.markers.find((x) => x.id === e.targetId);
    return (
      m && {
        name: m.name,
        time: m.time,
        end: m.end ?? null,
        color: m.color,
        note: m.note,
      }
    );
  }
  const c = session.clips.find((x) => x.id === e.targetId);
  return (
    c && {
      name: c.name,
      time: c.start,
      end: c.end,
      color: c.color ?? null,
      note: c.note ?? '',
    }
  );
}

/**
 * A change to a marker or clip already in the project (VC-204): line 2 shows it as accepting
 * would leave it, line 3 the changes as chips. Open, a Changes table shows before and after;
 * Edit changes only the After column. Accepting writes through the same edit commands as the
 * user's own edits, so Undo works.
 */
export function ChangeProposal({
  proposal,
  session,
  busy,
  playhead,
  onCommand,
  onSeek,
  onPreview,
  adjust,
  asking,
  onAsk,
}: {
  proposal: AgentProposal;
  session: TranscriptSession;
  busy: boolean;
  playhead: number;
  onCommand: (
    action: 'accept-proposal' | 'reject-proposal' | 'reopen-proposal' | 'why-proposal',
    values: Partial<TranscriptCommand>,
  ) => void;
  onSeek: (time: number) => void;
  onPreview?: (card: string, active: boolean, picked: boolean, at?: PreviewAt) => void;
  adjust?: CardAdjust;
  asking?: { focus: boolean };
  onAsk: (asking: { id: string; focus: boolean } | null) => void;
}) {
  const e = proposal.edit!;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const { draft, setDraft, undo, reset } = useCardDraft<EditFields>();
  const decision = proposalDecision(session.decisions, proposal.id);
  useCardAdjust(proposal.id, adjust, (at) =>
    setDraft({ ...draft, time: at.start, ...(at.end !== undefined ? { end: at.end } : {}) }),
  );
  const setAsking = (value: { focus: boolean } | null) => {
    if (value || asking) onAsk(value && { id: proposal.id, ...value });
  };
  const now = targetNow(session, e);
  const gone = !now;
  // The proposed values with the user's edits on top; the rest stays as the target has it.
  const wanted: EditFields = { ...e.set, ...draft };
  const before: EditFields = now ?? { ...e.seen };
  const after: EditFields = { ...before, ...wanted };
  const fields = fieldOrder.filter((f) => f in wanted);
  const changed = fields.filter((f) => !same(before[f], after[f]));
  const sinceProposed =
    !gone && Object.keys(e.seen).some((k) => !same(e.seen[k as Field], before[k as Field]));
  const what = e.target === 'clip' ? 'clip' : 'marker';
  const swatchKind: SwatchKind = e.target === 'clip' ? 'clip' : 'marker';
  const iconKind = e.target === 'clip' ? 'clip' : after.end != null ? 'range' : 'marker';
  const start = after.time ?? proposal.time;
  const end = after.end ?? undefined;
  const chips = (from: EditFields, to: EditFields, keys: Field[]) =>
    keys.filter((f) => !same(from[f], to[f])).map((f) => changeChip(e.target, f, from[f], to[f]));
  const edited = Object.keys(draft).length > 0;
  const meta: ReactNode[] = [];
  if (gone)
    meta.push(
      <span className={s.pcWarnChip}>{what === 'clip' ? 'Clip deleted' : 'Marker deleted'}</span>,
      `You deleted “${e.seen.name ?? proposal.title}” after the agent proposed this. Only Reject is left.`,
    );
  else if (changed.length)
    meta.push(
      <Chips
        tone="changes"
        label={edited || editing ? 'Your version' : 'Changes'}
        chips={chips(before, after, fields)}
      />,
    );
  else meta.push('Nothing left to change: it already matches.');
  // Once decided: what accepting wrote, and the fields the user changed on the card.
  const applied = decision?.status === 'accepted' ? decision.edit : undefined;
  const userChanged = applied
    ? fieldOrder.filter(
        (f) => (f in e.set || f in applied.applied) && !same(applied.applied[f], e.set[f]),
      )
    : [];
  const decidedNow =
    applied && targetNow(session, e)
      ? fieldOrder.some(
          (f) => f in applied.applied && !same(applied.applied[f], targetNow(session, e)![f]),
        )
      : applied != null;
  const valueOf = (f: Field, v: EditFields[Field]) => {
    if (f === 'color') return <ColorSwatch kind={swatchKind} color={v as string | null} />;
    if (f === 'time' || f === 'end')
      return v == null ? (
        <span className={s.pcSame}>none</span>
      ) : (
        <span className={s.pcTableMono}>{formatTimecode(v as number)}</span>
      );
    if (f === 'note' && !v) return <span className={s.pcSame}>(empty)</span>;
    return String(v ?? '');
  };
  const input = (f: Field) => {
    const v = after[f];
    const set = (value: EditFields[Field]) => setDraft({ ...draft, [f]: value });
    if (f === 'color')
      return (
        <ColorPicker
          kind={swatchKind}
          value={(v as string | null) ?? null}
          label={`Change ${fieldLabel(e.target, f).toLowerCase()} ${proposal.id}`}
          title={e.target === 'clip' ? 'Clip color in Resolve' : 'Marker color'}
          onChange={(color) => set(color)}
        />
      );
    if (f === 'note')
      return (
        <textarea
          aria-label={`Change note ${proposal.id}`}
          value={String(v ?? '')}
          maxLength={10000}
          onChange={(ev) => set(ev.target.value)}
        />
      );
    if (f === 'name')
      return (
        <input
          aria-label={`Change name ${proposal.id}`}
          value={String(v ?? '')}
          maxLength={e.target === 'clip' ? 200 : 100}
          onChange={(ev) => set(ev.target.value)}
        />
      );
    if (v == null) return <span className={s.pcSame}>none</span>;
    return (
      <TimeField
        name={`Change ${f} ${proposal.id}`}
        value={v as number}
        playhead={playhead}
        onChange={(time) => set(time)}
        onSeek={onSeek}
        seekTitle={f === 'end' ? 'Go to the end' : 'Go to this time'}
      />
    );
  };
  const kind = e.target === 'clip' ? 'Change clip' : 'Change marker';
  return (
    <ProposalCard
      id={proposal.id}
      who="agent"
      kind={kind}
      icon={<KindIcon kind={iconKind} change />}
      badges={
        <>
          {!!proposal.versions?.length && (
            <span
              className={s.pcChip}
              title="The agent amended this card; open it for every version"
            >
              Amended
            </span>
          )}
          {sinceProposed && (
            <span
              className={s.pcWarnChip}
              title="You changed it after the agent looked. Before shows it as it is now."
            >
              Changed since proposed
            </span>
          )}
        </>
      }
      name={
        decision?.status === 'accepted'
          ? (applied?.applied.name ?? before.name)
          : decision
            ? before.name
            : after.name
      }
      time={decision ? (decision.appliedTime ?? before.time ?? proposal.time) : start}
      end={decision ? undefined : end}
      swatch={
        decision ? (
          applied?.applied.color !== undefined && (
            <ColorSwatch kind={swatchKind} color={applied.applied.color} />
          )
        ) : (
          <ColorSwatch
            kind={swatchKind}
            color={after.color as string | null}
            title={e.target === 'clip' ? 'Clip color in Resolve' : 'Marker color'}
          />
        )
      }
      meta={meta}
      sections
      status={decision?.status || 'pending'}
      changedSince={decision?.status === 'accepted' && decidedNow}
      after={
        decision && (
          <ProposalWhy
            id={proposal.id}
            status={decision.status}
            why={decision.why}
            kept={[]}
            keptLine={
              applied && (
                <Chips
                  tone="kept"
                  label="Kept"
                  chips={chips(applied.prior, applied.applied, fieldOrder)}
                  after={
                    userChanged.length > 0 && (
                      <span>
                        · you changed the{' '}
                        {userChanged.map((f) => fieldLabel(e.target, f).toLowerCase()).join(', ')}
                      </span>
                    )
                  }
                />
              )
            }
            asking={asking != null}
            focus={asking?.focus ?? false}
            busy={busy}
            onSave={(why) => {
              setAsking(null);
              onCommand('why-proposal', { why });
            }}
            onSkip={() => setAsking(null)}
          />
        )
      }
      open={open}
      editing={editing}
      busy={busy}
      acceptLabel={gone ? `The ${what} is gone` : `Accept: change the ${what} as shown`}
      acceptDisabled={gone || !changed.length}
      onToggle={() => {
        setOpen(!open);
        if (open) setEditing(false);
      }}
      onEdit={() => {
        if (gone) return;
        setOpen(true);
        setEditing(!editing);
      }}
      onAccept={() => {
        const focused = document.activeElement?.closest('[data-proposal-card]');
        setAsking({ focus: focused?.getAttribute('data-proposal-card') === proposal.id });
        onCommand('accept-proposal', { edit: wanted });
      }}
      onReject={() => {
        const focused = document.activeElement?.closest('[data-proposal-card]');
        setAsking({ focus: focused?.getAttribute('data-proposal-card') === proposal.id });
        onCommand('reject-proposal', {});
      }}
      onReopen={() => {
        setAsking(null);
        onCommand('reopen-proposal', {});
      }}
      onCancel={() => {
        reset();
        setEditing(false);
      }}
      onUndo={undo}
      onSeek={onSeek}
      onPreview={(active, picked, at) => onPreview?.(proposal.id, active, picked, at)}
      at={{ start, end }}
      was={{ start: before.time ?? proposal.time, end: before.end ?? undefined }}
    >
      <div className={s.pcDetails} data-proposal={proposal.id} data-change-table>
        <SectionHead>Changes</SectionHead>
        <div className={s.pcTable} role="table" aria-label={`Changes ${proposal.id}`}>
          <div className={s.pcTableHead} role="columnheader" />
          <div className={s.pcTableHead} role="columnheader">
            {gone ? 'Before (deleted)' : 'Before'}
          </div>
          <div className={s.pcTableHead} role="columnheader">
            After
          </div>
          {fields.flatMap((f) => {
            const seenDiffers = !gone && f in e.seen && !same(e.seen[f], before[f]);
            return [
              <div key={`${f}:f`} className={s.pcTableField} data-field={f}>
                {fieldLabel(e.target, f)}
              </div>,
              <div key={`${f}:b`} className={s.pcTableBefore}>
                {seenDiffers && (
                  <>
                    <s>{valueOf(f, e.seen[f])}</s> <span className={s.pcTableNow}>now</span>
                  </>
                )}
                {valueOf(f, before[f])}
              </div>,
              <div
                key={`${f}:a`}
                className={s.pcTableAfter}
                data-changed={!same(before[f], after[f])}
              >
                {editing ? input(f) : valueOf(f, after[f])}
              </div>,
            ];
          })}
        </div>
        {fieldOrder.some((f) => !(f in wanted)) && (
          <p className={s.pcSame}>
            Stays the same:{' '}
            {fieldOrder
              .filter((f) => !(f in wanted))
              .map((f) => fieldLabel(e.target, f).toLowerCase())
              .join(', ')}
          </p>
        )}
        <ProposalVersions proposal={proposal} />
        <p className={s.why}>
          <strong>Why:</strong> {proposal.reason}
        </p>
        {proposal.evidence.map((ev, i) => (
          <button
            key={i}
            className={s.evidence}
            title="Listen from this line"
            onClick={() => onSeek(ev.start)}
          >
            {ev.role === 'mic' ? 'Mic' : 'Game'} {formatTimecode(ev.start)} · “{ev.quote}”
          </button>
        ))}
        <p className={s.muted}>
          {proposal.agent.name}
          {proposal.agent.model ? ` (${proposal.agent.model})` : ''}
        </p>
      </div>
    </ProposalCard>
  );
}
