import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  rejectReasons,
  type ProposalWhy as Why,
  type RejectReason,
} from '../../electron/transcript-contracts';
import { rejectReasonLabel, whyNoteLimit } from '../../electron/proposal-edits';
import { pickPending } from './ProposalCard';
import s from './TranscriptWindow.module.css';

/**
 * Why a proposal was decided (VC-173), on its folded line. Right after a reject: one tap on a
 * reason (keys 1–4), "Other" with a short line. Right after an accept: what changed, gathered
 * from the decision, and an optional line. Skipping (Esc) or moving on (N, P) never blocks; a
 * reason given stays on the line and can be changed.
 */
export function ProposalWhy({
  id,
  status,
  why,
  kept,
  keptLine,
  asking,
  focus,
  busy,
  onSave,
  onSkip,
}: {
  id: string;
  status: 'accepted' | 'rejected';
  why?: Why;
  /** What accepting changed, from the decision: intent, moved, retitled, kind. */
  kept: string[];
  /** In place of the plain Kept line: the kept changes as chips (VC-204). */
  keptLine?: ReactNode;
  /** Just decided on this card: ask, until answered or skipped. */
  asking: boolean;
  /** The decision was made from the keyboard on this card: take focus so keys carry on. */
  focus: boolean;
  busy: boolean;
  onSave: (why: Why | undefined) => void;
  onSkip: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const [other, setOther] = useState<string | null>(null);
  const [line, setLine] = useState(why?.reason ? '' : (why?.note ?? ''));
  const root = useRef<HTMLDivElement>(null);
  const open = (asking && !why) || changing;
  useEffect(() => {
    if (open && focus) root.current?.focus();
  }, [open, focus]);
  if (!open && !why) return null;
  const done = () => {
    setChanging(false);
    setOther(null);
  };
  // Answered from the keyboard: carry on to the next proposal waiting for review, as N would.
  const next = (byKey: boolean) => {
    if (byKey && root.current) pickPending(root.current, 1);
  };
  const save = (value: Why | undefined, byKey: boolean) => {
    if (value || why) onSave(value);
    else onSkip();
    done();
    next(byKey);
  };
  const pick = (reason: RejectReason, byKey: boolean) => {
    if (reason === 'other') setOther(why?.reason === 'other' ? (why.note ?? '') : '');
    else save({ reason }, byKey);
  };
  const skip = (byKey: boolean) => {
    if (changing) done();
    else onSkip();
    next(byKey);
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const field = (event.target as HTMLElement).closest('input');
    if (event.key === 'Escape') {
      if (field && other != null) {
        setOther(null);
        root.current?.focus();
      } else if (open) skip(true);
      else return;
    } else if (field || event.ctrlKey || event.metaKey || event.altKey) return;
    else if (event.key === 'n' || event.key === 'p')
      pickPending(event.currentTarget, event.key === 'n' ? 1 : -1);
    else if (open && status === 'rejected' && /^[1-4]$/.test(event.key) && !busy)
      pick(rejectReasons[Number(event.key) - 1], true);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const lineField = (
    <input
      className={s.pcWhyLine}
      aria-label={`Reason line ${id}`}
      placeholder={
        status === 'accepted' ? 'Add a line about it (optional)' : 'Say why in a few words'
      }
      maxLength={whyNoteLimit}
      autoFocus={other != null}
      value={other ?? line}
      disabled={busy}
      onChange={(e) => (other != null ? setOther(e.target.value) : setLine(e.target.value))}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const note = (other ?? line).trim();
        if (other != null) {
          if (note) save({ reason: 'other', note }, true);
        } else save(note ? { note } : undefined, true);
      }}
    />
  );
  return (
    <div
      ref={root}
      className={s.pcWhy}
      data-proposal-why={id}
      data-asking={open}
      tabIndex={-1}
      onKeyDown={keys}
    >
      {status === 'accepted' &&
        (keptLine ?? (
          <span className={s.pcWhyKept}>
            Kept: {kept.length ? kept.join(' · ') : 'as proposed'}
          </span>
        ))}
      {open ? (
        <>
          {status === 'rejected' &&
            (other == null ? (
              <>
                <span className={s.pcWhyAsk}>Why?</span>
                {rejectReasons.map((reason, i) => (
                  <button
                    key={reason}
                    className={s.pcWhyReason}
                    aria-pressed={why?.reason === reason}
                    disabled={busy}
                    onClick={() => pick(reason, false)}
                  >
                    {rejectReasonLabel[reason]}
                    {reason === 'other' ? '…' : ''}
                    <kbd>{i + 1}</kbd>
                  </button>
                ))}
              </>
            ) : (
              <>
                <span className={s.pcWhyAsk}>Other:</span>
                {lineField}
              </>
            ))}
          {status === 'accepted' && lineField}
          <button className={s.pcQuiet} disabled={busy} onClick={() => skip(false)}>
            {changing ? 'Cancel' : 'Skip'}
            <kbd>Esc</kbd>
          </button>
        </>
      ) : (
        <>
          {why?.reason ? (
            <span className={s.pcWhySaid}>
              Why: {rejectReasonLabel[why.reason]}
              {why.note ? ` · ${why.note}` : ''}
            </span>
          ) : (
            why?.note && <span className={s.pcWhySaid}>“{why.note}”</span>
          )}
          <button
            className={s.pcQuiet}
            title="Change the reason"
            disabled={busy}
            onClick={() => {
              setLine(why?.reason ? '' : (why?.note ?? ''));
              setChanging(true);
            }}
          >
            Change
          </button>
        </>
      )}
    </div>
  );
}
