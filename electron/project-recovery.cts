import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateEdits } from './project-edits.js';

export const PROJECT_APP_ID = 1447253332;
export const PROJECT_VERSION = 2;
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
  if (![1, 2].includes(version)) throw new Error('This project uses an unsupported saved version.');
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
  if (version === 2) {
    const session = db.prepare('SELECT clean FROM project_session WHERE id=1').get();
    if (!session || ![0, 1].includes(Number(session.clean)))
      throw new Error('Project session data is invalid.');
  }
  return { version, data };
}

export function createSessionSchema(db: DatabaseSync) {
  db.exec(sessionSchema);
}

/** A verified, version-labelled copy must exist before the atomic schema upgrade. */
export function migrateProject(db: DatabaseSync, file: string) {
  const { version } = inspectProject(db);
  if (version === PROJECT_VERSION) return false;
  const directory = file + '.saves';
  mkdirSync(directory, { recursive: true });
  const final = path.join(directory, `migration-v1-v2-${Date.now()}-${randomUUID()}.vcut`);
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
    try {
      unlinkSync(temporary);
    } catch {
      /* No unpublished copy remains. */
    }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sessionSchema);
    db.exec('CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    db.exec(`PRAGMA user_version=${PROJECT_VERSION}; COMMIT`);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return true;
}

/** Recover to a new identity and file. Never overwrite the damaged project or its saves. */
export async function recoverProjectCopy(source: string, destination: string) {
  const temporary = destination + `.${randomUUID()}.partial`;
  const sourceDb = new DatabaseSync(source, { readOnly: true });
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
      if (version === 2) copy.exec('UPDATE project_session SET clean=1 WHERE id=1');
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
