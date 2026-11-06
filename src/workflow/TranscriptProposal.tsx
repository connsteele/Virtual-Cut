import { useState } from 'react';
import type { TranscriptCommand, TranscriptSession } from '../../electron/transcript-contracts';
import type { AgentProposal } from '../../electron/proposal-contracts';
import { proposalDecision, proposalIntents } from '../../electron/proposal-edits';
import { markerColors, type MarkerColor } from '../../electron/workflow-types';
import { ProposalCard, type PreviewAt } from './ProposalCard';
import { ProposalWhy } from './ProposalWhy';
import { TimeField } from './TimeField';
import { useCardAdjust, useCardDraft, type CardAdjust } from './useCardDraft';
import { formatTimecode } from './transcriptTime';
import s from './TranscriptWindow.module.css';

/** The card's name for a proposal's kind (VC-155). */
export function proposalKindLabel(p: AgentProposal) {
  const notion = proposalIntents(p).includes('notion');
  if (p.kind === 'clip') return 'Clip range';
  if (p.kind === 'cut') return 'Split';
  if (p.kind === 'note') return notion ? 'Notion note' : 'Timed note';
  if (p.end != null) return 'Range marker';
  return notion ? 'Marker + Notion note' : 'Marker';
}
const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(1)} s`;

/** An agent proposal in the transcript window: decided exactly like a spoken cue. */
export function TranscriptProposal({
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
  /** The card came into or left focus; its timeline preview follows (VC-170). */
  onPreview?: (card: string, active: boolean, picked: boolean, at?: PreviewAt) => void;
  /** The latest drop on a timeline preview; this card takes it if it is the card's (VC-184). */
  adjust?: CardAdjust;
  /**
   * Decided on this card last: ask why on its folded line (VC-173). Only the latest decision
   * asks, so earlier prompts don't pile up. `focus` when the card had keyboard focus, so the
   * reason keys work straight away.
   */
  asking?: { focus: boolean };
  onAsk: (asking: { id: string; focus: boolean } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const setAsking = (value: { focus: boolean } | null) => {
    if (value || asking) onAsk(value && { id: proposal.id, ...value });
  };
  const decide = (
    action: 'accept-proposal' | 'reject-proposal',
    values: Partial<TranscriptCommand>,
  ) => {
    const focused = document.activeElement?.closest('[data-proposal-card]');
    setAsking({ focus: focused?.getAttribute('data-proposal-card') === proposal.id });
    onCommand(action, values);
  };
  const { draft, setDraft, undo, reset } = useCardDraft<{
    title?: string;
    text?: string;
    time?: number;
    end?: number;
    clipId?: string;
    first?: string;
    second?: string;
    color?: MarkerColor;
  }>();
  const decision = proposalDecision(session.decisions, proposal.id);
  useCardAdjust(proposal.id, adjust, (at) =>
    setDraft({ ...draft, time: at.start, ...(at.end !== undefined ? { end: at.end } : {}) }),
  );
  // A range accepted as the other range kind says so once decided (VC-186).
  const kind =
    decision?.kindChange?.to === 'range-marker'
      ? 'Clip range → Range marker'
      : decision?.kindChange?.to === 'clip-range'
        ? 'Range marker → Clip range'
        : proposalKindLabel(proposal);
  const ranged = proposal.kind === 'mark' && proposal.end != null;
  const split = proposal.kind === 'cut';
  const start = draft.time ?? proposal.time;
  const end = draft.end ?? proposal.end;
  const targetClips = session.clips.filter((c) => start > c.start && start < c.end);
  const target = draft.clipId || (targetClips.length === 1 ? targetClips[0].id : '');
  // A split names both halves: the agent's suggestions, else the clip's name and "· 2".
  const targetName = targetClips.find((c) => c.id === target)?.name ?? '';
  const first = draft.first ?? proposal.names?.first ?? targetName;
  const second = draft.second ?? proposal.names?.second ?? (first ? `${first} · 2` : '');
  const title = draft.title ?? proposal.title;
  const text = draft.text ?? proposal.text;
  // A marker's color (VC-200): the agent's suggestion, else the default; a clip range's applies
  // if it is kept as a range marker.
  const colored = proposal.kind === 'mark' || proposal.kind === 'clip';
  const color: MarkerColor = draft.color ?? proposal.color ?? 'Blue';
  const swatchOf = (name: MarkerColor, title: string) => (
    <span className={s.pcColor} data-proposal-color={name} title={title}>
      <span className={s.pcColorDot} style={{ background: markerColors[name] }} />
      {name}
    </span>
  );
  const cue = proposal.refines;
  // What the agent changed on the spoken cue it reworked, old → new.
  const moved = cue && Math.abs(proposal.time - cue.time) >= 0.05;
  const retitled = cue && !split && proposal.title !== cue.text;
  const changes: [string, string, string][] = [];
  if (cue) {
    if (moved) changes.push(['Position', formatTimecode(cue.time), formatTimecode(proposal.time)]);
    if (split && proposal.names)
      changes.push([
        'Clip names',
        `${targetName || 'Clip'} | ${targetName || 'Clip'} · 2`,
        `${proposal.names.first} | ${proposal.names.second}`,
      ]);
    if (retitled) changes.push(['Title', cue.text, proposal.title]);
    if (!split && proposal.text)
      changes.push(['Note', 'what you said', 'written from the evidence']);
  }
  const meta = [];
  if (cue) {
    const bits = [
      moved && `moved ${signed(proposal.time - cue.time)}`,
      split && proposal.names && 'named',
      retitled && 'retitled',
      !split && proposal.text && 'note written',
    ].filter(Boolean);
    if (bits.length) meta.push(<span className={s.pcChanged}>Changed: {bits.join(' · ')}</span>);
  }
  if (proposal.notion)
    meta.push(
      `Notion: ${
        proposal.notion.target === 'new'
          ? 'new note'
          : `${proposal.notion.target === 'expands' ? 'expands' : 'duplicate of'} “${proposal.notion.existing}”`
      }`,
    );
  // What accepting changed, gathered from the decision rather than asked for (VC-173).
  const kept: string[] = [];
  if (decision?.status === 'accepted') {
    const intents = proposalIntents(proposal);
    if (intents.length) kept.push(`${intents.join(' + ')} intent`);
    if (decision.kindChange)
      kept.push(`as ${decision.kindChange.to === 'range-marker' ? 'range marker' : 'clip'}`);
    const shift = (decision.appliedTime ?? proposal.time) - proposal.time;
    if (Math.abs(shift) >= 0.05) kept.push(`moved ${signed(shift)}`);
    if (proposal.end != null && decision.appliedEnd != null) {
      const endShift = decision.appliedEnd - proposal.end;
      if (Math.abs(endShift) >= 0.05) kept.push(`end ${signed(endShift)}`);
    }
    if (decision.color && decision.color !== (proposal.color ?? 'Blue'))
      kept.push(`color ${proposal.color ?? 'Blue'} → ${decision.color}`);
    if (split) {
      if (decision.title != null) kept.push('clips named');
    } else {
      if (decision.title != null && decision.title !== proposal.title) kept.push('retitled');
      if ((decision.text ?? '') !== proposal.text) kept.push('note edited');
    }
  }
  const micLines = proposal.evidence
    .filter((e) => e.role === 'mic')
    .reduce((n, e) => n + e.lineIds.length, 0);
  if (proposal.kind === 'note' && micLines > 1) meta.push(`From ${micLines} mic lines`);
  return (
    <ProposalCard
      id={proposal.id}
      who={cue ? 'both' : 'agent'}
      kind={kind}
      intents={proposalIntents(proposal)}
      range={ranged}
      name={
        split ? (
          <>
            {first || 'Clip'} <span className={s.pcCut}>|</span> {second || 'Clip · 2'}
          </>
        ) : (
          title
        )
      }
      editLine={
        <>
          {split ? (
            <>
              <input
                className={s.inlineField}
                aria-label={`Proposal first clip name ${proposal.id}`}
                value={first}
                maxLength={200}
                onChange={(e) => setDraft({ ...draft, first: e.target.value })}
              />
              <span className={s.pcCut}>|</span>
              <input
                className={s.inlineField}
                aria-label={`Proposal second clip name ${proposal.id}`}
                value={second}
                maxLength={200}
                onChange={(e) => setDraft({ ...draft, second: e.target.value })}
              />
            </>
          ) : (
            <input
              className={s.inlineField}
              aria-label={`Proposal title ${proposal.id}`}
              value={title}
              maxLength={proposal.kind === 'clip' ? 200 : 100}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          )}
          <TimeField
            name={`Proposal position ${proposal.id}`}
            value={start}
            playhead={playhead}
            onChange={(time) => setDraft({ ...draft, time })}
            onSeek={onSeek}
            seekTitle={end != null ? 'Go to the start' : 'Go to this time'}
          />
          {end != null && (
            <>
              <span className={s.pcCut}>–</span>
              <TimeField
                name={`Proposal end ${proposal.id}`}
                value={end}
                playhead={playhead}
                onChange={(time) => setDraft({ ...draft, end: time })}
                onSeek={onSeek}
                seekTitle="Go to the end"
              />
            </>
          )}
          {colored && (
            <select
              className={s.pcColorSelect}
              aria-label={`Proposal color ${proposal.id}`}
              title={
                proposal.kind === 'clip'
                  ? 'Marker color, if you keep it as a range marker'
                  : 'Marker color'
              }
              value={color}
              style={{ color: markerColors[color] }}
              onChange={(e) => setDraft({ ...draft, color: e.target.value as MarkerColor })}
            >
              {Object.entries(markerColors).map(([name, hex]) => (
                <option key={name} value={name} style={{ color: hex }}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </>
      }
      swatch={
        decision
          ? decision.color && swatchOf(decision.color, 'Marker color')
          : (proposal.kind === 'mark' || (proposal.kind === 'clip' && proposal.color)) &&
            swatchOf(
              color,
              proposal.kind === 'clip'
                ? 'Marker color, if you keep it as a range marker'
                : proposal.color || draft.color
                  ? 'Marker color'
                  : 'Marker color: the default, as the agent gave none',
            )
      }
      time={decision?.appliedTime ?? start}
      end={decision?.appliedEnd ?? end}
      meta={meta}
      changedSince={
        decision?.status === 'accepted' &&
        decision.clipId != null &&
        !session.clips.some((c) => c.id === decision.clipId)
      }
      status={decision?.status || 'pending'}
      after={
        decision && (
          <ProposalWhy
            id={proposal.id}
            status={decision.status}
            why={decision.why}
            kept={kept}
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
      acceptLabel={
        proposal.kind === 'clip'
          ? 'Accept as clip'
          : ranged
            ? 'Accept as range marker'
            : `Accept ${kind.toLowerCase()}`
      }
      acceptDisabled={split && !target}
      onToggle={() => {
        setOpen(!open);
        if (open) setEditing(false);
      }}
      onEdit={() => {
        setOpen(true);
        setEditing(!editing);
      }}
      onAccept={() =>
        decide('accept-proposal', {
          title: split ? undefined : title,
          text: split ? undefined : text,
          time: start,
          endTime: end,
          clipId: split ? target : undefined,
          firstName: split ? first : undefined,
          secondName: split ? second : undefined,
          color: proposal.kind === 'mark' ? color : undefined,
        })
      }
      acceptOther={
        proposal.kind === 'clip'
          ? {
              primary: 'Accept as clip',
              label: 'Accept as range marker',
              key: 'm',
              title: 'Accept as a range marker with the same span, name and note',
              onAccept: () =>
                decide('accept-proposal', {
                  title: title.slice(0, 100),
                  text,
                  time: start,
                  endTime: end,
                  acceptAs: 'range-marker',
                  color,
                }),
            }
          : ranged
            ? {
                primary: 'Accept as range marker',
                label: 'Accept as clip',
                key: 'c',
                title: 'Accept as a clip with the same span, name and note',
                onAccept: () =>
                  decide('accept-proposal', {
                    title,
                    text,
                    time: start,
                    endTime: end,
                    acceptAs: 'clip',
                  }),
              }
            : undefined
      }
      onReject={() => decide('reject-proposal', {})}
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
      at={draft.time != null || draft.end != null ? { start, end } : undefined}
      was={{ start: proposal.time, end: proposal.end }}
    >
      <div className={s.pcDetails} data-proposal={proposal.id}>
        {!split && editing && (
          <textarea
            className={s.inlineNote}
            aria-label={`Proposal note ${proposal.id}`}
            value={text}
            maxLength={10000}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          />
        )}
        {!split && !editing && text && <p className={s.reason}>{text}</p>}
        {split && (
          <p className={s.muted}>
            Splits{' '}
            {editing ? (
              <select
                aria-label={`Proposal split target ${proposal.id}`}
                value={target}
                onChange={(e) => setDraft({ ...draft, clipId: e.target.value })}
              >
                <option value="">
                  {targetClips.length ? 'Choose a clip' : 'No clip at this position'}
                </option>
                {targetClips.map((clip) => (
                  <option key={clip.id} value={clip.id}>
                    {clip.name}
                  </option>
                ))}
              </select>
            ) : (
              targetName || (targetClips.length ? 'the chosen clip' : 'no clip here')
            )}{' '}
            into {first || 'Clip'} | {second || 'Clip · 2'}
            {!target && targetClips.length > 1 && !editing ? ' · choose the clip in Edit' : ''}
          </p>
        )}
        {cue && (
          <div className={s.heardFirst}>
            <span>Heard first</span>
            <span>
              {cue.kind === 'cut' ? 'Split' : cue.kind === 'note' ? 'Note' : 'Marker'} cue at{' '}
              {formatTimecode(cue.time)} · “{cue.text}”
            </span>
            {changes.flatMap(([k, was, now]) => [
              <span key={`${k}:k`}>{k}</span>,
              <span key={`${k}:v`}>
                <span className={s.was}>{was}</span> → {now}
              </span>,
            ])}
          </div>
        )}
        <p className={s.why}>
          <strong>Why:</strong> {proposal.reason}
        </p>
        {proposal.evidence.map((e, i) => (
          <button
            key={i}
            className={s.evidence}
            title="Listen from this line"
            onClick={() => onSeek(e.start)}
          >
            {e.role === 'mic' ? 'Mic' : 'Game'} {formatTimecode(e.start)} · “{e.quote}”
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
