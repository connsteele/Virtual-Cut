import * as z from 'zod';
import {
  AgentReadError,
  currentTranscripts,
  findRecording,
  type AgentReadSource,
} from './agent-tools.js';
import { correctedText, cueCandidate } from './transcript-edits.js';
import { proposalDecision, proposalIntents, proposalStatus } from './proposal-edits.js';
import type { AgentProposal, ProposalEvidence, ProposalKind } from './proposal-contracts.js';
import type { TranscriptSegment } from './transcript-contracts.js';

/**
 * Agent proposals over MCP (VC-161/VC-162). `submit_proposals` validates a whole submission
 * against the project and stores it as candidates; nothing changes in the project until the user
 * accepts one on its cue card. `get_proposal_decisions` reads the user's choices back.
 */
const kinds = { marker: 'mark', note: 'note', split: 'cut', clip: 'clip' } as const;
const kindName = Object.fromEntries(Object.entries(kinds).map(([k, v]) => [v, k])) as Record<
  ProposalKind,
  keyof typeof kinds
>;
export const proposalInput = z.object({
  kind: z
    .enum(['marker', 'note', 'split', 'clip'])
    .describe(
      'marker: a marker with a note, at a point or (with end_seconds) over a range that labels part of a continuous scene. note: a timed note. split: split the clip at this time. clip: a clip range from time_seconds to end_seconds.',
    ),
  time_seconds: z.number().min(0).describe('Position in the recording, in seconds.'),
  end_seconds: z
    .number()
    .positive()
    .optional()
    .describe('End of a clip (required) or of a range marker (optional).'),
  title: z
    .string()
    .min(1)
    .max(200)
    .describe('Marker, note or clip name (100 characters except clips).'),
  note: z.string().max(10000).optional().describe('Marker note, note text or clip note.'),
  clip_names: z
    .object({ first: z.string().min(1).max(200), second: z.string().min(1).max(200) })
    .optional()
    .describe(
      'Splits only: suggested names for the clip before the split and the clip after it, from what the recording shows and says. Strongly recommended for every split.',
    ),
  reason: z
    .string()
    .min(1)
    .max(2000)
    .describe('Why you propose this, shown to the user on the card.'),
  intent: z
    .enum(['marker', 'general', 'notion', 'edit'])
    .optional()
    .describe('One intent tag; use intents for several.'),
  intents: z
    .array(z.enum(['marker', 'general', 'notion', 'edit']))
    .max(4)
    .optional()
    .describe(
      "The user's intent tags for the speech behind it (see get_intent_guide): marker, general (context or naming), notion (a note for the video notes) or edit (an editing instruction). A line can carry several.",
    ),
  notion: z
    .object({
      target: z.enum(['new', 'expands', 'duplicate']),
      existing: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('The existing note it expands or repeats.'),
    })
    .optional()
    .describe(
      'Only with the notion intent: whether the note is new, expands an existing note or repeats one.',
    ),
  refines: z
    .object({
      transcript_id: z.string().max(200).describe('The current mic transcriptId.'),
      line_id: z.number().int().min(0).describe('The mic line holding the spoken cue.'),
    })
    .optional()
    .describe(
      'A spoken cue this proposal reworks (a Split, Marker, Note or Clip cue the app heard). The user sees one card showing the cue as heard and what you changed; accepting it settles both.',
    ),
  evidence: z
    .array(
      z.object({
        role: z.enum(['mic', 'game']),
        transcript_id: z.string().max(200).describe('transcriptId from get_transcript.'),
        line_ids: z.array(z.number().int().min(0)).min(1).max(50),
      }),
    )
    .max(10)
    .default([])
    .describe('The transcript lines this proposal rests on.'),
});
export const submitInput = z.object({
  recording_id: z.string().max(200),
  proposals: z.array(proposalInput).min(1).max(50),
  agent_model: z.string().max(100).optional().describe('Your model name, kept as provenance.'),
});
export const decisionsInput = z.object({
  recording_id: z.string().max(200).optional().describe('Limit to one recording.'),
  proposal_ids: z.array(z.string().max(200)).max(200).optional(),
  status: z.enum(['pending', 'accepted', 'rejected', 'decided']).optional(),
});
export type SubmitInput = z.input<typeof submitInput>;
export type DecisionsInput = z.input<typeof decisionsInput>;

const round = (n: number) => Math.round(n * 1000) / 1000;
/** Pending proposals of the same kind within this many seconds repeat each other. */
const repeatWindow = 0.25;

function lineQuote(
  source: AgentReadSource,
  transcriptId: string,
  lineIds: number[],
  field: string,
): Pick<ProposalEvidence, 'start' | 'end' | 'quote'> {
  const wanted = [...new Set(lineIds)].sort((a, b) => a - b);
  const found: TranscriptSegment[] = [];
  for (const segment of source.transcripts.segments(transcriptId, wanted[0] - 1)) {
    if (segment.id > wanted.at(-1)!) break;
    if (wanted.includes(segment.id)) found.push(segment);
  }
  const missing = wanted.find((id) => !found.some((s) => s.id === id));
  if (missing !== undefined)
    throw new AgentReadError(`${field}: line ${missing} is not in that transcript.`);
  return {
    start: round(found[0].start),
    end: round(found.at(-1)!.end),
    quote: found
      .map((s) => correctedText(source.model, transcriptId, s).trim())
      .join(' ')
      .slice(0, 2000),
  };
}

function lineSegment(source: AgentReadSource, transcriptId: string, lineId: number) {
  for (const segment of source.transcripts.segments(transcriptId, lineId - 1)) {
    if (segment.id === lineId) return segment;
    if (segment.id > lineId) break;
  }
  return undefined;
}

/** Checks a whole submission and returns the proposals to store, or throws naming the field. */
export function prepareSubmission(
  source: AgentReadSource,
  input: SubmitInput,
  agent: { clientId: string; name: string },
  ids: { submission: string; proposal: () => string },
  now = new Date().toISOString(),
  stored = 0,
  limit = 2000,
): AgentProposal[] {
  const parsed = submitInput.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AgentReadError(`${issue.path.join('.') || 'input'}: ${issue.message}`);
  }
  const value = parsed.data;
  const recording = findRecording(source, value.recording_id);
  if (stored + value.proposals.length > limit)
    throw new AgentReadError(
      `"${recording.title}" already holds ${stored} proposals; at most ${limit} are kept per recording.`,
    );
  const current = currentTranscripts(source, recording.id);
  const pending = (source.proposals?.list(recording.id) || []).filter(
    (p) => proposalStatus(source.model.cueDecisions || [], p.id) === 'pending',
  );
  const result: AgentProposal[] = [];
  value.proposals.forEach((p, i) => {
    const at = `proposals[${i}]`;
    const kind = kinds[p.kind];
    if (p.time_seconds > recording.duration)
      throw new AgentReadError(
        `${at}.time_seconds: ${p.time_seconds} is past the end of "${recording.title}" (${round(recording.duration)} s).`,
      );
    if (kind === 'clip') {
      if (p.end_seconds === undefined)
        throw new AgentReadError(`${at}.end_seconds: a clip needs an end.`);
      if (p.end_seconds > recording.duration || p.end_seconds - p.time_seconds < 0.001)
        throw new AgentReadError(
          `${at}.end_seconds: the end must follow time_seconds within the recording.`,
        );
    } else if (p.end_seconds !== undefined) {
      if (kind !== 'mark')
        throw new AgentReadError(`${at}.end_seconds: only a clip or a range marker has an end.`);
      if (p.end_seconds > recording.duration || p.end_seconds - p.time_seconds < 0.001)
        throw new AgentReadError(
          `${at}.end_seconds: the end must follow time_seconds within the recording.`,
        );
    }
    const intents = [...new Set([...(p.intents || []), ...(p.intent ? [p.intent] : [])])];
    if (p.notion && !intents.includes('notion'))
      throw new AgentReadError(`${at}.notion: only a proposal with the notion intent has one.`);
    if (p.notion && p.notion.target !== 'new' && !p.notion.existing)
      throw new AgentReadError(
        `${at}.notion.existing: name the note it ${p.notion.target === 'expands' ? 'expands' : 'repeats'}.`,
      );
    let refines: AgentProposal['refines'];
    if (p.refines) {
      const mic = current.mic;
      if (!mic || mic.id !== p.refines.transcript_id)
        throw new AgentReadError(
          `${at}.refines.transcript_id: stale or unknown. The current mic transcript is ` +
            `${mic ? `"${mic.id}"` : 'missing'}; call get_transcript again.`,
        );
      const segment = lineSegment(source, mic.id, p.refines.line_id);
      const cue = segment && cueCandidate(mic, segment);
      if (!segment || !cue)
        throw new AgentReadError(
          `${at}.refines.line_id: line ${p.refines.line_id} holds no spoken cue.`,
        );
      const fits = cue.kind === 'clip-start' || cue.kind === 'clip-end' ? 'clip' : cue.kind;
      if (
        fits !== kind &&
        !(kind === 'note' && fits === 'mark') &&
        !(kind === 'mark' && fits === 'note')
      )
        throw new AgentReadError(
          `${at}.refines: line ${p.refines.line_id} is a ${cue.kind} cue; a ${p.kind} proposal cannot rework it.`,
        );
      if (
        [...pending, ...result].some(
          (q) => q.refines?.transcriptId === mic.id && q.refines.lineId === segment.id,
        )
      )
        throw new AgentReadError(
          `${at}.refines: another pending proposal already reworks that cue.`,
        );
      refines = {
        transcriptId: mic.id,
        track: mic.track,
        lineId: segment.id,
        kind: cue.kind,
        time: round(cue.time),
        text: segment.text.trim(),
      };
    }
    if (p.clip_names && kind !== 'cut')
      throw new AgentReadError(`${at}.clip_names: only a split names two clips.`);
    if (kind !== 'clip' && p.title.length > 100)
      throw new AgentReadError(`${at}.title: at most 100 characters except for clips.`);
    const evidence = p.evidence.map((e, j) => {
      const field = `${at}.evidence[${j}]`;
      const transcript = current[e.role];
      if (!transcript || transcript.id !== e.transcript_id)
        throw new AgentReadError(
          `${field}.transcript_id: stale or unknown. The current ${e.role} transcript is ` +
            `${transcript ? `"${transcript.id}"` : 'missing'}; call get_transcript again.`,
        );
      return {
        role: e.role,
        transcriptId: e.transcript_id,
        lineIds: [...new Set(e.line_ids)].sort((a, b) => a - b),
        ...lineQuote(source, e.transcript_id, e.line_ids, `${field}.line_ids`),
      };
    });
    const repeat = [...pending, ...result].find(
      (q) =>
        q.kind === kind &&
        Math.abs(q.time - p.time_seconds) < repeatWindow &&
        q.title.trim().toLowerCase() === p.title.trim().toLowerCase(),
    );
    if (repeat)
      throw new AgentReadError(
        `${at}: repeats ${result.includes(repeat) ? 'another proposal in this call' : `pending proposal "${repeat.id}"`}.`,
      );
    result.push({
      id: ids.proposal(),
      sourceId: recording.id,
      kind,
      time: p.time_seconds,
      ...(p.end_seconds !== undefined ? { end: p.end_seconds } : {}),
      title: p.title.trim(),
      text: (p.note || '').trim(),
      ...(p.clip_names
        ? { names: { first: p.clip_names.first.trim(), second: p.clip_names.second.trim() } }
        : {}),
      reason: p.reason.trim(),
      ...(intents.length ? { intent: intents[0], intents } : {}),
      ...(p.notion
        ? {
            notion: {
              target: p.notion.target,
              ...(p.notion.existing ? { existing: p.notion.existing.trim() } : {}),
            },
          }
        : {}),
      ...(refines ? { refines } : {}),
      evidence,
      agent: { ...agent, ...(value.agent_model ? { model: value.agent_model } : {}) },
      submitted: now,
      submissionId: ids.submission,
      projectRevision: source.revision,
    });
  });
  return result;
}

export function submissionAnswer(source: AgentReadSource, proposals: AgentProposal[]) {
  const recording = findRecording(source, proposals[0].sourceId);
  return {
    recording: { id: recording.id, title: recording.title },
    submitted: proposals.map((p) => ({
      id: p.id,
      kind: kindName[p.kind],
      ...(p.refines ? { reworks: `${p.refines.kind} cue at ${p.refines.time} s` } : {}),
      time: round(p.time),
      end: p.end === undefined ? undefined : round(p.end),
      title: p.title,
    })),
    next:
      'They wait on the cue cards in the transcript window until the user accepts or rejects ' +
      'them. Nothing in the project changed. Read the outcome with get_proposal_decisions.',
    projectRevision: source.revision,
  };
}

/** The user's decision on each proposal, as accepted, moved, retitled or rejected. */
export function proposalDecisions(source: AgentReadSource, input: DecisionsInput = {}) {
  const parsed = decisionsInput.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AgentReadError(`${issue.path.join('.') || 'input'}: ${issue.message}`);
  }
  const value = parsed.data;
  const recording = value.recording_id ? findRecording(source, value.recording_id) : undefined;
  const decisions = source.model.cueDecisions || [];
  const wanted = value.proposal_ids && new Set(value.proposal_ids);
  const all = (source.proposals?.list(recording?.id) || []).filter(
    (p) =>
      source.model.recordings.some((r) => r.id === p.sourceId) && (!wanted || wanted.has(p.id)),
  );
  const unknown = value.proposal_ids?.find((id) => !all.some((p) => p.id === id));
  if (unknown) throw new AgentReadError(`proposal_ids: no proposal "${unknown}".`);
  const mapped = all.map((p) => {
    const d = proposalDecision(decisions, p.id);
    const status = d?.status || 'pending';
    // A split's decision keeps the two clip names in title and text.
    const chosen =
      d?.status === 'accepted'
        ? {
            time: round(d.appliedTime ?? p.time),
            end: d.appliedEnd === undefined ? undefined : round(d.appliedEnd),
            ...(p.kind === 'cut'
              ? { clipNames: d.title ? { first: d.title, second: d.text ?? '' } : undefined }
              : { title: d.title, note: d.text }),
          }
        : undefined;
    return {
      id: p.id,
      recordingId: p.sourceId,
      kind: kindName[p.kind],
      proposed: {
        time: round(p.time),
        end: p.end === undefined ? undefined : round(p.end),
        title: p.title,
        note: p.text || undefined,
        clipNames: p.names,
      },
      intents: proposalIntents(p),
      ...(p.notion ? { notion: p.notion } : {}),
      ...(p.refines
        ? {
            refines: {
              lineId: p.refines.lineId,
              kind: p.refines.kind,
              time: p.refines.time,
              heard: p.refines.text,
            },
          }
        : {}),
      evidence: p.evidence.map((e) => ({ role: e.role, start: e.start, end: e.end })),
      agent: p.agent.name,
      submitted: p.submitted,
      status,
      decided: d?.decided,
      ...(chosen
        ? {
            chosen,
            movedSeconds: round(chosen.time - p.time),
            ...(p.end !== undefined && chosen.end !== undefined
              ? { endMovedSeconds: round(chosen.end - p.end) }
              : {}),
            ...(p.kind === 'cut'
              ? {
                  renamed:
                    JSON.stringify(d!.title ? [d!.title, d!.text ?? ''] : null) !==
                    JSON.stringify(p.names ? [p.names.first, p.names.second] : null),
                }
              : {
                  retitled: d!.title !== p.title,
                  noteEdited: (d!.text ?? '') !== p.text,
                }),
          }
        : {}),
    };
  });
  const rows = mapped.filter((r) =>
    !value.status
      ? true
      : value.status === 'decided'
        ? r.status !== 'pending'
        : r.status === value.status,
  );
  const count = (s: string) => mapped.filter((r) => r.status === s).length;
  return {
    recording: recording && { id: recording.id, title: recording.title },
    counts: { pending: count('pending'), accepted: count('accepted'), rejected: count('rejected') },
    // The newest 200; older ones remain readable through proposal_ids.
    proposals: rows.slice(-200),
    projectRevision: source.revision,
  };
}
