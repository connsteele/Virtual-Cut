import { useEffect, useState } from 'react';
import type {
  TranscriptCommand,
  TranscriptSegment,
  TranscriptSession,
  TranscriptSummary,
} from '../../electron/transcript-contracts';
import {
  cueCandidate,
  cueTitle,
  cueContext,
  cueReviewKey,
  reviewedCue,
} from '../../electron/transcript-edits';
import type { SplitSnap } from '../../electron/split-snap';
import { background } from './background';
import { formatTimecode } from './transcriptTime';
import { ProposalCard } from './ProposalCard';
import { Button, Field } from './ui';
import { TimeField } from './TimeField';
import { useCardDraft } from './useCardDraft';
import s from './TranscriptWindow.module.css';

/** A spoken cue on the shared proposal card (VC-155), decided where it was said. */
export function TranscriptCue({
  segment,
  transcript,
  session,
  busy,
  playhead,
  onCommand,
  onSeek,
}: {
  segment: TranscriptSegment;
  transcript: TranscriptSummary;
  session: TranscriptSession;
  busy: boolean;
  playhead: number;
  onCommand: (
    action: 'accept-cue' | 'reject-cue' | 'reopen-cue',
    values: Partial<TranscriptCommand>,
  ) => void;
  onSeek: (time: number) => void;
}) {
  const cue = cueCandidate(transcript, segment)!;
  const range = cue.kind === 'clip-start' || cue.kind === 'clip-end';
  const split = cue.kind === 'cut';
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const { draft, setDraft, undo, reset } = useCardDraft<{
    title?: string;
    contextEndSegmentId?: number;
    text?: string;
    time?: number;
    end?: number;
    clipId?: string;
    first?: string;
    second?: string;
  }>();
  const decision = reviewedCue(session.decisions, transcript, segment);
  // VC-165: a pending Split proposes the end of a black screen just before the word, if any.
  const [snap, setSnap] = useState<SplitSnap | null>(null);
  const [spokenChosen, setSpokenChosen] = useState(false);
  const decided = decision != null;
  useEffect(() => {
    const api = window.virtualCut?.transcript;
    if (!split || decided || transcript.state !== 'complete' || !api) return;
    let live = true;
    background(
      api
        .splitSnap(session.projectId, transcript.sourceId, cue.time)
        .then((found) => live && setSnap(found))
        // Without a measurement the spoken time stands; the card stays usable.
        .catch(() => live && setSnap(null)),
    );
    return () => {
      live = false;
    };
  }, [split, decided, transcript.state, session.projectId, transcript.sourceId, cue.time]);
  const snapped = split && snap && !spokenChosen ? snap.time : undefined;
  const context = cueContext(segment, draft.contextEndSegmentId);
  const suggestedTitle = cueTitle(transcript, segment).slice(0, range ? 200 : 100);
  const title = draft.title ?? suggestedTitle;
  const text = draft.text ?? context.text;
  const start =
    draft.time ??
    snapped ??
    (range && cue.kind === 'clip-end' ? (segment.cuePartner?.time ?? cue.time) : cue.time);
  const end =
    draft.end ?? (cue.kind === 'clip-end' ? cue.time : (segment.cuePartner?.time ?? cue.time));
  const targetClips = session.clips.filter((c) => start > c.start && start < c.end);
  const target = draft.clipId || (targetClips.length === 1 ? targetClips[0].id : '');
  const targetName = targetClips.find((c) => c.id === target)?.name ?? '';
  const first = draft.first ?? targetName;
  const second = draft.second ?? (first ? `${first} · 2` : '');
  const kind = range
    ? 'Clip range'
    : split
      ? 'Split'
      : cue.kind === 'note'
        ? 'Timed note'
        : 'Marker';
  return (
    <ProposalCard
      id={`cue:${transcript.id}:${segment.id}`}
      who="spoken"
      kind={kind}
      name={
        split ? (
          <>
            {first || 'Clip'} <span className={s.pcCut}>|</span> {second || 'Clip · 2'}
          </>
        ) : (
          decision?.title || title || segment.text.trim()
        )
      }
      editLine={
        <>
          {split ? (
            <>
              <input
                className={s.inlineField}
                aria-label={`Split first clip name ${segment.id}`}
                value={first}
                maxLength={200}
                onChange={(e) => setDraft({ ...draft, first: e.target.value })}
              />
              <span className={s.pcCut}>|</span>
              <input
                className={s.inlineField}
                aria-label={`Split second clip name ${segment.id}`}
                value={second}
                maxLength={200}
                onChange={(e) => setDraft({ ...draft, second: e.target.value })}
              />
            </>
          ) : (
            <input
              className={s.inlineField}
              aria-label={`Cue title ${segment.id}`}
              value={title}
              maxLength={range ? 200 : 100}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          )}
          <TimeField
            name={`Cue position ${segment.id}`}
            value={start}
            playhead={playhead}
            onChange={(time) => setDraft({ ...draft, time })}
          />
          {range && (
            <>
              <span className={s.pcCut}>–</span>
              <TimeField
                name={`Cue end ${segment.id}`}
                value={end}
                playhead={playhead}
                onChange={(time) => setDraft({ ...draft, end: time })}
              />
            </>
          )}
        </>
      }
      time={decision?.appliedTime ?? start}
      end={range ? end : undefined}
      meta={
        range && !segment.cuePartner
          ? ['No matching boundary: correct the cue wording, or create this clip in Cut.']
          : split && snap
            ? [
                <span key="snap" data-split-snap={spokenChosen ? 'spoken' : 'snapped'}>
                  {spokenChosen
                    ? 'Spoken time. Black screen ends at '
                    : 'Snapped to where a black screen ends. Spoken at '}
                  <button
                    className={s.pcTime}
                    title={
                      spokenChosen ? 'Go to the end of the black screen' : 'Go to the spoken Split'
                    }
                    onClick={() => onSeek(spokenChosen ? snap.time : snap.spoken)}
                  >
                    {formatTimecode(spokenChosen ? snap.time : snap.spoken)}
                  </button>{' '}
                  <button
                    className={s.pcQuiet}
                    disabled={busy || draft.time != null}
                    title={
                      draft.time != null
                        ? 'The position was edited; Esc puts it back'
                        : spokenChosen
                          ? 'Suggest the end of the black screen again'
                          : 'Dismiss the snap and keep the spoken time'
                    }
                    onClick={() => setSpokenChosen(!spokenChosen)}
                  >
                    {spokenChosen ? 'Use snap' : 'Use spoken time'}
                  </button>
                </span>,
              ]
            : []
      }
      changedSince={
        decision?.status === 'accepted' &&
        decision.clipId != null &&
        !session.clips.some((c) => c.id === decision.clipId)
      }
      status={decision?.status || 'pending'}
      open={open}
      editing={editing}
      busy={busy || transcript.state !== 'complete'}
      acceptLabel={`Accept ${kind.toLowerCase()}`}
      acceptDisabled={(range && !segment.cuePartner) || (split && !target)}
      onToggle={() => {
        setOpen(!open);
        if (open) setEditing(false);
      }}
      onEdit={() => {
        setOpen(true);
        setEditing(!editing);
      }}
      onAccept={() =>
        onCommand('accept-cue', {
          title: split ? undefined : title,
          text,
          contextEndSegmentId: context.segmentIds.at(-1),
          contextExpected: cueReviewKey(transcript, segment),
          time: start,
          endTime: range ? end : undefined,
          partnerSegmentId: range ? segment.cuePartner?.id : undefined,
          clipId: split ? target : undefined,
          firstName: split ? first : undefined,
          secondName: split ? second : undefined,
        })
      }
      onReject={() => onCommand('reject-cue', {})}
      onReopen={() => onCommand('reopen-cue', {})}
      onCancel={() => {
        reset();
        setEditing(false);
      }}
      onUndo={undo}
      onSeek={onSeek}
    >
      <div className={s.pcDetails}>
        {!split && editing && (
          <>
            <textarea
              className={s.inlineNote}
              aria-label={`Cue text ${segment.id}`}
              value={text}
              maxLength={10000}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
            <Field label="Include speech through">
              <select
                aria-label={`Cue context end ${segment.id}`}
                value={context.segmentIds.at(-1)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    contextEndSegmentId: Number(e.target.value),
                    text: undefined,
                  })
                }
              >
                {(segment.cueContext ?? context.parts).map((part) => (
                  <option key={part.id} value={part.id}>
                    {part.end.toFixed(3)} s · {part.text.slice(0, 65) || 'Cue phrase'}
                  </option>
                ))}
              </select>
            </Field>
            <p className={s.muted}>
              Speech continues until the next cue, even across pauses. Changing the last phrase
              resets the note to the selected speech. Original recognition is kept.
              {segment.cueContextLimited
                ? ' This cue reached the context limit; later speech stays in the transcript.'
                : ''}
            </p>
            <div className={s.toolbar}>
              <Button onClick={() => onSeek(context.start)}>Listen from context start</Button>
              <Button onClick={() => onSeek(context.end)}>Seek to context end</Button>
            </div>
          </>
        )}
        {!split && !editing && text && <p className={s.reason}>{text}</p>}
        {split && (
          <p className={s.muted}>
            Splits{' '}
            {editing ? (
              <select
                aria-label={`Split target ${segment.id}`}
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
          </p>
        )}
        {range && (
          <p className={s.muted}>
            {segment.cuePartner
              ? 'Review both boundaries together. Accepting creates one clip and approves both cues.'
              : 'No unambiguous matching boundary. Correct the cue wording, or create this clip in Cut.'}
          </p>
        )}
        <p className={s.why}>
          <strong>Heard:</strong> “{segment.text.trim()}”
        </p>
      </div>
    </ProposalCard>
  );
}
