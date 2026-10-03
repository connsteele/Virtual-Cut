import { useState } from 'react';
import type {
  TranscriptCommand,
  TranscriptSegment,
  TranscriptSession,
  TranscriptSummary,
} from '../../electron/transcript-contracts';
import { cueCandidate, cueTitle, reviewedCue } from '../../electron/transcript-edits';
import { Button, Field } from './ui';
import s from './TranscriptWindow.module.css';

export function TranscriptCue({
  segment,
  transcript,
  session,
  busy,
  onCommand,
}: {
  segment: TranscriptSegment;
  transcript: TranscriptSummary;
  session: TranscriptSession;
  busy: boolean;
  onCommand: (action: 'accept-cue' | 'reject-cue', values: Partial<TranscriptCommand>) => void;
}) {
  const cue = cueCandidate(transcript, segment)!;
  const range = cue.kind === 'clip-start' || cue.kind === 'clip-end';
  const [draft, setDraft] = useState<{
    text?: string;
    time?: string;
    end?: string;
    clipId?: string;
  }>({});
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
          <input
            aria-label={`Cue text ${segment.id}`}
            value={draft.text ?? cueTitle(transcript, segment)}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          />
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
                text: draft.text ?? cueTitle(transcript, segment),
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
