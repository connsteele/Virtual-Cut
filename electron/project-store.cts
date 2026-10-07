import { DatabaseSync } from 'node:sqlite';
import { TranscriptStore } from './transcript-store.cjs';
import { ProposalStore } from './proposal-store.cjs';
import { mkdir, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import type { Model } from './workflow-types.js' with { 'resolution-mode': 'import' };
import type {
  Batch,
  MediaJob,
  ProjectInfo,
  ProjectSnapshot,
  SaveCopy,
} from './project-contracts.js' with {
  'resolution-mode': 'import',
};
import { emptyModel, mergeEdits, editorial, validateEdits } from './project-edits.js';
import { reconcileReview } from './review-state.cjs';
import { inferReworks } from './proposal-edits.js';
import { correctedText, cueCandidate } from './transcript-edits.js';
import { changes, applyChange, type Change } from './project-changes.js';
import {
  PROJECT_APP_ID,
  PROJECT_VERSION,
  inspectProject,
  migrateProject,
  createSessionSchema,
  compactSaveCopy,
  openProjectReadOnly,
  createFrameIndexSchema,
  moveFrameIndexes,
} from './project-recovery.cjs';
import { decodeTimes, encodeTimes, extractFrameIndexes } from './frame-index.js';
import type { FrameIndex } from './frame-index.js' with { 'resolution-mode': 'import' };
import type { ExportRecord } from './export-contracts.js' with { 'resolution-mode': 'import' };

export interface NativeSource {
  id: string;
  file: string;
  bytes: number;
  modified: number;
  fingerprint: string;
  importedAt?: number;
  audioPreviews?: Record<number, string>;
}
interface Data {
  project: ProjectInfo;
  batches: Batch[];
  activeBatchId: string;
  model: Model;
  revision: number;
}
const APP_ID = PROJECT_APP_ID;
export class ProjectStore {
  transcripts!: TranscriptStore;
  proposals!: ProposalStore;
  readonly db!: DatabaseSync;
  private lock: string;
  data: Data;
  private backedRevision = -1;
  private observed?: Data;
  private persisted?: Data;
  private journal: { change: Change; bytes: number }[] = [];
  private cursor = 0;
  private savedAt = Date.now();
  private copies: SaveCopy[] = [];
  private recoveryNotice?: string;
  private checkedCopies = false;
  /** Called after any durable native change so open windows can refresh (VC-98). */
  changed?: () => void;
  constructor(
    readonly file: string,
    creation?: { name: string; destination: string; cache: string },
  ) {
    if (creation && existsSync(file))
      throw new Error('A project already exists at that location. Choose a new filename.');
    if (!creation && !existsSync(file))
      throw new Error('The project is missing or its drive is unavailable.');
    this.lock = file + '.lock';
    if (existsSync(this.lock)) {
      let pid: number;
      try {
        pid = JSON.parse(readFileSync(this.lock, 'utf8')).pid;
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid lock owner.');
      } catch {
        throw new Error(
          'The project lock is unreadable. Keep the project closed and check its lock file.',
        );
      }
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
      }
      if (alive) throw new Error('This project is already open in another Virtual Cut instance.');
      unlinkSync(this.lock);
    }
    const fd = openSync(this.lock, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    closeSync(fd);
    try {
      if (!creation) {
        const check = new DatabaseSync(file, { readOnly: true });
        try {
          inspectProject(check);
        } finally {
          check.close();
        }
      }
      this.db = new DatabaseSync(file, { timeout: 500 });
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      if (creation) {
        this.db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=${PROJECT_VERSION};
          CREATE TABLE project (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
          CREATE TABLE sources (id TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL DEFAULT 1, before TEXT NOT NULL, after TEXT NOT NULL, applied INTEGER NOT NULL);`);
        const batch = { id: randomUUID(), name: 'First batch', created: new Date().toISOString() };
        this.data = {
          project: { id: randomUUID(), file, ...creation },
          batches: [batch],
          activeBatchId: batch.id,
          model: emptyModel(),
          revision: 0,
        };
        this.write();
        createSessionSchema(this.db);
        createFrameIndexSchema(this.db);
      } else {
        if (migrateProject(this.db, file))
          this.recoveryNotice =
            'Project upgraded. A verified copy of the previous saved version is available in Save history.';
        // A current-format file should never hold inline indexes; move any that remain.
        createFrameIndexSchema(this.db);
        this.db.exec('BEGIN IMMEDIATE');
        try {
          moveFrameIndexes(this.db);
          this.db.exec('COMMIT');
        } catch (e) {
          this.db.exec('ROLLBACK');
          throw e;
        }
        const row = this.db.prepare('SELECT body FROM project WHERE id=1').get();
        if (!row || typeof row.body !== 'string') throw new Error('Project data is missing.');
        this.data = JSON.parse(row.body) as Data;
        this.persisted = structuredClone(this.data);
        this.data.project.file = file;
        this.observed = structuredClone(this.data);
        if (!this.data.project.id || !Array.isArray(this.data.model.recordings))
          throw new Error('Project data is invalid.');
        for (const job of this.jobs())
          if (['running', 'queued'].includes(job.state))
            this.putJob({
              ...job,
              state: 'interrupted',
              message: 'Interrupted. Retry when ready.',
              updated: new Date().toISOString(),
            });
      }
      // Additive native receipts are kept outside the edit journal. Old M1
      // projects open without changing annotation or timing identities.
      this.db.exec('CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
      this.transcripts = new TranscriptStore(this.db);
      this.proposals = new ProposalStore(this.db);
      this.proposals.infer = (proposals) =>
        inferReworks(proposals, (transcriptId, lineId) => {
          try {
            const transcript = this.transcripts.get(transcriptId);
            const segment = this.transcripts.segment(transcriptId, lineId);
            const text = correctedText(this.data.model, transcriptId, segment);
            const cue = cueCandidate(transcript, { ...segment, text });
            return cue
              ? {
                  transcriptId,
                  track: transcript.track,
                  lineId,
                  kind: cue.kind,
                  time: Math.round(cue.time * 1000) / 1000,
                  text: text.trim(),
                }
              : undefined;
          } catch {
            return undefined;
          }
        });
      for (const transcript of this.transcripts.list())
        if (transcript.state === 'running')
          this.transcripts.put({ ...transcript, state: 'interrupted' });
      for (const record of this.exports())
        if (['running', 'queued'].includes(record.state))
          this.putExport({
            ...record,
            state: 'interrupted',
            message: 'Export interrupted. Retry from Jobs.',
            updated: new Date().toISOString(),
          });
      const previousSession = this.db.prepare('SELECT clean FROM project_session WHERE id=1').get();
      if (previousSession?.clean === 0)
        this.recoveryNotice = `The previous session ended unexpectedly. Reopened committed revision ${this.data.revision}. Changes that had not finished saving may need to be repeated. Interrupted jobs can be retried from Jobs.`;
      this.db
        .prepare('UPDATE project_session SET clean=0, opened_at=?, closed_at=NULL WHERE id=1')
        .run(new Date().toISOString());
      this.backedRevision = this.data.revision;
    } catch (e) {
      try {
        this.db!.close();
      } catch {
        /* Failed before open. */
      }
      unlinkSync(this.lock);
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(
        `${message} If this file is damaged, use Projects → Recover from save to open a verified checkpoint as a separate project.`,
        { cause: e },
      );
    }
  }
  write() {
    // Native facts (inspection, batches, job results) remain durable. Apply only
    // that operation's changes; staged editorial work must wait for a save.
    const next =
      this.observed && this.persisted
        ? applyChange(this.persisted, changes(this.observed, this.data))
        : structuredClone(this.data);
    this.db
      .prepare('INSERT OR REPLACE INTO project (id,body) VALUES (1,?)')
      .run(JSON.stringify(next));
    this.persisted = next;
    this.observed = structuredClone(this.data);
    this.changed?.();
  }
  persist() {
    const body = JSON.stringify(this.data);
    if (body !== JSON.stringify(this.persisted))
      this.db.prepare('INSERT OR REPLACE INTO project (id,body) VALUES (1,?)').run(body);
    this.persisted = structuredClone(this.data);
    this.observed = structuredClone(this.data);
    this.savedAt = Date.now();
    this.changed?.();
  }
  async loadCopies() {
    const directory = this.file + '.saves';
    this.copies = (await readdir(directory).catch(() => []))
      .flatMap((id): SaveCopy[] => {
        const match = /^(auto|manual|migration-v\d+-v\d+)-(\d+)-[\da-f-]+\.vcut$/.exec(id);
        return match
          ? [
              {
                id,
                kind: match[1].startsWith('migration')
                  ? 'migration'
                  : (match[1] as SaveCopy['kind']),
                created: new Date(Number(match[2])).toISOString(),
              },
            ]
          : [];
      })
      .sort((a, b) => b.created.localeCompare(a.created));
    if (!this.checkedCopies) {
      this.checkedCopies = true;
      for (const copy of this.copies.filter((c) => c.kind !== 'migration')) {
        try {
          compactSaveCopy(path.join(directory, copy.id));
        } catch {
          this.recoveryNotice =
            (this.recoveryNotice ? this.recoveryNotice + ' ' : '') +
            'An older save copy could not be compacted. It was kept for recovery.';
          break;
        }
      }
    }
  }
  async checkpoint(kind: 'auto' | 'manual', force = false) {
    // force is retained for explicit close/maintenance callers; timed saves are
    // already scheduled by the workspace and never need an additional throttle.
    void force;
    if (kind === 'auto' && this.backedRevision === this.data.revision && !this.dirty()) return;
    this.persist();
    const directory = this.file + '.saves';
    await mkdir(directory, { recursive: true });
    const id = `${kind}-${Date.now()}-${randomUUID()}.vcut`,
      final = path.join(directory, id),
      temporary = final + '.partial';
    try {
      const copiedRevision = this.data.revision;
      // Compact copies omit SQLite's reusable free pages. Undo lives only in RAM.
      this.db.prepare('VACUUM INTO ?').run(temporary);
      const check = new DatabaseSync(temporary, { readOnly: true });
      try {
        if (check.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
          throw new Error('Save copy verification failed.');
      } finally {
        check.close();
      }
      await rename(temporary, final);
      this.backedRevision = copiedRevision;
      await this.loadCopies();
      // Keep independent rolling histories for recovery and deliberate checkpoints.
      for (const category of ['auto', 'manual']) {
        for (const copy of this.copies.filter((c) => c.kind === category).slice(5))
          await unlink(path.join(directory, copy.id));
      }
      await this.loadCopies();
    } finally {
      await unlink(temporary).catch(() => {});
      for (const suffix of ['-wal', '-shm']) await unlink(temporary + suffix).catch(() => {});
    }
  }
  async restore(saveId: string) {
    await this.loadCopies();
    if (!this.copies.some((c) => c.id === saveId))
      throw new Error('Choose an available save copy.');
    const check = openProjectReadOnly(path.join(this.file + '.saves', saveId));
    let saved: Data, sources: NativeSource[], jobs: MediaJob[];
    const savedIndexes: {
      source_id: string;
      fingerprint: string;
      frames: Uint8Array;
      keys: Uint8Array;
    }[] = [];
    let proposals: import('./proposal-contracts.js').AgentProposal[] = [];
    const transcripts: {
      summary: import('./transcript-contracts.js').TranscriptSummary;
      segments: import('./transcript-contracts.js').TranscriptSegment[];
    }[] = [];
    try {
      inspectProject(check);
      saved = JSON.parse(String(check.prepare('SELECT body FROM project WHERE id=1').get()?.body));
      if (saved.project.id !== this.data.project.id)
        throw new Error('This save belongs to another project.');
      const inline = extractFrameIndexes(saved.model);
      saved.model = validateEdits(saved.model);
      sources = check
        .prepare('SELECT body FROM sources')
        .all()
        .map((row) => JSON.parse(String(row.body)));
      if (check.prepare("SELECT name FROM sqlite_master WHERE name='frame_indexes'").get())
        for (const row of check
          .prepare('SELECT source_id, fingerprint, frames, keys FROM frame_indexes')
          .all())
          savedIndexes.push({
            source_id: String(row.source_id),
            fingerprint: String(row.fingerprint),
            frames: row.frames as Uint8Array,
            keys: row.keys as Uint8Array,
          });
      for (const [id, index] of inline)
        savedIndexes.push({
          source_id: id,
          fingerprint: sources.find((source) => source.id === id)?.fingerprint ?? '',
          frames: encodeTimes(index.frameTimes),
          keys: encodeTimes(index.keys),
        });
      jobs = check
        .prepare('SELECT body FROM jobs')
        .all()
        .map((row) => JSON.parse(String(row.body)));
      if (check.prepare("SELECT name FROM sqlite_master WHERE name='agent_proposals'").get())
        proposals = check
          .prepare('SELECT body FROM agent_proposals ORDER BY rowid')
          .all()
          .map((row) => JSON.parse(String(row.body)));
      if (check.prepare("SELECT name FROM sqlite_master WHERE name='transcripts'").get()) {
        for (const row of check.prepare('SELECT body FROM transcripts').all()) {
          const summary = JSON.parse(String(row.body));
          if (!summary.context && summary.contextId)
            summary.context = JSON.parse(
              String(
                check
                  .prepare('SELECT body FROM transcript_contexts WHERE id=?')
                  .get(summary.contextId)?.body,
              ),
            );
          if (!this.transcripts.list().some((t) => t.id === summary.id))
            transcripts.push({
              summary,
              segments: check
                .prepare(
                  'SELECT body FROM transcript_segments WHERE transcript_id=? ORDER BY ordinal',
                )
                .all(summary.id)
                .map((r) => JSON.parse(String(r.body))),
            });
        }
      }
    } finally {
      check.close();
    }
    await this.checkpoint('manual');
    // Keep a current index for a restored source whose file has not changed.
    const currentIndexes = this.db
      .prepare('SELECT source_id, fingerprint, frames, keys FROM frame_indexes')
      .all();
    this.transaction(() => {
      saved.project.file = this.file;
      saved.revision = this.data.revision + 1;
      this.data = saved;
      this.db.exec(
        'DELETE FROM sources; DELETE FROM jobs; DELETE FROM history; DELETE FROM frame_indexes;',
      );
      sources.forEach((source) => this.putSource(source));
      const putIndex = this.db.prepare(
        'INSERT OR REPLACE INTO frame_indexes (source_id, fingerprint, frames, keys) VALUES (?,?,?,?)',
      );
      for (const row of currentIndexes)
        if (sources.some((s) => s.id === row.source_id && s.fingerprint === row.fingerprint))
          putIndex.run(row.source_id, row.fingerprint, row.frames, row.keys);
      for (const row of savedIndexes)
        putIndex.run(row.source_id, row.fingerprint, row.frames, row.keys);
      this.proposals.merge(proposals);
      for (const transcript of transcripts) {
        this.transcripts.put(transcript.summary);
        for (const segment of transcript.segments)
          this.transcripts.append(transcript.summary.id, segment);
      }
      jobs.forEach((job) =>
        this.putJob(
          ['queued', 'running'].includes(job.state)
            ? { ...job, state: 'interrupted', message: 'Restored job. Retry when ready.' }
            : job,
        ),
      );
    });
    this.clearHistory();
    this.persist();
    this.backedRevision = -1;
  }
  transaction<T>(fn: () => T): T {
    const before = structuredClone(this.data);
    const persisted = this.persisted,
      observed = this.observed;
    const journal = this.journal,
      cursor = this.cursor;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.write();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      this.data = before;
      this.persisted = persisted;
      this.observed = observed;
      this.journal = journal;
      this.cursor = cursor;
      throw e;
    }
  }
  assert(id: string) {
    if (id !== this.data.project.id)
      throw new Error('The active project changed. Reopen your intended project.');
  }
  save(before: Model, after: Model) {
    const previous = this.data.model;
    const next = validateEdits(mergeEdits(before, after, previous));
    reconcileReview(next, previous);
    if (editorial(previous) !== editorial(next)) {
      const change = changes(JSON.parse(editorial(previous)), JSON.parse(editorial(next)))!;
      this.journal.splice(this.cursor);
      this.journal.push({ change, bytes: JSON.stringify(change).length * 2 });
      while (
        this.journal.length > 1 &&
        (this.journal.length > 100 ||
          this.journal.reduce((total, entry) => total + entry.bytes, 0) > 32 * 1024 * 1024)
      )
        this.journal.shift();
      this.cursor = this.journal.length;
    }
    this.data.model = next;
    this.data.revision++;
    this.observed = structuredClone(this.data);
  }
  history(direction: 'undo' | 'redo') {
    const reverse = direction === 'undo';
    const entry = this.journal[reverse ? this.cursor - 1 : this.cursor];
    if (!entry) return;
    this.data.model = validateEdits(applyChange(this.data.model, entry.change, reverse));
    reconcileReview(this.data.model);
    this.cursor += reverse ? -1 : 1;
    this.data.revision++;
    this.observed = structuredClone(this.data);
  }
  sources(): NativeSource[] {
    return this.db
      .prepare('SELECT body FROM sources')
      .all()
      .map((r) => JSON.parse(String(r.body)));
  }
  putSource(s: NativeSource) {
    this.db
      .prepare('INSERT OR REPLACE INTO sources (id,body) VALUES (?,?)')
      .run(s.id, JSON.stringify(s));
    this.changed?.();
  }
  /** Indexes inspected from a different file revision are stale and never returned. */
  frameIndex(sourceId: string): FrameIndex | null {
    const source = this.sources().find((s) => s.id === sourceId);
    const row = this.db
      .prepare('SELECT fingerprint, frames, keys FROM frame_indexes WHERE source_id=?')
      .get(sourceId);
    if (!source || !row || row.fingerprint !== source.fingerprint) return null;
    return {
      frameTimes: decodeTimes(row.frames as Uint8Array),
      keys: decodeTimes(row.keys as Uint8Array),
    };
  }
  putFrameIndex(sourceId: string, fingerprint: string, index: FrameIndex) {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO frame_indexes (source_id, fingerprint, frames, keys) VALUES (?,?,?,?)',
      )
      .run(sourceId, fingerprint, encodeTimes(index.frameTimes), encodeTimes(index.keys));
  }
  removeSource(id: string) {
    this.db.prepare('DELETE FROM frame_indexes WHERE source_id=?').run(id);
    this.transcripts.removeSource(id);
    this.proposals.removeSource(id);
    this.db.prepare("DELETE FROM jobs WHERE json_extract(body,'$.sourceId')=?").run(id);
    this.db.prepare('DELETE FROM sources WHERE id=?').run(id);
    this.changed?.();
  }
  clearHistory() {
    this.journal = [];
    this.cursor = 0;
    this.db.exec('DELETE FROM history');
  }
  jobs(): MediaJob[] {
    return this.db
      .prepare('SELECT body FROM jobs ORDER BY rowid DESC')
      .all()
      .map((r) => JSON.parse(String(r.body)));
  }
  putJob(j: MediaJob) {
    this.db
      .prepare('INSERT OR REPLACE INTO jobs (id,body) VALUES (?,?)')
      .run(j.id, JSON.stringify(j));
    this.changed?.();
  }
  exports(): ExportRecord[] {
    return this.db
      .prepare('SELECT body FROM exports ORDER BY rowid DESC')
      .all()
      .map((r) => JSON.parse(String(r.body)));
  }
  putExport(record: ExportRecord) {
    this.db
      .prepare('INSERT OR REPLACE INTO exports (id,body) VALUES (?,?)')
      .run(record.plan.id, JSON.stringify(record));
    this.changed?.();
  }
  discardExportPlans() {
    this.db.prepare("DELETE FROM exports WHERE json_extract(body, '$.state')='planned'").run();
  }
  snapshot(): ProjectSnapshot {
    return {
      ...structuredClone(this.data),
      jobs: this.jobs(),
      exports: this.exports(),
      canUndo: this.cursor > 0,
      canRedo: this.cursor < this.journal.length,
      unsavedChanges: this.dirty(),
      unsavedEdits: editorial(this.data.model) !== editorial(this.persisted!.model),
      savedAt: this.savedAt,
      saves: structuredClone(this.copies),
      recoveryNotice: this.recoveryNotice,
    };
  }
  private dirty() {
    return JSON.stringify(this.data.model) !== JSON.stringify(this.persisted?.model);
  }
  close() {
    this.persist();
    this.db
      .prepare('UPDATE project_session SET clean=1, closed_at=? WHERE id=1')
      .run(new Date().toISOString());
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.db.close();
    unlinkSync(this.lock);
  }
}
