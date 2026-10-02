import type { Model } from './workflow-types.js';
import type {
  TranscriptCommand,
  TranscriptSegment,
  TranscriptSummary,
} from './transcript-contracts.js';

export const correctionId = (transcriptId: string, segmentId: number, wordIndex?: number) =>
  `${transcriptId}:${segmentId}:${wordIndex == null ? 'phrase' : wordIndex}`;
/** Deliberate cues are candidates, never commands. Use only microphone recognition. */
export function cueCandidate(transcript: TranscriptSummary, segment: TranscriptSegment) {
  if (transcript.role !== 'mic') return null;
  const match = /^\s*(mark|note|cut)\b[\s,:.!-]*(.*)$/is.exec(segment.text);
  if (!match || /^(?:is|was|has|had|will|would|could|can|the|that)\b/i.test(match[2])) return null;
  return {
    kind: match[1].toLowerCase() as 'mark' | 'note' | 'cut',
    text: segment.cueText ?? match[2].trim(),
    time: segment.words[0]?.start ?? segment.start,
    uncertain: true,
  };
}
export function cueId(transcript: TranscriptSummary, segment: TranscriptSegment) {
  const cue = cueCandidate(transcript, segment);
  // Stable across reruns/alternate language hints. A quarter-second bucket tolerates small ASR shifts.
  return `${transcript.sourceId}:${transcript.track}:${cue?.kind}:${Math.round((cue?.time || segment.start) * 4)}`;
}
export function correctedText(
  model: Pick<Model, 'transcriptEdits'>,
  id: string,
  segment: TranscriptSegment,
) {
  const phrase = model.transcriptEdits?.find((e) => e.id === correctionId(id, segment.id));
  if (phrase) return phrase.text;
  return segment.words.length
    ? segment.words
        .map(
          (word, index) =>
            model.transcriptEdits?.find((e) => e.id === correctionId(id, segment.id, index))
              ?.text ?? word.text,
        )
        .join('')
    : segment.text;
}
export function applyTranscriptCommand(
  model: Model,
  transcript: TranscriptSummary,
  segment: TranscriptSegment,
  command: TranscriptCommand,
  newId: () => string,
): Model {
  if (
    transcript.state !== 'complete' ||
    transcript.id !== command.transcriptId ||
    transcript.sourceId !== command.sourceId ||
    segment.id !== command.segmentId
  )
    throw new Error('Reopen the completed transcript before editing it.');
  const record = model.recordings.find((r) => r.id === command.sourceId);
  if (!record) throw new Error('This recording is no longer in the project.');
  const next = structuredClone(model);
  if (command.action === 'correct' || command.action === 'restore') {
    if (
      command.wordIndex != null &&
      (!Number.isInteger(command.wordIndex) || !segment.words[command.wordIndex])
    )
      throw new Error('Choose a word in this phrase.');
    const id = correctionId(transcript.id, segment.id, command.wordIndex);
    const current = model.transcriptEdits?.find((e) => e.id === id);
    if (JSON.stringify(current || null) !== command.expected)
      throw new Error('This correction changed elsewhere. Refresh it before saving.');
    next.transcriptEdits = (model.transcriptEdits || []).filter((e) => e.id !== id);
    if (command.action === 'correct') {
      if (typeof command.text !== 'string' || !command.text.trim() || command.text.length > 10000)
        throw new Error('Enter a correction of up to 10,000 characters.');
      // Replacing multiple words is a phrase correction, never fabricated word alignment.
      if (command.wordIndex != null && command.text.trim().split(/\s+/).length > 1)
        throw new Error('Use Edit phrase to replace a word with several words.');
      const word = command.wordIndex == null ? undefined : segment.words[command.wordIndex];
      const text = word
        ? (word.text.match(/^\s*/)?.[0] || '') +
          command.text.trim() +
          (word.text.match(/\s*$/)?.[0] || '')
        : command.text;
      next.transcriptEdits.push({
        id,
        transcriptId: transcript.id,
        segmentId: segment.id,
        wordIndex: command.wordIndex,
        text,
      });
    }
    return next;
  }
  const cue = cueCandidate(transcript, segment);
  if (!cue) throw new Error('This phrase does not contain a microphone cue candidate.');
  const id = cueId(transcript, segment),
    current = model.cueDecisions?.find((c) => c.id === id);
  if (JSON.stringify(current || null) !== command.expected || current)
    throw new Error('This cue was already reviewed. Undo its decision before changing it.');
  if (!['accept-cue', 'reject-cue'].includes(command.action))
    throw new Error('Unknown transcript action.');
  const decision = {
    id,
    status: command.action === 'accept-cue' ? ('accepted' as const) : ('rejected' as const),
    markerId: undefined as string | undefined,
    noteId: undefined as string | undefined,
  };
  if (decision.status === 'accepted') {
    const text = (command.text ?? cue.text).trim();
    if (text.length > 10000) throw new Error('Cue note is too long.');
    if (cue.kind === 'cut') {
      const intersecting = next.clips.filter(
        (c) => c.rid === record.id && cue.time > c.start + 0.001 && cue.time < c.end - 0.001,
      );
      if (intersecting.length !== 1)
        throw new Error(
          'Cut needs exactly one clip at this time. Resolve overlapping clips in Cut first.',
        );
      const clip = intersecting[0],
        end = clip.end;
      clip.end = cue.time;
      clip.accepted = false;
      next.clips.push({
        ...clip,
        id: newId(),
        name: `${clip.name} · 2`,
        start: cue.time,
        end,
        accepted: false,
      });
    } else if (cue.kind === 'note') {
      decision.noteId = newId();
      next.notes.push({
        id: decision.noteId,
        title: text.slice(0, 100) || 'Spoken note',
        text,
        url: '',
        sourceId: record.id,
        time: cue.time,
        transcriptId: transcript.id,
        segmentIds: segment.cueSegmentIds || [segment.id],
      });
    } else {
      decision.markerId = newId();
      next.markers[record.id] = [
        ...(next.markers[record.id] || []),
        {
          id: decision.markerId,
          time: cue.time,
          name: text.slice(0, 100) || 'Spoken marker',
          note: text,
          category: 'Context',
          topic: '',
          color: 'Blue',
        },
      ];
    }
  }
  next.cueDecisions = [...(next.cueDecisions || []), decision];
  return next;
}
