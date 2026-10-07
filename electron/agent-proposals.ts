import * as z from 'zod';
import {
  AgentReadError,
  currentTranscripts,
  findRecording,
  type AgentReadSource,
} from './agent-tools.js';
import { correctedText } from './transcript-edits.js';
import { proposalDecision, proposalStatus } from './proposal-edits.js';
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
      'marker: a point marker with a note. note: a timed note. split: split the clip at this time. clip: a clip range from time_seconds to end_seconds.',
    ),
  time_seconds: z.number().min(0).describe('Position in the recording, in seconds.'),
  end_seconds: z.number().positive().optional().describe('Clip end; only for kind "clip".'),
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
    .describe(
      "The user's intent tag for the speech behind it: marker, general (context or naming), notion (a note for Notion) or edit (an editing instruction).",
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
    } else if (p.end_seconds !== undefined)
      throw new AgentReadError(`${at}.end_seconds: only a clip has an end.`);
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
      ...(kind === 'clip' ? { end: p.end_seconds } : {}),
      title: p.title.trim(),
      text: (p.note || '').trim(),
      ...(p.clip_names
        ? { names: { first: p.clip_names.first.trim(), second: p.clip_names.second.trim() } }
        : {}),
      reason: p.reason.trim(),
      ...(p.intent ? { intent: p.intent } : {}),
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
      intent: p.intent,
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
