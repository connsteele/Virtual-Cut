import { createHash } from 'node:crypto';
import { effectiveContext, defaultContext } from './project-context.js';
import { correctedText } from './transcript-edits.js';
import type { Model, Recording } from './workflow-types.js';
import type { Batch } from './project-contracts.js';
import type { TranscriptSegment, TranscriptSummary } from './transcript-contracts.js';
import type { AgentView } from './agent-contracts.js';

/**
 * Read-only answers for agent apps (VC-160). Every function takes a live project
 * view and returns plain data: no file paths, media URLs, media bytes or writes.
 */
export interface AgentReadSource {
  project: { id: string; name: string };
  batches: Batch[];
  activeBatchId: string;
  revision: number;
  model: Model;
  /** Current source fingerprints; transcripts of a changed file are stale. */
  fingerprints: Record<string, string>;
  transcripts: {
    list(): TranscriptSummary[];
    segments(id: string, after?: number): Iterable<TranscriptSegment>;
  };
  view?: AgentView;
}
export class AgentReadError extends Error {}
/** A recording or batch named for the activity list; ids an agent made up stay as given. */
export function readableName(source: AgentReadSource | undefined, id: string) {
  return (
    source?.model.recordings.find((r) => r.id === id)?.title ||
    source?.batches.find((b) => b.id === id)?.name ||
    id
  );
}

const pageSize = 100;
const round = (n: number) => Math.round(n * 1000) / 1000;

function recordingsIn(source: AgentReadSource, batchId?: string) {
  return source.model.recordings.filter(
    (r) => !r.sample && !r.retained && (!batchId || r.batchIds?.includes(batchId)),
  );
}
function findBatch(source: AgentReadSource, batchId?: string) {
  const id = batchId || source.activeBatchId;
  const batch = source.batches.find((b) => b.id === id);
  if (!batch) throw new AgentReadError(`No batch with id "${id}". Call get_project_summary.`);
  return batch;
}
function findRecording(source: AgentReadSource, id: string) {
  const recording = recordingsIn(source).find((r) => r.id === id);
  if (!recording)
    throw new AgentReadError(`No recording with id "${id}". Call get_project_summary.`);
  return recording;
}
/** The newest finished transcript of the recording's current file, per role. */
function currentTranscripts(source: AgentReadSource, recordingId: string) {
  const result: Partial<Record<'mic' | 'game', TranscriptSummary>> = {};
  for (const t of source.transcripts.list())
    if (
      t.sourceId === recordingId &&
      t.state === 'complete' &&
      t.fingerprint === source.fingerprints[recordingId] &&
      !result[t.role]
    )
      result[t.role] = t;
  return result;
}
function recordingSummary(source: AgentReadSource, r: Recording) {
  return {
    id: r.id,
    title: r.title,
    durationSeconds: round(r.duration),
    captured: r.captureTime,
    availability: r.availability || 'ready',
    transcripts: Object.keys(currentTranscripts(source, r.id)),
  };
}
function clipSummary(source: AgentReadSource, clipId: string) {
  const c = source.model.clips.find((x) => x.id === clipId);
  return c
    ? {
        id: c.id,
        name: c.name,
        recordingId: c.rid,
        start: round(c.start),
        end: round(c.end),
      }
    : undefined;
}

export function currentView(source: AgentReadSource) {
  const view = source.view?.projectId === source.project.id ? source.view : undefined;
  const recordingId = view?.recordingId || source.model.selectedRecordingId;
  const recording = recordingsIn(source).find((r) => r.id === recordingId);
  const batch = source.batches.find((b) => b.id === source.activeBatchId);
  const marker =
    view?.markerId && recording
      ? source.model.markers[recording.id]?.find((m) => m.id === view.markerId)
      : undefined;
  return {
    project: source.project,
    page: view?.page,
    batch: batch && { id: batch.id, name: batch.name },
    recording: recording && { id: recording.id, title: recording.title },
    playheadSeconds:
      recording && round(view?.playhead ?? recording.position ?? recording.base ?? 0),
    selection: marker
      ? { kind: 'marker', id: marker.id, name: marker.name, time: round(marker.time) }
      : view?.clipId && clipSummary(source, view.clipId)
        ? { kind: 'clip', ...clipSummary(source, view.clipId)! }
        : null,
    projectRevision: source.revision,
  };
}

export function projectSummary(source: AgentReadSource, batchId?: string) {
  if (!batchId)
    return {
      project: source.project,
      activeBatchId: source.activeBatchId,
      batches: source.batches.map((b) => {
        const recordings = recordingsIn(source, b.id),
          context = effectiveContext(source.model.contexts, b.id);
        return {
          id: b.id,
          name: b.name,
          created: b.created,
          game: context.game?.name,
          brief: context.brief,
          recordings: recordings.length,
          clips: source.model.clips.filter((c) => recordings.some((r) => r.id === c.rid)).length,
        };
      }),
      projectRevision: source.revision,
    };
  const batch = findBatch(source, batchId),
    recordings = recordingsIn(source, batch.id),
    context = effectiveContext(source.model.contexts, batch.id);
  return {
    project: source.project,
    batch: { id: batch.id, name: batch.name, created: batch.created },
    game: context.game?.name,
    brief: context.brief,
    recordings: recordings.map((r) => recordingSummary(source, r)),
    clips: source.model.clips
      .filter((c) => recordings.some((r) => r.id === c.rid))
      .map((c) => ({
        ...clipSummary(source, c.id)!,
        folder: c.folder,
        accepted: !!c.accepted,
        note: c.note || undefined,
      })),
    projectRevision: source.revision,
  };
}

/** VC-54's packet, as far as Virtual Cut holds it today: game, terms, brief and what's marked. */
export function contextPacket(source: AgentReadSource, batchId?: string) {
  const batch = findBatch(source, batchId),
    contexts = source.model.contexts || [],
    project = contexts.find((c) => c.id === 'project') || defaultContext('project'),
    own = contexts.find((c) => c.id === batch.id) || defaultContext(batch.id),
    effective = effectiveContext(contexts, batch.id),
    recordings = recordingsIn(source, batch.id);
  const packet = {
    batch: { id: batch.id, name: batch.name },
    game: effective.game
      ? {
          name: effective.game.name,
          vocabulary: effective.game.vocabulary
            .split(/[,\n]/)
            .map((t) => t.trim())
            .filter(Boolean),
          from: own.gameMode === 'inherit' ? 'project' : 'batch',
        }
      : null,
    brief: {
      text: effective.brief,
      how: own.briefMode,
      projectBrief: project.briefMode === 'none' ? '' : project.brief,
    },
    glossary: source.model.terms.map((t) => ({
      name: t.name,
      kind: t.kind,
      aliases: t.aliases,
      definition: t.definition,
    })),
    alreadyMarked: recordings.map((r) => ({
      recordingId: r.id,
      title: r.title,
      markers: (source.model.markers[r.id] || []).length,
      clips: source.model.clips.filter((c) => c.rid === r.id).length,
      notes: source.model.notes.filter((n) => n.sourceId === r.id).length,
      transcripts: Object.keys(currentTranscripts(source, r.id)),
    })),
  };
  return {
    ...packet,
    contextRevision: createHash('sha256')
      .update(JSON.stringify([packet.game, packet.brief, packet.glossary]))
      .digest('hex')
      .slice(0, 16),
    projectRevision: source.revision,
  };
}

export function transcriptLines(
  source: AgentReadSource,
  input: {
    recordingId: string;
    role: 'mic' | 'game';
    start?: number;
    end?: number;
    cursor?: string;
  },
) {
  const recording = findRecording(source, input.recordingId);
  const transcript = currentTranscripts(source, recording.id)[input.role];
  if (!transcript)
    throw new AgentReadError(
      `"${recording.title}" has no finished ${input.role} transcript for its current file.`,
    );
  const start = input.start ?? 0,
    end = input.end ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(start) || start < 0 || !(end > start))
    throw new AgentReadError('Give start and end in seconds, with end after start.');
  let after = -1;
  if (input.cursor !== undefined) {
    after = Number(input.cursor);
    if (!Number.isInteger(after) || after < 0) throw new AgentReadError('Invalid cursor.');
  }
  const lines = [];
  let nextCursor: string | undefined;
  for (const segment of source.transcripts.segments(transcript.id, after)) {
    if (segment.end <= start) continue;
    if (segment.start >= end) break;
    if (lines.length === pageSize) {
      nextCursor = String(lines.at(-1)!.id);
      break;
    }
    const text = correctedText(source.model, transcript.id, segment).trim();
    lines.push({
      id: segment.id,
      start: round(segment.start),
      end: round(segment.end),
      text,
      ...(text !== segment.text.trim() ? { recognized: segment.text.trim() } : {}),
    });
  }
  return {
    recording: { id: recording.id, title: recording.title },
    role: input.role,
    transcriptId: transcript.id,
    language: transcript.language,
    lines,
    nextCursor,
    projectRevision: source.revision,
  };
}

export function annotations(source: AgentReadSource, batchId?: string, recordingId?: string) {
  const one = recordingId ? findRecording(source, recordingId) : undefined;
  // A recording answers for the batch it belongs to: the one asked for, else the active batch
  // if it holds the recording, else the recording's own batch.
  const batch = findBatch(
    source,
    batchId ||
      (one && !one.batchIds?.includes(source.activeBatchId) ? one.batchIds?.[0] : undefined),
  );
  if (one && !one.batchIds?.includes(batch.id))
    throw new AgentReadError(
      `"${one.title}" is not in the batch "${batch.name}". Leave batch_id out, or use the recording's own batch from get_project_summary.`,
    );
  const recordings = one ? [one] : recordingsIn(source, batch.id);
  const ids = new Set(recordings.map((r) => r.id));
  return {
    batch: { id: batch.id, name: batch.name },
    recordings: recordings.map((r) => ({
      id: r.id,
      title: r.title,
      markers: (source.model.markers[r.id] || []).map((m) => ({
        id: m.id,
        time: round(m.time),
        end: m.end === undefined ? undefined : round(m.end),
        name: m.name,
        color: m.color,
        note: m.note || undefined,
      })),
    })),
    clips: source.model.clips
      .filter((c) => ids.has(c.rid))
      .map((c) => ({
        ...clipSummary(source, c.id)!,
        folder: c.folder,
        accepted: !!c.accepted,
        held: !!c.held,
        note: c.note || undefined,
      })),
    notes: source.model.notes
      .filter((n) => n.sourceId && ids.has(n.sourceId))
      .map((n) => ({
        id: n.id,
        recordingId: n.sourceId,
        time: n.time === undefined ? undefined : round(n.time),
        title: n.title,
        text: n.text,
      })),
    cueDecisions: (source.model.cueDecisions || [])
      .filter((d) => d.sourceId && ids.has(d.sourceId))
      .map((d) => ({
        id: d.id,
        recordingId: d.sourceId,
        kind: d.kind,
        time: d.time === undefined ? undefined : round(d.time),
        title: d.title,
        status: d.status,
      })),
    projectRevision: source.revision,
  };
}
