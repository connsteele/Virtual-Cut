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
  /** VC-212: a stitched clip's source spans; clip times run on across them. */
  pieces?: { start: number; end: number }[];
}

/** A suggestion only; the native save dialog still lets the user choose its destination. */
export function transcriptSaveSuggestion(
  scope: TranscriptScope,
  role: TranscriptSummary['role'],
  format: 'srt' | 'json',
) {
  let name =
    [...scope.name.replace(/[<>:"/\\|?*]/g, '-')]
      .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
      .join('')
      .trim()
      .replace(/\.(?:mp4|m4v|mov|mkv|webm)$/i, '')
      .slice(0, 140)
      .replace(/[. ]+$/, '') || 'Untitled';
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(name)) name = `Clip-${name}`;
  return {
    title: scope.exportId ? 'Export completed clip transcript' : 'Export source transcript',
    filename: `${name}-${scope.exportId ? 'clip' : 'source'}-transcript-${role}.${format}`,
  };
}
export function transcriptHandoff(
  transcript: TranscriptSummary,
  segments: Iterable<TranscriptSegment>,
  model: Pick<Model, 'transcriptEdits'>,
  scope: TranscriptScope,
) {
  // A stitched clip (VC-212) is cut piece by piece; clip times run on across its joins.
  const ranges = scope.pieces ?? [{ start: scope.start, end: scope.end }];
  const all = [...segments];
  let offset = 0;
  const spans = ranges.flatMap((range) => {
    const at = offset;
    offset += range.end - range.start;
    const toClip = (t: number) => t - range.start + at;
    return all
      .filter((s) => s.end > range.start && s.start < range.end)
      .map((segment) => {
        const start = Math.max(segment.start, range.start),
          end = Math.min(segment.end, range.end);
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
          .filter((w) => w.end > range.start && w.start < range.end);
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
          clipStart: toClip(start),
          clipEnd: toClip(end),
          // Unstitched exports keep the exact arithmetic older companions were written with.
          containerStart: scope.pieces
            ? toClip(start) + scope.start + scope.sourceStart + scope.timestampShift
            : start + scope.sourceStart + scope.timestampShift,
          containerEnd: scope.pieces
            ? toClip(end) + scope.start + scope.sourceStart + scope.timestampShift
            : end + scope.sourceStart + scope.timestampShift,
          words: words.map((w) => ({
            ...w,
            clipStart: toClip(Math.max(w.start, range.start)),
            clipEnd: toClip(Math.min(w.end, range.end)),
          })),
        };
      });
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
