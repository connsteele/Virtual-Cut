import { reopenDecision } from './decision-reopen.js';
import type { Model } from './workflow-types.js';
import type {
  TranscriptCommand,
  TranscriptSegment,
  TranscriptSummary,
  CueDecision,
  CueKind,
} from './transcript-contracts.js';

export const correctionId = (transcriptId: string, segmentId: number, wordIndex?: number) =>
  `${transcriptId}:${segmentId}:${wordIndex == null ? 'phrase' : wordIndex}`;

/** A paired range always takes its suggested title from the start cue. */
export function cueTitle(transcript: TranscriptSummary, segment: TranscriptSegment) {
  const cue = cueCandidate(transcript, segment);
  return cue?.kind === 'clip-end'
    ? (segment.cuePartner?.text ?? segment.cueTitle ?? cue.text)
    : (segment.cueTitle ?? cue?.text ?? '');
}

export function cueContext(segment: TranscriptSegment, endSegmentId?: number) {
  const available = segment.cueContext ?? [
    {
      id: segment.id,
      start: segment.start,
      end: segment.end,
      text: segment.cueText ?? segment.text,
    },
  ];
  const last =
    endSegmentId == null ? available.length - 1 : available.findIndex((p) => p.id === endSegmentId);
  if (last < 0) throw new Error('Choose an included phrase from this cue context.');
  const parts = available.slice(0, last + 1);
  return {
    parts,
    text: parts
      .map((p) => p.text)
      .filter(Boolean)
      .join(' '),
    start: parts[0].start,
    end: parts.at(-1)!.end,
    segmentIds: parts.map((p) => p.id),
  };
}

export const cueReviewKey = (transcript: TranscriptSummary, segment: TranscriptSegment) =>
  JSON.stringify({
    title: cueTitle(transcript, segment),
    kind: cueCandidate(transcript, segment)?.kind,
    partner: segment.cuePartner,
    context: segment.cueContext,
  });
/** Deliberate cues are candidates, never commands. Use only microphone recognition. */
export function cueCandidate(transcript: TranscriptSummary, segment: TranscriptSegment) {
  if (transcript.role !== 'mic') return null;
  const time = segment.words[0]?.start ?? segment.start;
  // Derived cues have already passed the raw phrase guard; their punctuation may be absent.
  if (segment.cueKind)
    return { kind: segment.cueKind, text: segment.cueText || '', time, uncertain: true };
  const match =
    /^\s*(marker|mark|note|cut|split|clip[\s-]+(?:start|in|end|out))\b([\s,:.!-]*)(.*)$/is.exec(
      segment.text,
    );
  if (!match) return null;
  const body = match[3].trim();
  const noteRequest =
    /^(?:marker|mark|note)$/i.test(match[1]) &&
    /[:,]/.test(match[2]) &&
    /^(?:can|could)\s+I\s+(?:get|make|add|have|record|leave)\s+(?:(?:a|the|this|some)\s+)?(?:note|marker)\b/i.test(
      body,
    );
  const colonContext =
    /^(?:marker|mark|note)$/i.test(match[1]) &&
    match[2].includes(':') &&
    /^(?:the|that)\b/i.test(body);
  if (
    /^(?:is|was|has|had|will|would|could|can|the|that)\b/i.test(body) &&
    !noteRequest &&
    !colonContext
  )
    return null;
  return {
    kind: (match[1].toLowerCase() === 'marker'
      ? 'mark'
      : match[1].toLowerCase() === 'split'
        ? 'cut'
        : /^clip[\s-]+(?:start|in)$/i.test(match[1])
          ? 'clip-start'
          : /^clip[\s-]+(?:end|out)$/i.test(match[1])
            ? 'clip-end'
            : match[1].toLowerCase()) as CueKind,
    text: body,
    time,
    uncertain: true,
  };
}
export function cueId(transcript: TranscriptSummary, segment: TranscriptSegment) {
  const cue = cueCandidate(transcript, segment);
  // The ID is stable for identical timings; reviewedCue also handles nearby rerun anchors.
  return `${transcript.sourceId}:${transcript.track}:${cue?.kind}:${Math.round((cue?.time || segment.start) * 4)}`;
}
export function reviewedCue(
  decisions: CueDecision[],
  transcript: TranscriptSummary,
  segment: TranscriptSegment,
) {
  const cue = cueCandidate(transcript, segment);
  if (!cue) return undefined;
  return decisions.find(
    (d) =>
      d.id === cueId(transcript, segment) ||
      (d.sourceId === transcript.sourceId &&
        d.track === transcript.track &&
        d.kind === cue.kind &&
        d.time != null &&
        Math.abs(d.time - cue.time) <= 0.5),
  );
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
  partner?: TranscriptSegment,
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
    current = reviewedCue(model.cueDecisions || [], transcript, segment);
  // Reopening puts the cue back in review and takes back what accepting made.
  if (command.action === 'reopen-cue') {
    if (!current || JSON.stringify(current) !== command.expected)
      throw new Error('This cue changed elsewhere. Refresh it before reopening.');
    if (current.settledBy)
      throw new Error("An agent reworked this cue. Reopen it from the agent's card.");
    return reopenDecision(model, current);
  }
  if (JSON.stringify(current || null) !== command.expected || current)
    throw new Error('This cue was already reviewed. Undo its decision before changing it.');
  if (!['accept-cue', 'reject-cue'].includes(command.action))
    throw new Error('Unknown transcript action.');
  const decision: CueDecision = {
    id,
    sourceId: transcript.sourceId,
    track: transcript.track,
    kind: cue.kind,
    time: cue.time,
    status: command.action === 'accept-cue' ? ('accepted' as const) : ('rejected' as const),
    markerId: undefined as string | undefined,
    noteId: undefined as string | undefined,
  };
  if (decision.status === 'accepted') {
    if (
      command.contextExpected != null &&
      command.contextExpected !== cueReviewKey(transcript, segment)
    )
      throw new Error('This cue context changed elsewhere. Refresh it before accepting.');
    const context = cueContext(segment, command.contextEndSegmentId);
    const target = command.time ?? cue.time;
    if (!Number.isFinite(target) || target < 0 || target > record.duration)
      throw new Error('Choose a cue position inside this recording.');
    decision.appliedTime = target;
    if (command.text != null && typeof command.text !== 'string')
      throw new Error('Enter cue context text.');
    const text = (command.text ?? (segment.cueContext ? context.text : cue.text)).trim();
    if (text.length > 10000) throw new Error('Cue note is too long.');
    if (command.title != null && (typeof command.title !== 'string' || command.title.length > 200))
      throw new Error('Enter a cue title of up to 200 characters.');
    if (cue.kind !== 'cut') {
      decision.transcriptId = transcript.id;
      decision.segmentIds = context.segmentIds;
      decision.contextStart = context.start;
      decision.contextEnd = context.end;
      decision.title = command.title?.trim();
    }
    if (cue.kind === 'cut') {
      const intersecting = next.clips.filter(
        (c) =>
          c.rid === record.id &&
          target > c.start + 0.001 &&
          target < c.end - 0.001 &&
          (!command.clipId || c.id === command.clipId),
      );
      if (intersecting.length !== 1)
        throw new Error(
          'Split needs exactly one clip containing this position. Select a target for overlapping clips.',
        );
      const clip = intersecting[0],
        end = clip.end;
      // Names for both halves (VC-155): what the card shows, else the clip's name and "· 2".
      const names = [command.firstName, command.secondName].map((n) =>
        typeof n === 'string' ? n.trim() : '',
      );
      if (names.some((n) => n.length > 200))
        throw new Error('Enter clip names of up to 200 characters.');
      decision.priorName = clip.name;
      if (names[0]) clip.name = names[0];
      clip.end = target;
      clip.accepted = false;
      decision.clipId = newId();
      next.clips.push({
        ...clip,
        id: decision.clipId,
        name: names[1] || `${clip.name} · 2`,
        start: target,
        end,
        accepted: false,
      });
    } else if (cue.kind === 'clip-start' || cue.kind === 'clip-end') {
      const other = partner && cueCandidate(transcript, partner);
      if (
        !partner ||
        !other ||
        partner.id !== command.partnerSegmentId ||
        other.kind !== (cue.kind === 'clip-start' ? 'clip-end' : 'clip-start') ||
        reviewedCue(model.cueDecisions || [], transcript, partner)
      )
        throw new Error(
          'Review an unpaired Clip start and Clip end together. The other cue may have changed.',
        );
      const start = command.time ?? (cue.kind === 'clip-start' ? cue.time : other.time);
      const end = command.endTime ?? (cue.kind === 'clip-end' ? cue.time : other.time);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end > record.duration ||
        end - start < 0.001
      )
        throw new Error('Clip end must follow its start within this recording.');
      decision.clipId = newId();
      next.clips.push({
        id: decision.clipId,
        rid: record.id,
        name:
          (
            command.title ??
            command.text ??
            (cue.kind === 'clip-start'
              ? cueTitle(transcript, segment)
              : cueTitle(transcript, partner))
          )
            .trim()
            .slice(0, 200) || 'Spoken clip',
        start,
        end,
        folder: '_Review',
        include: true,
        accepted: false,
        ...(command.title != null && text ? { note: text } : {}),
      });
      next.cueDecisions = [
        ...(next.cueDecisions || []),
        {
          id: cueId(transcript, partner),
          sourceId: transcript.sourceId,
          track: transcript.track,
          kind: other.kind,
          time: other.time,
          status: 'accepted',
          clipId: decision.clipId,
          appliedTime: other.kind === 'clip-start' ? start : end,
          transcriptId: decision.transcriptId,
          segmentIds: decision.segmentIds,
          contextStart: decision.contextStart,
          contextEnd: decision.contextEnd,
          title: decision.title,
        },
      ];
      decision.appliedTime = cue.kind === 'clip-start' ? start : end;
    } else if (cue.kind === 'note') {
      decision.noteId = newId();
      next.notes.push({
        id: decision.noteId,
        title: (command.title ?? text).trim().slice(0, 100) || 'Spoken note',
        text,
        url: '',
        sourceId: record.id,
        time: target,
        transcriptId: transcript.id,
        segmentIds: context.segmentIds,
      });
    } else {
      decision.markerId = newId();
      next.markers[record.id] = [
        ...(next.markers[record.id] || []),
        {
          id: decision.markerId,
          time: target,
          name: (command.title ?? text).trim().slice(0, 100) || 'Spoken marker',
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
