import { useState } from 'react';
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
import { Button, Field } from './ui';
import s from './TranscriptWindow.module.css';

export function TranscriptCue({
  segment,
  transcript,
  session,
  busy,
  onCommand,
  onSeek,
}: {
  segment: TranscriptSegment;
  transcript: TranscriptSummary;
  session: TranscriptSession;
  busy: boolean;
  onCommand: (action: 'accept-cue' | 'reject-cue', values: Partial<TranscriptCommand>) => void;
  onSeek: (time: number) => void;
}) {
  const cue = cueCandidate(transcript, segment)!;
  const range = cue.kind === 'clip-start' || cue.kind === 'clip-end';
  const [draft, setDraft] = useState<{
    title?: string;
    contextEndSegmentId?: number;
    text?: string;
    time?: string;
    end?: string;
    clipId?: string;
  }>({});
  const context = cueContext(segment, draft.contextEndSegmentId);
  const suggestedTitle = cueTitle(transcript, segment).slice(0, range ? 200 : 100);
  const start =
    draft.time ??
    String(range && cue.kind === 'clip-end' ? (segment.cuePartner?.time ?? cue.time) : cue.time);
  const end =
    draft.end ??
    String(cue.kind === 'clip-end' ? cue.time : (segment.cuePartner?.time ?? cue.time));
  const targetClips = session.clips.filter((c) => Number(start) > c.start && Number(start) < c.end);
  const target = draft.clipId || (targetClips.length === 1 ? targetClips[0].id : '');
  const decision = reviewedCue(session.decisions, transcript, segment);
  const label = range
    ? 'Clip range'
    : cue.kind === 'cut'
      ? 'Split'
      : cue.kind === 'note'
        ? 'Timed note'
        : 'Point marker';
  return (
    <div
      className={s.cue}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setDraft({});
      }}
    >
      <strong>{label} candidate</strong> · {decision?.status || 'Needs review'}
      {decision?.status === 'accepted' &&
        decision.contextStart != null &&
        decision.contextEnd != null && (
          <p className={s.muted}>
            Included context: {decision.contextStart.toFixed(3)}–{decision.contextEnd.toFixed(3)}{' '}
            seconds
            {decision.title ? ` · ${decision.title}` : ''}
          </p>
        )}
      {!decision && (
        <>
          <p>Check the audio and adjust the position before accepting.</p>
          {range && (
            <p>
              {segment.cuePartner
                ? 'Review both boundaries together. Accepting creates one clip and approves both cues.'
                : 'No unambiguous matching boundary. Correct the cue wording, or create this clip in Cut.'}
            </p>
          )}
          {cue.kind !== 'cut' && (
            <>
              <Field label="Title">
                <input
                  aria-label={`Cue title ${segment.id}`}
                  value={draft.title ?? suggestedTitle}
                  maxLength={range ? 200 : 100}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </Field>
              <details className={s.context} open>
                <summary>
                  Included spoken context · {context.start.toFixed(3)}–{context.end.toFixed(3)} s
                </summary>
                <p className={s.muted}>
                  Speech continues until the next cue, even across pauses. Choose the last included
                  phrase and review the text. Changing the last phrase resets this text to the
                  selected speech. Original recognition is kept.
                </p>
                <Field label="Include through">
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
                <Field label="Context text">
                  <textarea
                    aria-label={`Cue text ${segment.id}`}
                    value={draft.text ?? context.text}
                    maxLength={10000}
                    onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                  />
                </Field>
                <div className={s.toolbar}>
                  <Button onClick={() => onSeek(context.start)}>Listen from context start</Button>
                  <Button onClick={() => onSeek(context.end)}>Seek to context end</Button>
                </div>
                {segment.cueContextLimited && (
                  <p className={s.muted}>
                    This proposal reached the context limit. Later speech remains in the full
                    transcript.
                  </p>
                )}
              </details>
            </>
          )}
          <div className={s.toolbar}>
            <Field label={range ? 'Start (seconds)' : 'Position (seconds)'}>
              <input
                aria-label={`Cue position ${segment.id}`}
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
                  aria-label={`Cue end ${segment.id}`}
                  type="number"
                  min={0}
                  step="0.001"
                  value={end}
                  onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                />
              </Field>
            )}
          </div>
          {cue.kind === 'cut' && (
            <Field label="Clip to split">
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
            </Field>
          )}
          <Button
            disabled={
              busy ||
              transcript.state !== 'complete' ||
              !start.trim() ||
              (range && (!segment.cuePartner || !end.trim())) ||
              (cue.kind === 'cut' && !target)
            }
            onClick={() =>
              onCommand('accept-cue', {
                title: cue.kind !== 'cut' ? (draft.title ?? suggestedTitle) : undefined,
                text: draft.text ?? context.text,
                contextEndSegmentId: context.segmentIds.at(-1),
                contextExpected: cueReviewKey(transcript, segment),
                time: Number(start),
                endTime: range ? Number(end) : undefined,
                partnerSegmentId: range ? segment.cuePartner?.id : undefined,
                clipId: cue.kind === 'cut' ? target : undefined,
              })
            }
          >
            Accept{' '}
            {range
              ? 'clip range'
              : cue.kind === 'cut'
                ? 'split'
                : cue.kind === 'note'
                  ? 'timed note'
                  : 'marker'}
          </Button>
          <Button
            disabled={busy || transcript.state !== 'complete'}
            onClick={() => onCommand('reject-cue', {})}
          >
            Reject
          </Button>
        </>
      )}
    </div>
  );
}
