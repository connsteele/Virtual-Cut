import * as z from 'zod';
import {
  AgentReadError,
  currentTranscripts,
  findRecording,
  type AgentReadSource,
} from './agent-tools.js';
import { proposalEvidence } from './agent-proposals.js';
import { answerFields, proposalStatus } from './proposal-edits.js';
import type {
  AgentProposal,
  EditFields,
  ProposalEdit,
  ProposalValues,
} from './proposal-contracts.js';
import {
  clipColors,
  markerColorName,
  markerColors,
  type ClipColor,
  type MarkerColor,
  type Model,
} from './workflow-types.js';

/**
 * Change proposals and amends over MCP (VC-204). `propose_changes` proposes edits to markers and
 * clips already in the project: each lands as a card showing before and after, and nothing changes
 * until the user accepts it. `amend_proposal` lets an agent revise its own card still waiting for
 * review in place, keeping every earlier version, instead of withdrawing it and proposing again.
 */
const evidenceInput = z
  .array(
    z.object({
      role: z.enum(['mic', 'game']),
      transcript_id: z.string().max(200).describe('transcriptId from get_transcript.'),
      line_ids: z.array(z.number().int().min(0)).min(1).max(50),
    }),
  )
  .max(10)
  .default([])
  .describe('The transcript lines this change rests on.');
const markerColorInput = z.enum(Object.keys(markerColors) as [MarkerColor, ...MarkerColor[]]);
const clipColorInput = z.enum(Object.keys(clipColors) as [ClipColor, ...ClipColor[]]);
export const changeInput = z.object({
  marker_id: z.string().max(200).optional().describe('The marker to change (get_annotations).'),
  clip_id: z.string().max(200).optional().describe('The clip to change (get_annotations).'),
  title: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('New name: up to 100 characters for a marker, 200 for a clip.'),
  time_seconds: z
    .number()
    .min(0)
    .optional()
    .describe("New position: a marker's time, a clip's start."),
  end_seconds: z
    .number()
    .positive()
    .nullable()
    .optional()
    .describe(
      "New end: a clip's end (trim), or a marker's range end. null turns a range marker into a point marker.",
    ),
  color: markerColorInput
    .optional()
    .describe("Markers only: the new marker color, one of Resolve's 16 marker colors."),
  clip_color: clipColorInput
    .nullable()
    .optional()
    .describe(
      'Clips only: the new Resolve clip color (Orange, Apricot, Yellow, Lime, Olive, Green, Teal, Navy, Blue, Purple, Violet, Pink, Tan, Beige, Brown, Chocolate), or null to clear it.',
    ),
  note: z.string().max(10000).optional().describe('New marker note or clip note.'),
  reason: z
    .string()
    .min(1)
    .max(2000)
    .describe('Why you propose this change, shown to the user on the card.'),
  evidence: evidenceInput,
});
export const changesInput = z.object({
  recording_id: z.string().max(200),
  changes: z.array(changeInput).min(1).max(50),
  agent_model: z.string().max(100).optional().describe('Your model name, kept as provenance.'),
  run_intent: z
    .string()
    .max(200)
    .optional()
    .describe(
      "What this pass is for, such as 'apply the new color key'; kept in the batch record.",
    ),
});
export const amendInput = z.object({
  proposal_id: z
    .string()
    .max(200)
    .describe(
      'Your own proposal still waiting for review, from submit_proposals or propose_changes.',
    ),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .optional()
    .describe(
      "Why you amend it, such as 'the creator's color key says squad moments are Green'; shown with this version.",
    ),
  title: z.string().min(1).max(200).optional().describe('New title or name.'),
  note: z.string().max(10000).optional().describe('New note.'),
  time_seconds: z.number().min(0).optional().describe('New position or start.'),
  end_seconds: z
    .number()
    .positive()
    .nullable()
    .optional()
    .describe('New end; null removes a marker range end.'),
  color: markerColorInput.optional().describe('New marker color.'),
  clip_color: clipColorInput
    .nullable()
    .optional()
    .describe('New Resolve clip color for a clip range or a clip change; null for none.'),
  clip_names: z
    .object({ first: z.string().min(1).max(200), second: z.string().min(1).max(200) })
    .optional()
    .describe('Splits only: new names for the clips before and after the split.'),
});
export type ChangesInput = z.input<typeof changesInput>;
export type AmendInput = z.input<typeof amendInput>;

const round = (n: number) => Math.round(n * 1000) / 1000;
const parse = <T extends z.ZodType>(schema: T, input: unknown): z.output<T> => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AgentReadError(`${issue.path.join('.') || 'input'}: ${issue.message}`);
  }
  return parsed.data;
};

/** A marker's or clip's current values, in the fields a change card compares. */
export function targetValues(
  model: Model,
  recordingId: string,
  target: ProposalEdit['target'],
  id: string,
): Required<Pick<EditFields, 'name' | 'time' | 'note'>> & EditFields {
  if (target === 'marker') {
    const m = (model.markers[recordingId] || []).find((x) => x.id === id);
    if (!m) throw new AgentReadError(`marker_id: no marker "${id}" in this recording.`);
    return {
      name: m.name,
      time: m.time,
      end: m.end ?? null,
      color: markerColorName(m),
      note: m.note || '',
    };
  }
  const c = model.clips.find((x) => x.id === id && x.rid === recordingId);
  if (!c) throw new AgentReadError(`clip_id: no clip "${id}" in this recording.`);
  return { name: c.name, time: c.start, end: c.end, color: c.color ?? null, note: c.note || '' };
}

/**
 * Checks proposed values for a marker or clip and returns the fields that differ from `now`, or
 * throws naming the field. `duration` bounds the times.
 */
function editSet(
  target: ProposalEdit['target'],
  now: EditFields,
  wanted: {
    title?: string;
    time_seconds?: number;
    end_seconds?: number | null;
    color?: MarkerColor;
    clip_color?: ClipColor | null;
    note?: string;
  },
  duration: number,
  at: string,
): EditFields {
  if (target === 'marker' && wanted.clip_color !== undefined)
    throw new AgentReadError(`${at}.clip_color: a marker has a marker color; use color.`);
  if (target === 'clip' && wanted.color !== undefined)
    throw new AgentReadError(`${at}.color: a clip has a Resolve clip color; use clip_color.`);
  if (target === 'clip' && wanted.end_seconds === null)
    throw new AgentReadError(`${at}.end_seconds: a clip always has an end.`);
  const name = wanted.title?.trim();
  if (name !== undefined && target === 'marker' && name.length > 100)
    throw new AgentReadError(`${at}.title: at most 100 characters for a marker.`);
  const time = wanted.time_seconds ?? now.time!;
  const end = wanted.end_seconds === undefined ? now.end : wanted.end_seconds;
  if (time > duration)
    throw new AgentReadError(`${at}.time_seconds: ${time} is past the end of the recording.`);
  if (end != null && (end > duration || end - time < 0.001))
    throw new AgentReadError(
      `${at}.end_seconds: the end must follow the start within the recording.`,
    );
  const next: EditFields = {
    ...(name !== undefined ? { name } : {}),
    ...(wanted.time_seconds !== undefined ? { time: wanted.time_seconds } : {}),
    ...(wanted.end_seconds !== undefined ? { end: wanted.end_seconds } : {}),
    ...(wanted.color !== undefined ? { color: wanted.color } : {}),
    ...(wanted.clip_color !== undefined ? { color: wanted.clip_color } : {}),
    ...(wanted.note !== undefined ? { note: wanted.note.trim() } : {}),
  };
  // Only what actually changes is proposed; the rest stays out of the card.
  const set: EditFields = {};
  for (const [k, v] of Object.entries(next) as [keyof EditFields, EditFields[keyof EditFields]][])
    if (!sameValue(v, now[k])) Object.assign(set, { [k]: v });
  return set;
}
const sameValue = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) < 0.0005
    : (a ?? null) === (b ?? null);

/** Pending proposals for a recording: not decided and not withdrawn. */
function pendingOf(source: AgentReadSource, recordingId: string) {
  return (source.proposals?.list(recordingId) || []).filter(
    (p) => !p.withdrawn && proposalStatus(source.model.cueDecisions || [], p.id) === 'pending',
  );
}

/** Checks a `propose_changes` call and returns the change proposals to store. */
export function prepareChanges(
  source: AgentReadSource,
  input: ChangesInput,
  agent: { clientId: string; name: string },
  ids: { submission: string; proposal: () => string },
  now = new Date().toISOString(),
  stored = 0,
  limit = 2000,
): AgentProposal[] {
  const value = parse(changesInput, input);
  const recording = findRecording(source, value.recording_id);
  if (stored + value.changes.length > limit)
    throw new AgentReadError(
      `"${recording.title}" already holds ${stored} proposals; at most ${limit} are kept per recording.`,
    );
  const current = currentTranscripts(source, recording.id);
  const pending = pendingOf(source, recording.id);
  const result: AgentProposal[] = [];
  value.changes.forEach((c, i) => {
    const at = `changes[${i}]`;
    if ((c.marker_id == null) === (c.clip_id == null))
      throw new AgentReadError(`${at}: name exactly one of marker_id or clip_id.`);
    const target: ProposalEdit['target'] = c.marker_id != null ? 'marker' : 'clip';
    const targetId = (c.marker_id ?? c.clip_id)!;
    let nowValues: EditFields;
    try {
      nowValues = targetValues(source.model, recording.id, target, targetId);
    } catch (e) {
      throw new AgentReadError(`${at}.${(e as Error).message}`);
    }
    const set = editSet(target, nowValues, c, recording.duration, at);
    if (!Object.keys(set).length)
      throw new AgentReadError(`${at}: changes nothing; the ${target} already has those values.`);
    const clash = [...pending, ...result].find(
      (p) => p.edit?.target === target && p.edit.targetId === targetId,
    );
    if (clash)
      throw new AgentReadError(
        `${at}: ${result.includes(clash) ? 'another change in this call' : `pending change "${clash.id}"`} already targets this ${target}; amend it with amend_proposal instead.`,
      );
    const seen = Object.fromEntries(
      Object.keys(set).map((k) => [k, nowValues[k as keyof EditFields]]),
    ) as EditFields;
    const after = { ...nowValues, ...set };
    result.push({
      id: ids.proposal(),
      sourceId: recording.id,
      kind: 'edit',
      time: after.time!,
      ...(after.end != null ? { end: after.end } : {}),
      title: after.name!,
      text: after.note ?? '',
      reason: c.reason.trim(),
      edit: { target, targetId, seen, set },
      evidence: proposalEvidence(source, current, c.evidence, at),
      agent: { ...agent, ...(value.agent_model ? { model: value.agent_model } : {}) },
      submitted: now,
      submissionId: ids.submission,
      projectRevision: source.revision,
    });
  });
  return result;
}

/** A proposal's own values, as a version keeps them. */
export function proposalValues(p: AgentProposal): ProposalValues {
  return {
    time: p.time,
    ...(p.end !== undefined ? { end: p.end } : {}),
    title: p.title,
    text: p.text,
    ...(p.names ? { names: p.names } : {}),
    ...(p.color ? { color: p.color } : {}),
    ...(p.clipColor ? { clipColor: p.clipColor } : {}),
    ...(p.edit ? { edit: structuredClone(p.edit) } : {}),
    reason: p.reason,
  };
}

/**
 * Checks an amend: the proposal must be this app's own and still waiting for the user. Returns the
 * proposal as amended, its earlier version appended to `versions`, or throws naming the field.
 */
export function prepareAmend(
  source: AgentReadSource,
  input: AmendInput,
  clientId: string,
  now = new Date().toISOString(),
): AgentProposal {
  const value = parse(amendInput, input);
  const p = (source.proposals?.list(undefined, { withdrawn: true }) || []).find(
    (x) => x.id === value.proposal_id && source.model.recordings.some((r) => r.id === x.sourceId),
  );
  if (!p) throw new AgentReadError(`proposal_id: no proposal "${value.proposal_id}".`);
  if (p.agent.clientId !== clientId)
    throw new AgentReadError(
      `proposal_id: "${p.id}" came from ${p.agent.name}, another paired app; only the app that proposed it can amend it.`,
    );
  const status = proposalStatus(source.model.cueDecisions || [], p.id);
  if (status !== 'pending')
    throw new AgentReadError(
      `proposal_id: the user already ${status} "${p.id}"; decided proposals stay as they are. Propose a change to what accepting made with propose_changes.`,
    );
  if (p.withdrawn)
    throw new AgentReadError(`proposal_id: "${p.id}" is withdrawn; propose it again instead.`);
  const recording = findRecording(source, p.sourceId);
  const next: AgentProposal = structuredClone(p);
  if (p.kind === 'edit') {
    const edit = p.edit!;
    let nowValues: EditFields;
    try {
      nowValues = targetValues(source.model, recording.id, edit.target, edit.targetId);
    } catch {
      throw new AgentReadError(
        `proposal_id: the ${edit.target} "${p.id}" changes is gone; withdraw this change instead.`,
      );
    }
    if (value.clip_names) throw new AgentReadError('clip_names: only a split names two clips.');
    if (edit.target === 'clip' && value.color)
      throw new AgentReadError('color: a clip has a Resolve clip color; use clip_color.');
    if (edit.target === 'marker' && value.clip_color !== undefined)
      throw new AgentReadError('clip_color: a marker has a marker color; use color.');
    // The amend applies on top of the card's proposed values, compared with the target as it is.
    const proposed = { ...nowValues, ...edit.set };
    const set = editSet(
      edit.target,
      nowValues,
      {
        title: value.title ?? proposed.name,
        time_seconds: value.time_seconds ?? proposed.time,
        end_seconds: value.end_seconds !== undefined ? value.end_seconds : proposed.end,
        ...(edit.target === 'marker'
          ? { color: (value.color ?? proposed.color) as MarkerColor }
          : {
              clip_color: (value.clip_color !== undefined
                ? value.clip_color
                : proposed.color) as ClipColor | null,
            }),
        note: value.note ?? proposed.note,
      },
      recording.duration,
      'amend',
    );
    if (!Object.keys(set).length)
      throw new AgentReadError(
        `amend: the ${edit.target} already has those values; withdraw this change instead.`,
      );
    const seen = Object.fromEntries(
      Object.keys(set).map((k) => [
        k,
        k in edit.seen ? edit.seen[k as keyof EditFields] : nowValues[k as keyof EditFields],
      ]),
    ) as EditFields;
    const after = { ...nowValues, ...set };
    next.edit = { ...edit, seen, set };
    next.time = after.time!;
    if (after.end != null) next.end = after.end;
    else delete next.end;
    next.title = after.name!;
    next.text = after.note ?? '';
  } else {
    if (value.clip_color !== undefined && p.kind !== 'clip')
      throw new AgentReadError('clip_color: only a clip range has a clip color.');
    if (value.color && p.kind !== 'mark' && p.kind !== 'clip')
      throw new AgentReadError('color: only a marker or a clip range has a color.');
    if (value.clip_names && p.kind !== 'cut')
      throw new AgentReadError('clip_names: only a split names two clips.');
    if (value.end_seconds != null && p.kind !== 'mark' && p.kind !== 'clip')
      throw new AgentReadError('end_seconds: only a clip or a range marker has an end.');
    if (value.end_seconds === null && p.kind === 'clip')
      throw new AgentReadError('end_seconds: a clip range always has an end.');
    const title = value.title?.trim() ?? p.title;
    if (p.kind !== 'clip' && title.length > 100)
      throw new AgentReadError('title: at most 100 characters except for clips.');
    const time = value.time_seconds ?? p.time;
    const end = value.end_seconds === undefined ? p.end : (value.end_seconds ?? undefined);
    if (time > recording.duration)
      throw new AgentReadError(`time_seconds: ${time} is past the end of "${recording.title}".`);
    if (end !== undefined && (end > recording.duration || end - time < 0.001))
      throw new AgentReadError('end_seconds: the end must follow the start within the recording.');
    next.time = time;
    if (end !== undefined) next.end = end;
    else delete next.end;
    next.title = title;
    if (value.note !== undefined) next.text = value.note.trim();
    if (value.color) next.color = value.color;
    if (value.clip_color !== undefined) {
      if (value.clip_color) next.clipColor = value.clip_color;
      else delete next.clipColor;
    }
    if (value.clip_names)
      next.names = { first: value.clip_names.first.trim(), second: value.clip_names.second.trim() };
  }
  const before = JSON.stringify(proposalValues({ ...p, reason: '' }));
  if (JSON.stringify(proposalValues({ ...next, reason: '' })) === before)
    throw new AgentReadError('amend: changes nothing on the card.');
  next.versions = [
    ...(p.versions || []),
    {
      at: p.amended?.at ?? p.submitted,
      ...(p.amended?.reason ? { reason: p.amended.reason } : {}),
      values: proposalValues(p),
    },
  ];
  next.amended = { at: now, ...(value.reason ? { reason: value.reason } : {}) };
  return next;
}

export function changesAnswer(source: AgentReadSource, proposals: AgentProposal[]) {
  const recording = findRecording(source, proposals[0].sourceId);
  return {
    recording: { id: recording.id, title: recording.title },
    proposed: proposals.map((p) => ({
      id: p.id,
      [p.edit!.target === 'marker' ? 'markerId' : 'clipId']: p.edit!.targetId,
      before: answerFields(p.edit!.target, p.edit!.seen),
      after: answerFields(p.edit!.target, p.edit!.set),
    })),
    next:
      'Each waits on a card in the transcript window showing before and after. Nothing changed ' +
      'yet. Tweak a card with amend_proposal; read the outcome with get_proposal_decisions.',
    projectRevision: source.revision,
  };
}

export function amendAnswer(source: AgentReadSource, p: AgentProposal) {
  return {
    id: p.id,
    version: (p.versions?.length ?? 0) + 1,
    time: round(p.time),
    end: p.end === undefined ? undefined : round(p.end),
    title: p.title,
    ...(p.edit ? { after: answerFields(p.edit.target, p.edit.set) } : {}),
    next:
      'The card changed in place and shows it was amended; every earlier version is kept. The ' +
      'user still decides the card once.',
    projectRevision: source.revision,
  };
}
