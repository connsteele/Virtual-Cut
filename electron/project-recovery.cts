import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateEdits } from './project-edits.js';

export const PROJECT_APP_ID = 1447253332;
export const PROJECT_VERSION = 4;
/** Closed copies need no journal files. Active/pending databases must still read their WAL. */
export function openProjectReadOnly(file: string) {
  const pending = ['.lock', '-wal', '-shm'].some((suffix) => existsSync(file + suffix));
  const uri = pathToFileURL(file);
  uri.search = 'immutable=1';
  return new DatabaseSync(pending ? file : uri.href, { readOnly: true });
}
const sessionSchema = `CREATE TABLE project_session (
  id INTEGER PRIMARY KEY CHECK(id=1), clean INTEGER NOT NULL,
  opened_at TEXT NOT NULL, closed_at TEXT);
  INSERT INTO project_session VALUES (1,1,'',NULL);`;

/** Validate before any migration or recovery write. Future versions stay untouched. */
export function inspectProject(db: DatabaseSync) {
  if (db.prepare('PRAGMA application_id').get()?.application_id !== PROJECT_APP_ID)
    throw new Error('This is not a Virtual Cut project.');
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if (version > PROJECT_VERSION)
    throw new Error('This project needs a newer Virtual Cut version. Open it with that version.');
  if (![1, 2, 3, 4].includes(version))
    throw new Error('This project uses an unsupported saved version.');
  if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
    throw new Error('Project integrity check failed.');
  const data = JSON.parse(String(db.prepare('SELECT body FROM project WHERE id=1').get()?.body));
  if (
    !data.project?.id ||
    typeof data.project.name !== 'string' ||
    !path.isAbsolute(data.project.cache) ||
    !path.isAbsolute(data.project.destination) ||
    !Array.isArray(data.batches) ||
    !data.batches.some((b: { id: string }) => b.id === data.activeBatchId) ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0
  )
    throw new Error('Project data is invalid.');
  // Validation may normalize fields, so leave the original stored model intact.
  validateEdits(structuredClone(data.model));
  for (const table of ['sources', 'jobs'])
    for (const row of db.prepare(`SELECT id, body FROM ${table}`).all()) {
      const value = JSON.parse(String(row.body));
      if (value.id !== row.id) throw new Error(`Invalid saved ${table} entry.`);
    }
  for (const row of db.prepare('SELECT version, before, after FROM history').all()) {
    if (row.version !== 1) throw new Error('This project needs a newer edit-history version.');
    validateEdits(JSON.parse(String(row.before)));
    validateEdits(JSON.parse(String(row.after)));
  }
  if (db.prepare("SELECT name FROM sqlite_master WHERE name='exports'").get())
    for (const row of db.prepare('SELECT id, body FROM exports').all())
      if (JSON.parse(String(row.body)).plan?.id !== row.id)
        throw new Error('Invalid saved export receipt.');
  if (version >= 2) {
    const session = db.prepare('SELECT clean FROM project_session WHERE id=1').get();
    if (!session || ![0, 1].includes(Number(session.clean)))
      throw new Error('Project session data is invalid.');
  }
  return { version, data };
}

export function createSessionSchema(db: DatabaseSync) {
  db.exec(sessionSchema);
}

/** Upgrade a closed rolling save in place only after its replacement verifies.
 * The project-level pre-upgrade copy remains in its original format. */
export function compactSaveCopy(file: string) {
  if (['.lock', '-wal', '-shm'].some((suffix) => existsSync(file + suffix)))
    throw new Error('Save copy is open or has pending database files.');
  const source = openProjectReadOnly(file);
  const temporary = file + `.${randomUUID()}.partial`;
  try {
    try {
      const version = Number(source.prepare('PRAGMA user_version').get()?.user_version);
      if (version === PROJECT_VERSION) return;
      const { data } = inspectProject(source);
      source.prepare('VACUUM INTO ?').run(temporary);
      const copy = new DatabaseSync(temporary);
      try {
        copy.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
        if (version === 1) createSessionSchema(copy);
        createTranscriptSchema(copy);
        copy.exec(`DELETE FROM history; PRAGMA user_version=${PROJECT_VERSION}; COMMIT; VACUUM`);
        const checked = inspectProject(copy);
        if (JSON.stringify(checked.data) !== JSON.stringify(data))
          throw new Error('Compacted save did not retain its project state.');
        for (const table of ['sources', 'jobs', 'exports']) {
          if (!source.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table)) continue;
          if (
            JSON.stringify(source.prepare(`SELECT * FROM ${table} ORDER BY id`).all()) !==
            JSON.stringify(copy.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
          )
            throw new Error('Compacted save did not retain its native records.');
        }
      } finally {
        copy.close();
      }
    } finally {
      source.close();
    }
    renameSync(temporary, file);
  } finally {
    for (const name of [temporary, temporary + '-wal', temporary + '-shm'])
      try {
        unlinkSync(name);
      } catch {
        /* No unpublished copy remains. */
      }
  }
}

/** A verified, version-labelled copy must exist before the atomic schema upgrade. */
export function migrateProject(db: DatabaseSync, file: string) {
  const { version } = inspectProject(db);
  if (version === PROJECT_VERSION) return false;
  const directory = file + '.saves';
  mkdirSync(directory, { recursive: true });
  const final = path.join(
    directory,
    `migration-v${version}-v${PROJECT_VERSION}-${Date.now()}-${randomUUID()}.vcut`,
  );
  const temporary = final + '.partial';
  try {
    // SQLite's snapshot includes committed WAL records. A plain file copy would not.
    db.prepare('VACUUM INTO ?').run(temporary);
    const check = new DatabaseSync(temporary, { readOnly: true });
    try {
      inspectProject(check);
    } finally {
      check.close();
    }
    renameSync(temporary, final);
  } finally {
    for (const name of [temporary, temporary + '-wal', temporary + '-shm'])
      try {
        unlinkSync(name);
      } catch {
        /* No unpublished copy remains. */
      }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    if (version === 1) db.exec(sessionSchema);
    db.exec('CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    createTranscriptSchema(db);
    db.exec('DELETE FROM history');
    db.exec(`PRAGMA user_version=${PROJECT_VERSION}; COMMIT`);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  // One-time compaction removes old full-model Undo entries and free pages.
  // The verified pre-upgrade copy retains the old format and its history.
  db.exec('VACUUM; PRAGMA wal_checkpoint(TRUNCATE)');
  return true;
}

/** Recover to a new identity and file. Never overwrite the damaged project or its saves. */
export async function recoverProjectCopy(source: string, destination: string) {
  const temporary = destination + `.${randomUUID()}.partial`;
  // Recovery can also target a live working project: its backup must observe concurrent commits.
  const checkpoint =
    /\.vcut\.saves$/i.test(path.dirname(source)) &&
    /^(auto|manual|migration-v\d+-v\d+)-\d+-[a-f\d-]+\.vcut$/i.test(path.basename(source));
  const sourceDb = checkpoint
    ? openProjectReadOnly(source)
    : new DatabaseSync(source, { readOnly: true });
  try {
    inspectProject(sourceDb);
    await backup(sourceDb, temporary);
    const copy = new DatabaseSync(temporary);
    try {
      // A user may choose an open project rather than an immutable checkpoint.
      // Use the captured database's model, never a pre-backup read of that source.
      const { data, version } = inspectProject(copy);
      copy.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
      data.project.id = randomUUID();
      data.project.name += ' · recovered';
      data.project.file = destination;
      copy.prepare('UPDATE project SET body=? WHERE id=1').run(JSON.stringify(data));
      if (version >= 2) copy.exec('UPDATE project_session SET clean=1 WHERE id=1');
      copy.exec('COMMIT');
      inspectProject(copy);
    } finally {
      copy.close();
    }
    // Publishing by hard link is atomic and refuses any existing destination.
    await link(temporary, destination);
  } finally {
    sourceDb.close();
    await unlink(temporary).catch(() => {});
  }
}
import { createTranscriptSchema } from './transcript-store.cjs';
