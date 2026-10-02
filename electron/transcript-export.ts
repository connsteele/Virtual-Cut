import type { TranscriptSegment, TranscriptSummary } from './transcript-contracts.js';
import type { Model } from './workflow-types.js';
import { correctedText, correctionId } from './transcript-edits.js';
export interface TranscriptScope {
  start: number;
  end: number;
  sourceStart: number;
  timestampShift: number;
  exportId?: string;
  output?: string;
  name: string;
}
export function transcriptHandoff(
  transcript: TranscriptSummary,
  segments: Iterable<TranscriptSegment>,
  model: Pick<Model, 'transcriptEdits'>,
  scope: TranscriptScope,
) {
  const spans = [...segments]
    .filter((s) => s.end > scope.start && s.start < scope.end)
    .map((segment) => {
      const start = Math.max(segment.start, scope.start),
        end = Math.min(segment.end, scope.end);
      const phraseEdit = model.transcriptEdits?.find(
        (e) => e.id === correctionId(transcript.id, segment.id),
      );
      const words = segment.words
        .map((word, index) => ({
          ...word,
          correctedText:
            model.transcriptEdits?.find(
              (e) => e.id === correctionId(transcript.id, segment.id, index),
            )?.text ?? word.text,
        }))
        .filter((w) => w.end > scope.start && w.start < scope.end);
      return {
        original: segment,
        correctedText: correctedText(model, transcript.id, segment),
        subtitleText:
          phraseEdit?.text ??
          (words.length ? words.map((w) => w.correctedText).join('') : segment.text),
        timingPrecision: phraseEdit || !segment.words.length ? 'phrase' : 'word',
        partialPhrase: start !== segment.start || end !== segment.end,
        sourceStart: start,
        sourceEnd: end,
        clipStart: start - scope.start,
        clipEnd: end - scope.start,
        containerStart: start + scope.sourceStart + scope.timestampShift,
        containerEnd: end + scope.sourceStart + scope.timestampShift,
        words: words.map((w) => ({
          ...w,
          clipStart: Math.max(w.start, scope.start) - scope.start,
          clipEnd: Math.min(w.end, scope.end) - scope.start,
        })),
      };
    });
  return {
    schema: 'virtual-cut-transcript',
    version: 1,
    transcript,
    scope,
    spans,
    corrections: (model.transcriptEdits || []).filter(
      (e) => e.transcriptId === transcript.id && spans.some((s) => s.original.id === e.segmentId),
    ),
  };
}
export function subtitleTime(time: number) {
  const ms = Math.max(0, Math.round(time * 1000)),
    seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
export function transcriptSrt(handoff: ReturnType<typeof transcriptHandoff>) {
  return handoff.spans
    .map(
      (span, i) =>
        `${i + 1}\n${subtitleTime(span.clipStart)} --> ${subtitleTime(span.clipEnd)}\n${span.subtitleText.trim()}\n`,
    )
    .join('\n');
}
