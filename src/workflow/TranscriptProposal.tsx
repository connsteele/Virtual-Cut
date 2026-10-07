import { useState } from 'react';
import type { TranscriptCommand, TranscriptSession } from '../../electron/transcript-contracts';
import type { AgentProposal } from '../../electron/proposal-contracts';
import { proposalDecision, proposalLabel } from '../../electron/proposal-edits';
import { Button, Field } from './ui';
import s from './TranscriptWindow.module.css';

const intents = {
  marker: 'marker',
  general: 'general context',
  notion: 'Notion note',
  edit: 'edit instruction',
};
/** An agent proposal on the cue card (VC-162): decided exactly like a spoken cue. */
export function TranscriptProposal({
  proposal,
  session,
  busy,
  onCommand,
  onSeek,
}: {
  proposal: AgentProposal;
  session: TranscriptSession;
  busy: boolean;
  onCommand: (
    action: 'accept-proposal' | 'reject-proposal',
    values: Partial<TranscriptCommand>,
  ) => void;
  onSeek: (time: number) => void;
}) {
  const [draft, setDraft] = useState<{
    title?: string;
    text?: string;
    time?: string;
    end?: string;
    clipId?: string;
    first?: string;
    second?: string;
  }>({});
  const decision = proposalDecision(session.decisions, proposal.id);
  const label = proposalLabel(proposal.kind);
  const range = proposal.kind === 'clip',
    split = proposal.kind === 'cut';
  const start = draft.time ?? String(proposal.time);
  const end = draft.end ?? String(proposal.end ?? '');
  const targetClips = session.clips.filter((c) => Number(start) > c.start && Number(start) < c.end);
  const target = draft.clipId || (targetClips.length === 1 ? targetClips[0].id : '');
  // A split names both halves: the agent's suggestions, else the clip's name and "· 2".
  const targetName = targetClips.find((c) => c.id === target)?.name ?? '';
  const first = draft.first ?? proposal.names?.first ?? targetName;
  const second = draft.second ?? proposal.names?.second ?? (first ? `${first} · 2` : '');
  const moved =
    decision?.appliedTime != null && Math.abs(decision.appliedTime - proposal.time) >= 0.001
      ? ` · moved ${decision.appliedTime > proposal.time ? '+' : ''}${(decision.appliedTime - proposal.time).toFixed(3)} s`
      : '';
  return (
    <div
      className={`${s.cue} ${s.proposal}`}
      data-proposal={proposal.id}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setDraft({});
      }}
    >
      <span className={s.agentTag}>Agent</span> <strong>{label} proposal</strong> ·{' '}
      {decision?.status || 'Needs review'}
      <p className={s.muted}>
        {proposal.agent.name}
        {proposal.agent.model ? ` (${proposal.agent.model})` : ''}
        {proposal.intent ? ` · intent: ${intents[proposal.intent]}` : ''} · proposed at{' '}
        {proposal.time.toFixed(3)}
        {range ? `–${proposal.end!.toFixed(3)}` : ''} s
      </p>
      <p className={s.reason}>{proposal.reason}</p>
      {proposal.evidence.map((e, i) => (
        <button
          key={i}
          className={s.evidence}
          title="Listen from this line"
          onClick={() => onSeek(e.start)}
        >
          {e.role === 'mic' ? 'Mic' : 'Game'} {e.start.toFixed(1)} s · “{e.quote}”
        </button>
      ))}
      {decision?.status === 'accepted' && (
        <p className={s.muted}>
          Accepted at {decision.appliedTime?.toFixed(3)}
          {decision.appliedEnd != null ? `–${decision.appliedEnd.toFixed(3)}` : ''} s{moved}
          {decision.title
            ? split
              ? ` · ${decision.title} | ${decision.text}`
              : ` · ${decision.title}`
            : ''}
        </p>
      )}
      {!decision && (
        <>
          {!split && (
            <>
              <Field label="Title">
                <input
                  aria-label={`Proposal title ${proposal.id}`}
                  value={draft.title ?? proposal.title}
                  maxLength={range ? 200 : 100}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </Field>
              <Field label={proposal.kind === 'note' ? 'Note text' : 'Note'}>
                <textarea
                  aria-label={`Proposal note ${proposal.id}`}
                  value={draft.text ?? proposal.text}
                  maxLength={10000}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                />
              </Field>
            </>
          )}
          <div className={s.toolbar}>
            <Field label={range ? 'Start (seconds)' : 'Position (seconds)'}>
              <input
                aria-label={`Proposal position ${proposal.id}`}
                type="number"
                min={0}
                step="0.001"
                value={start}
                onChange={(e) => setDraft({ ...draft, time: e.target.value })}
              />
            </Field>
            {range && (
              <Field label="End (seconds)">
                <input
                  aria-label={`Proposal end ${proposal.id}`}
                  type="number"
                  min={0}
                  step="0.001"
                  value={end}
                  onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                />
              </Field>
            )}
          </div>
          {split && (
            <Field label="Clip to split">
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
            </Field>
          )}
          {split && (
            <div className={s.toolbar}>
              <Field label="Clip before the split">
                <input
                  aria-label={`Proposal first clip name ${proposal.id}`}
                  value={first}
                  maxLength={200}
                  onChange={(e) => setDraft({ ...draft, first: e.target.value })}
                />
              </Field>
              <Field label="Clip after the split">
                <input
                  aria-label={`Proposal second clip name ${proposal.id}`}
                  value={second}
                  maxLength={200}
                  onChange={(e) => setDraft({ ...draft, second: e.target.value })}
                />
              </Field>
            </div>
          )}
          <div className={s.toolbar}>
            <Button onClick={() => onSeek(Number(start) || 0)}>Listen</Button>
            <Button
              disabled={busy || !start.trim() || (range && !end.trim()) || (split && !target)}
              onClick={() =>
                onCommand('accept-proposal', {
                  title: split ? undefined : (draft.title ?? proposal.title),
                  text: split ? undefined : (draft.text ?? proposal.text),
                  time: Number(start),
                  endTime: range ? Number(end) : undefined,
                  clipId: split ? target : undefined,
                  firstName: split ? first : undefined,
                  secondName: split ? second : undefined,
                })
              }
            >
              Accept{' '}
              {range
                ? 'clip range'
                : split
                  ? 'split'
                  : proposal.kind === 'note'
                    ? 'timed note'
                    : 'marker'}
            </Button>
            <Button disabled={busy} onClick={() => onCommand('reject-proposal', {})}>
              Reject
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
