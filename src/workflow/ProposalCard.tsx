import type { KeyboardEvent, ReactNode } from 'react';
import { formatTimecode } from './transcriptTime';
import s from './TranscriptWindow.module.css';

/**
 * One proposal in the transcript window (VC-155), spoken or from an agent: the same lines in
 * the same places every time. Line 1: who proposed it, the kind and the intents, with Accept,
 * Reject and Details at the right. Line 2: the name, then the time code. Line 3 only when there
 * is something to say. Details open below, so nothing above them moves. A decided proposal
 * folds to one line; a rejected one can be reopened.
 */
export function ProposalCard({
  id,
  who,
  kind,
  intents = [],
  range = false,
  name,
  editLine,
  time,
  end,
  meta = [],
  status,
  open,
  editing,
  busy,
  acceptLabel,
  acceptDisabled,
  onToggle,
  onEdit,
  onAccept,
  onReject,
  onReopen,
  onCancel,
  onSeek,
  children,
}: {
  id: string;
  who: 'spoken' | 'agent' | 'both';
  kind: string;
  intents?: string[];
  /** A range marker: its marker intent reads "Range". */
  range?: boolean;
  name: ReactNode;
  /** While editing: the name and time code as fields, in their places on line 2. */
  editLine?: ReactNode;
  time: number;
  end?: number;
  meta?: ReactNode[];
  status: 'pending' | 'accepted' | 'rejected';
  open: boolean;
  editing: boolean;
  busy: boolean;
  acceptLabel: string;
  acceptDisabled?: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAccept: () => void;
  onReject: () => void;
  onReopen?: () => void;
  /** Esc anywhere on the card: drop the edits and leave editing. */
  onCancel: () => void;
  onSeek: (time: number) => void;
  children?: ReactNode;
}) {
  const tags = (
    <>
      {who !== 'agent' && <span className={`${s.whoTag} ${s.spokenTag}`}>Spoken</span>}
      {who !== 'spoken' && <span className={s.whoTag}>Agent</span>}
    </>
  );
  const timecode = `${formatTimecode(time)}${end != null ? ` – ${formatTimecode(end)}` : ''}`;
  const tone = who === 'both' ? s.pcBoth : who === 'spoken' ? s.pcSpoken : '';
  if (status !== 'pending')
    return (
      <div className={`${s.pc} ${tone} ${s.pcDone}`} data-proposal-card={id} data-status={status}>
        <div className={s.pcLine1}>
          {tags}
          <span className={s.pcKind}>{kind}</span>
          <span className={s.pcDoneName}>{name}</span>
          <span className={s.pcTime}>{timecode}</span>
          <span className={s.pcActions}>
            <span className={status === 'accepted' ? s.pcAccepted : s.pcRejected}>
              {status === 'accepted' ? '✓ Accepted' : '✕ Rejected'}
            </span>
            {onReopen && (
              <button
                className={s.pcQuiet}
                title={
                  status === 'accepted'
                    ? 'Take back what accepting made and review it again'
                    : 'Review it again'
                }
                disabled={busy}
                onClick={onReopen}
              >
                Reopen
              </button>
            )}
          </span>
        </div>
      </div>
    );
  // Keys on a focused proposal, outside its fields: A accept, R reject, D details, E edit,
  // N/P the next or previous proposal waiting for review. J K L stay playback.
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && editing) {
      onCancel();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (event.target as HTMLElement).closest('input,textarea,select')
    )
      return;
    const key = event.key.toLowerCase();
    if (key === 'n' || key === 'p') {
      const cards = [
        ...document.querySelectorAll<HTMLElement>('[data-proposal-card][data-status="pending"]'),
      ];
      const at = cards.indexOf(event.currentTarget);
      cards[(at + (key === 'n' ? 1 : -1) + cards.length) % cards.length]?.focus();
    } else if (key === 'a' && !busy && !acceptDisabled) onAccept();
    else if (key === 'r' && !busy) onReject();
    else if (key === 'd') onToggle();
    else if (key === 'e') onEdit();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div
      className={`${s.pc} ${tone}${open ? ` ${s.pcOpen}` : ''}`}
      data-proposal-card={id}
      data-status="pending"
      tabIndex={0}
      onKeyDown={keys}
    >
      <div className={s.pcLine1}>
        {tags}
        <span className={s.pcKind}>{kind}</span>
        {/* An intent the kind already says ("Marker", "Notion note") isn't repeated as a chip. */}
        {intents
          .filter((i) => !kind.toLowerCase().includes(i === 'marker' && range ? 'range' : i))
          .map((i) => (
            <span key={i} className={s.pcChip}>
              {i === 'marker' && range ? 'Range' : i[0].toUpperCase() + i.slice(1)}
            </span>
          ))}
        <span className={s.pcActions}>
          <button
            className={s.pcAccept}
            title={acceptLabel}
            aria-label={acceptLabel}
            disabled={busy || acceptDisabled}
            onClick={onAccept}
          >
            Accept<kbd>A</kbd>
          </button>
          <button className={s.pcReject} aria-label="Reject" disabled={busy} onClick={onReject}>
            Reject<kbd>R</kbd>
          </button>
          <button
            className={`${s.pcQuiet} ${s.pcToggle}`}
            aria-label={open ? 'Hide details' : 'Details'}
            aria-expanded={open}
            onClick={onToggle}
          >
            {open ? 'Hide' : 'Details'}
            <kbd>D</kbd>
          </button>
          <button
            className={`${s.pcQuiet} ${s.pcToggle}`}
            aria-label={editing ? 'Done editing' : 'Edit'}
            aria-pressed={editing}
            onClick={onEdit}
          >
            {editing ? 'Done' : 'Edit'}
            <kbd>E</kbd>
          </button>
        </span>
      </div>
      {editing && editLine ? (
        <div className={`${s.pcLine2} ${s.pcLine2Edit}`}>{editLine}</div>
      ) : (
        <div className={s.pcLine2}>
          <button
            className={s.pcName}
            title={open ? 'Hide details' : 'Show details'}
            onClick={onToggle}
          >
            {name}
          </button>
          <button className={s.pcTime} title="Listen from here" onClick={() => onSeek(time)}>
            {timecode}
          </button>
        </div>
      )}
      {meta.length > 0 && (
        <div className={s.pcLine3}>
          {meta.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
      )}
      {open && (
        <div className={s.pcBody}>
          {children}
          {editing && (
            <p className={s.muted}>Editing in place. Esc puts the proposal back as it was.</p>
          )}
        </div>
      )}
    </div>
  );
}
