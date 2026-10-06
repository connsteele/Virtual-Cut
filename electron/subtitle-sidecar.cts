import { createHash } from 'node:crypto';
import { link, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExportRecord, SubtitleRole, SubtitleSidecars } from './export-contracts.js' with {
  'resolution-mode': 'import',
};
import type { TranscriptSegment, TranscriptSummary } from './transcript-contracts.js' with {
  'resolution-mode': 'import',
};
import type { Model } from './workflow-types.js' with { 'resolution-mode': 'import' };
import { transcriptHandoff, transcriptSrt } from './transcript-export.js';
import type { TranscriptScope } from './transcript-export.js';

export const subtitleRoles: readonly SubtitleRole[] = ['game', 'mic'];
const label = { game: 'Game dialogue', mic: 'Microphone' } as const;

export function subtitleRequest(value: unknown): SubtitleRole[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((r) => !subtitleRoles.includes(r as SubtitleRole)))
    throw new Error('Choose game dialogue or microphone subtitles.');
  return subtitleRoles.filter((r) => value.includes(r));
}

/**
 * Game dialogue takes the video's own name, so players and Resolve pick it up as the subtitle
 * track; microphone notes get `.mic.srt` so they are never mistaken for dialogue.
 */
export function subtitleFile(output: string, role: SubtitleRole) {
  const base = output.slice(0, output.length - path.extname(output).length);
  return `${base}${role === 'mic' ? '.mic' : ''}.srt`;
}

export interface SubtitleSource {
  transcript: TranscriptSummary;
  segments: Iterable<TranscriptSegment>;
  model: Pick<Model, 'transcriptEdits'>;
}

/**
 * Writes the requested SRT files beside a verified export, cut to the range the video actually
 * holds. Never replaces a file: an identical one from an earlier attempt counts as written, any
 * other is reported and left alone. A failure here never undoes the verified video.
 */
export async function writeSubtitleSidecars(
  record: ExportRecord,
  find: (role: SubtitleRole) => SubtitleSource | undefined,
): Promise<SubtitleSidecars> {
  const result: SubtitleSidecars = {
    requested: record.subtitles?.requested || [],
    written: [],
    skipped: [],
  };
  const output = record.output,
    verified = record.verification;
  if (!result.requested.length) return result;
  if (!output || !verified) {
    result.skipped.push('Subtitles need a verified video.');
    return result;
  }
  const scope: TranscriptScope = {
    ...verified.actual,
    sourceStart: record.input.sourceStart,
    timestampShift: verified.timestampShift,
    exportId: record.plan.id,
    output,
    name: record.plan.name,
  };
  for (const role of result.requested) {
    const file = subtitleFile(output, role);
    try {
      const source = find(role);
      if (!source) {
        result.skipped.push(`${label[role]}: no finished transcript for this recording.`);
        continue;
      }
      const body = transcriptSrt(
        transcriptHandoff(source.transcript, source.segments, source.model, scope),
      );
      if (!body.trim()) {
        result.skipped.push(`${label[role]}: no speech in this clip.`);
        continue;
      }
      const existing = await readFile(file, 'utf8').catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return undefined;
        throw e;
      });
      if (existing !== undefined && existing !== body) {
        result.skipped.push(
          `${label[role]}: ${path.basename(file)} already exists and was not replaced.`,
        );
        continue;
      }
      if (existing === undefined) {
        // Stage, then hard-link: the name only ever appears complete, and never over a file.
        const stage = path.join(path.dirname(file), `.vcut-${record.plan.id}-${role}.srt`);
        await unlink(stage).catch(() => {});
        await writeFile(stage, body, { encoding: 'utf8', flag: 'wx' });
        try {
          await link(stage, file);
        } finally {
          await unlink(stage).catch(() => {});
        }
      }
      result.written.push({
        role,
        transcriptId: source.transcript.id,
        file,
        sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
      });
    } catch (e) {
      result.skipped.push(
        `${label[role]}: ${path.basename(file)} could not be written (${e instanceof Error ? e.message : String(e)}).`,
      );
    }
  }
  return result;
}
