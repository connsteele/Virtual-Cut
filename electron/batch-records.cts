import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  addSubmission,
  batchOf,
  batchRecordVersion,
  finalState,
  type BatchRecord,
  type RecordRun,
} from './batch-record.js';
import { intentGuideVersion } from './intent-guide.js';
import type { ProjectStore } from './project-store.cjs';
import type { AgentProposal } from './proposal-contracts.js' with { 'resolution-mode': 'import' };

/**
 * Batch records on disk (VC-182): `<profile>/batch-records/<project>/<batch>.json`, in per-user
 * data beside the profile's other files, never inside the project or its Undo. Writing one never
 * fails what triggered it: a record that cannot be saved is logged and the export goes on.
 */
export class BatchRecords {
  log?: (event: string, details?: Record<string, unknown>) => void;
  constructor(private profile: string) {}
  file(projectId: string, batchId: string) {
    const safe = (id: string) =>
      /^[\w-]{1,80}$/.test(id) ? id : createHash('sha256').update(id).digest('hex').slice(0, 32);
    return path.join(this.profile, 'batch-records', safe(projectId), `${safe(batchId)}.json`);
  }
  read(projectId: string, batchId: string): BatchRecord | undefined {
    try {
      const record = JSON.parse(readFileSync(this.file(projectId, batchId), 'utf8'));
      return record?.recordVersion === batchRecordVersion ? record : undefined;
    } catch {
      return undefined;
    }
  }
  private write(record: BatchRecord) {
    const file = this.file(record.project.id, record.batch.id),
      temporary = `${file}.tmp`;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(temporary, JSON.stringify(record));
    renameSync(temporary, file);
  }
  private guard(kind: string, run: () => void) {
    try {
      run();
    } catch (e) {
      this.log?.('operation-failed', { kind, errorCode: (e as NodeJS.ErrnoException).code });
    }
  }
  /** An agent's proposals landed: add the run, and freeze the first pass if it is one. */
  submitted(
    store: ProjectStore,
    proposals: AgentProposal[],
    read: { runIntent?: string; transcripts: RecordRun['read']['transcripts'] },
  ) {
    if (!proposals.length) return;
    this.guard('batch-record', () => {
      const { project, model, batches, activeBatchId, revision } = store.data;
      const batch = batches.find(
        (b) => b.id === batchOf(model, activeBatchId, proposals[0].sourceId),
      );
      if (!batch) return;
      this.write(
        addSubmission(this.read(project.id, batch.id), {
          project: { id: project.id, name: project.name },
          batch: { id: batch.id, name: batch.name },
          model,
          proposals,
          stored: store.proposals.list(proposals[0].sourceId),
          runIntent: read.runIntent,
          intentGuideVersion,
          transcripts: read.transcripts,
          projectRevision: revision,
          now: new Date().toISOString(),
        }),
      );
    });
  }
  /** An export or filing was queued: save the batch's state as it goes out. */
  exported(store: ProjectStore, batchId: string | undefined) {
    this.guard('batch-record', () => {
      const { project, model, batches, revision } = store.data;
      const batch = batches.find((b) => b.id === batchId);
      if (!batch) return;
      this.write(
        finalState(this.read(project.id, batch.id), {
          project: { id: project.id, name: project.name },
          batch: { id: batch.id, name: batch.name },
          model,
          proposals: store.proposals.list(),
          exports: store.exports(),
          projectRevision: revision,
          now: new Date().toISOString(),
        }),
      );
    });
  }
}
