import { DatabaseSync, backup } from 'node:sqlite';
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
import type { ExportRecord } from './export-contracts.js' with { 'resolution-mode': 'import' };

export interface NativeSource {
  id: string;
  file: string;
  bytes: number;
  modified: number;
  fingerprint: string;
  audioPreviews?: Record<number, string>;
}
interface Data {
  project: ProjectInfo;
  batches: Batch[];
  activeBatchId: string;
  model: Model;
  revision: number;
}
const APP_ID = 1447253332;
export class ProjectStore {
  readonly db!: DatabaseSync;
  private lock: string;
  data: Data;
  private lastAuto = 0;
  private backedRevision = -1;
  private copies: SaveCopy[] = [];
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
          if (
            check.prepare('PRAGMA application_id').get()?.application_id !== APP_ID ||
            check.prepare('PRAGMA user_version').get()?.user_version !== 1
          )
            throw new Error('This is not a supported Virtual Cut project version.');
        } finally {
          check.close();
        }
      }
      this.db = new DatabaseSync(file, { timeout: 500 });
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      if (creation) {
        this.db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;
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
      } else {
        const row = this.db.prepare('SELECT body FROM project WHERE id=1').get();
        if (!row || typeof row.body !== 'string') throw new Error('Project data is missing.');
        this.data = JSON.parse(row.body) as Data;
        this.data.project.file = file;
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
      for (const record of this.exports())
        if (['running', 'queued'].includes(record.state))
          this.putExport({
            ...record,
            state: 'interrupted',
            message: 'Export interrupted. Retry from Jobs.',
            updated: new Date().toISOString(),
          });
    } catch (e) {
      try {
        this.db!.close();
      } catch {
        /* Failed before open. */
      }
      unlinkSync(this.lock);
      throw e;
    }
  }
  write() {
    this.db
      .prepare('INSERT OR REPLACE INTO project (id,body) VALUES (1,?)')
      .run(JSON.stringify(this.data));
  }
  async loadCopies() {
    const directory = this.file + '.saves';
    this.copies = (await readdir(directory).catch(() => []))
      .flatMap((id): SaveCopy[] => {
        const match = /^(auto|manual)-(\d+)-[\da-f-]+\.vcut$/.exec(id);
        return match
          ? [
              {
                id,
                kind: match[1] as SaveCopy['kind'],
                created: new Date(Number(match[2])).toISOString(),
              },
            ]
          : [];
      })
      .sort((a, b) => b.created.localeCompare(a.created));
  }
  async checkpoint(kind: SaveCopy['kind'], force = false) {
    if (
      kind === 'auto' &&
      ((!force && Date.now() - this.lastAuto < 120000) ||
        this.backedRevision === this.data.revision)
    )
      return;
    const directory = this.file + '.saves';
    await mkdir(directory, { recursive: true });
    const id = `${kind}-${Date.now()}-${randomUUID()}.vcut`,
      final = path.join(directory, id),
      temporary = final + '.partial';
    try {
      const copiedRevision = this.data.revision;
      await backup(this.db, temporary);
      const check = new DatabaseSync(temporary, { readOnly: true });
      try {
        if (check.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
          throw new Error('Save copy verification failed.');
      } finally {
        check.close();
      }
      await rename(temporary, final);
      this.backedRevision = copiedRevision;
      if (kind === 'auto') this.lastAuto = Date.now();
      await this.loadCopies();
      // Keep independent rolling histories for recovery and deliberate checkpoints.
      for (const category of ['auto', 'manual']) {
        for (const copy of this.copies.filter((c) => c.kind === category).slice(5))
          await unlink(path.join(directory, copy.id));
      }
      await this.loadCopies();
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async restore(saveId: string) {
    await this.loadCopies();
    if (!this.copies.some((c) => c.id === saveId))
      throw new Error('Choose an available save copy.');
    const check = new DatabaseSync(path.join(this.file + '.saves', saveId), { readOnly: true });
    let saved: Data, sources: NativeSource[], jobs: MediaJob[];
    try {
      if (
        check.prepare('PRAGMA application_id').get()?.application_id !== APP_ID ||
        check.prepare('PRAGMA user_version').get()?.user_version !== 1 ||
        check.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok'
      )
        throw new Error('This save copy is not a valid project.');
      saved = JSON.parse(String(check.prepare('SELECT body FROM project WHERE id=1').get()?.body));
      if (saved.project.id !== this.data.project.id)
        throw new Error('This save belongs to another project.');
      saved.model = validateEdits(saved.model);
      sources = check
        .prepare('SELECT body FROM sources')
        .all()
        .map((row) => JSON.parse(String(row.body)));
      jobs = check
        .prepare('SELECT body FROM jobs')
        .all()
        .map((row) => JSON.parse(String(row.body)));
    } finally {
      check.close();
    }
    await this.checkpoint('manual');
    this.transaction(() => {
      saved.project.file = this.file;
      saved.revision = this.data.revision + 1;
      this.data = saved;
      this.db.exec('DELETE FROM sources; DELETE FROM jobs; DELETE FROM history;');
      sources.forEach((source) => this.putSource(source));
      jobs.forEach((job) =>
        this.putJob(
          ['queued', 'running'].includes(job.state)
            ? { ...job, state: 'interrupted', message: 'Restored job. Retry when ready.' }
            : job,
        ),
      );
    });
    this.backedRevision = -1;
  }
  transaction<T>(fn: () => T): T {
    const before = structuredClone(this.data);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.write();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      this.data = before;
      throw e;
    }
  }
  assert(id: string) {
    if (id !== this.data.project.id)
      throw new Error('The active project changed. Reopen your intended project.');
  }
  save(before: Model, after: Model) {
    return this.transaction(() => {
      const previous = this.data.model;
      const next = validateEdits(mergeEdits(before, after, previous));
      // Source changes invalidate previously accepted reviews in native code too.
      next.clips = next.clips.map((c) => {
        const old = previous.clips.find((x) => x.id === c.id);
        const changed =
          !old ||
          ['name', 'start', 'end', 'folder', 'note'].some(
            (k) => old[k as keyof typeof old] !== c[k as keyof typeof c],
          ) ||
          JSON.stringify(previous.markers[c.rid]) !== JSON.stringify(next.markers[c.rid]);
        return changed ? { ...c, accepted: false, filed: false } : c;
      });
      if (editorial(previous) !== editorial(next)) {
        this.db.prepare('DELETE FROM history WHERE applied=0').run();
        this.db
          .prepare('INSERT INTO history (before,after,applied) VALUES (?,?,1)')
          .run(JSON.stringify(previous), JSON.stringify(next));
        this.db.exec(
          'DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 100)',
        );
      }
      this.data.model = next;
      this.data.revision++;
    });
  }
  history(direction: 'undo' | 'redo') {
    this.transaction(() => {
      const row = this.db
        .prepare(
          direction === 'undo'
            ? 'SELECT * FROM history WHERE applied=1 ORDER BY id DESC LIMIT 1'
            : 'SELECT * FROM history WHERE applied=0 ORDER BY id LIMIT 1',
        )
        .get();
      if (!row) return;
      if (row.version !== 1) throw new Error('This undo entry uses an unsupported edit version.');
      const before = JSON.parse(String(row.before)),
        after = JSON.parse(String(row.after));
      const positions = new Map(this.data.model.recordings.map((r) => [r.id, r.position]));
      const selected = this.data.model.selectedRecordingId;
      this.data.model = validateEdits(
        direction === 'undo'
          ? mergeEdits(after, before, this.data.model)
          : mergeEdits(before, after, this.data.model),
      );
      this.data.model.recordings.forEach((r) => {
        r.position = positions.get(r.id) ?? r.position;
      });
      this.data.model.selectedRecordingId = selected;
      this.db
        .prepare('UPDATE history SET applied=? WHERE id=?')
        .run(direction === 'undo' ? 0 : 1, row.id!);
      this.data.revision++;
    });
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
  }
  removeSource(id: string) {
    this.db.prepare("DELETE FROM jobs WHERE json_extract(body,'$.sourceId')=?").run(id);
    this.db.prepare('DELETE FROM sources WHERE id=?').run(id);
  }
  clearHistory() {
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
  }
  discardExportPlans() {
    this.db.prepare("DELETE FROM exports WHERE json_extract(body, '$.state')='planned'").run();
  }
  snapshot(): ProjectSnapshot {
    return {
      ...structuredClone(this.data),
      jobs: this.jobs(),
      exports: this.exports(),
      canUndo: Boolean(this.db.prepare('SELECT id FROM history WHERE applied=1 LIMIT 1').get()),
      canRedo: Boolean(this.db.prepare('SELECT id FROM history WHERE applied=0 LIMIT 1').get()),
      saves: structuredClone(this.copies),
    };
  }
  close() {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.db.close();
    unlinkSync(this.lock);
  }
}
