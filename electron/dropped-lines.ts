import { cueCandidate } from './transcript-edits.js';
import { isStockPhrase } from './stock-phrases.js';
import type { Model } from './workflow-types.js';
import type {
  DropReason,
  DroppedLine,
  TranscriptSegment,
  TranscriptSummary,
} from './transcript-contracts.js';

/**
 * VC-166: the speech model invents short lines over coughs, breaths and silence ("Thank you.").
 * A microphone line is dropped when it is short and either is a stock phrase or has no voice
 * under its words.
 *
 * Tuned on Cai Chapter 4 Battle and City (evidence\0.4.25\vc-166). The voice detector scores
 * real one-word lines low too (spoken Splits 0.02 to 0.23, "Okay." 0.06), so the voice score
 * alone would drop real speech. "No voice" therefore needs both detectors to agree: a voice
 * score under 0.1 and the speech model's own no-speech probability of 0.5 or more.
 */
export const dropRule = {
  /** Lines whose words span longer than this are kept, whatever they say. */
  shortSeconds: 2,
  /** Below this voice score the voice detector heard no voice under the words… */
  quietBelow: 0.1,
  /** …and the speech model itself thought the span held no speech. */
  noSpeechAbove: 0.5,
};

export const droppedLineId = (transcriptId: string, segmentId: number) =>
  `${transcriptId}:${segmentId}:dropped`;

/** The time a line's own words cover; the phrase timing when it has no words. */
export function wordSpan(segment: Pick<TranscriptSegment, 'start' | 'end' | 'words'>) {
  const words = segment.words || [];
  return words.length
    ? { start: words[0].start, end: words.at(-1)!.end }
    : { start: segment.start, end: segment.end };
}

export function dropReason(
  transcript: Pick<TranscriptSummary, 'role'>,
  segment: TranscriptSegment,
): DropReason | undefined {
  // Only new microphone transcriptions carry a voice score. Game dialogue is left alone.
  if (transcript.role !== 'mic' || segment.voiceScore == null) return;
  // Cue words and cue detection are frozen: a heard cue always stays for review.
  if (cueCandidate(transcript as TranscriptSummary, segment)) return;
  const span = wordSpan(segment);
  if (span.end - span.start > dropRule.shortSeconds) return;
  if (isStockPhrase(segment.text)) return 'stock-phrase';
  if (
    segment.voiceScore < dropRule.quietBelow &&
    segment.noSpeechProbability >= dropRule.noSpeechAbove
  )
    return 'no-voice';
}

/** The lines of a finished transcription that the drop rule leaves out. */
export function dropLines(
  transcript: Pick<TranscriptSummary, 'id' | 'role'>,
  segments: Iterable<TranscriptSegment>,
): DroppedLine[] {
  const dropped: DroppedLine[] = [];
  for (const segment of segments) {
    const reason = dropReason(transcript, segment);
    if (reason)
      dropped.push({
        id: droppedLineId(transcript.id, segment.id),
        transcriptId: transcript.id,
        segmentId: segment.id,
        reason,
      });
  }
  return dropped;
}

/** The dropped lines of one transcript, by line id. */
export function droppedIn(model: Pick<Model, 'droppedLines'>, transcriptId: string) {
  const lines = new Map<number, DropReason>();
  for (const line of model.droppedLines || [])
    if (line.transcriptId === transcriptId) lines.set(line.segmentId, line.reason);
  return lines;
}
