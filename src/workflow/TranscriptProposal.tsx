import { useState } from 'react';
import type { TranscriptCommand, TranscriptSession } from '../../electron/transcript-contracts';
import type { AgentProposal } from '../../electron/proposal-contracts';
import { proposalDecision, proposalIntents } from '../../electron/proposal-edits';
import { ProposalCard } from './ProposalCard';
import { TimeField } from './TimeField';
import { useCardDraft } from './useCardDraft';
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
}: {
  proposal: AgentProposal;
  session: TranscriptSession;
  busy: boolean;
  playhead: number;
  onCommand: (
    action: 'accept-proposal' | 'reject-proposal' | 'reopen-proposal',
    values: Partial<TranscriptCommand>,
  ) => void;
  onSeek: (time: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const { draft, setDraft, undo, reset } = useCardDraft<{
    title?: string;
    text?: string;
    time?: number;
    end?: number;
    clipId?: string;
    first?: string;
    second?: string;
  }>();
  const decision = proposalDecision(session.decisions, proposal.id);
  const kind = proposalKindLabel(proposal);
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
      range={proposal.kind === 'mark' && proposal.end != null}
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
          />
          {end != null && (
            <>
              <span className={s.pcCut}>–</span>
              <TimeField
                name={`Proposal end ${proposal.id}`}
                value={end}
                playhead={playhead}
                onChange={(time) => setDraft({ ...draft, end: time })}
              />
            </>
          )}
        </>
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
      open={open}
      editing={editing}
      busy={busy}
      acceptLabel={`Accept ${kind.toLowerCase()}`}
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
        onCommand('accept-proposal', {
          title: split ? undefined : title,
          text: split ? undefined : text,
          time: start,
          endTime: end,
          clipId: split ? target : undefined,
          firstName: split ? first : undefined,
          secondName: split ? second : undefined,
        })
      }
      onReject={() => onCommand('reject-proposal', {})}
      onReopen={() => onCommand('reopen-proposal', {})}
      onCancel={() => {
        reset();
        setEditing(false);
      }}
      onUndo={undo}
      onSeek={onSeek}
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
