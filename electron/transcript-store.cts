import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { cueCandidate } from './transcript-edits.js';
import type {
  TranscriptSummary,
  TranscriptSegment,
  TranscriptPage,
} from './transcript-contracts.js' with { 'resolution-mode': 'import' };

export function createTranscriptSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS transcripts(id TEXT PRIMARY KEY, source_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transcript_contexts(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transcript_segments(transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(transcript_id, ordinal));`);
}
/** Immutable recognition is stored once, outside the editorial snapshot and Undo journal. */
export class TranscriptStore {
  constructor(private db: DatabaseSync) {
    createTranscriptSchema(db);
  }
  registerContext(context: TranscriptSummary['context']) {
    const body = JSON.stringify(context),
      id = createHash('sha256').update(body).digest('hex');
    this.db.prepare('INSERT OR IGNORE INTO transcript_contexts VALUES(?,?)').run(id, body);
    return id;
  }
  context(id: string): TranscriptSummary['context'] {
    const row = this.db.prepare('SELECT body FROM transcript_contexts WHERE id=?').get(id);
    if (!row) throw new Error('The transcription context revision is unavailable.');
    return JSON.parse(String(row.body));
  }
  private hydrate(body: string): TranscriptSummary {
    const summary = JSON.parse(body);
    return { ...summary, context: summary.context || this.context(summary.contextId) };
  }
  list(sourceId?: string): TranscriptSummary[] {
    return (
      sourceId
        ? this.db
            .prepare('SELECT body FROM transcripts WHERE source_id=? ORDER BY rowid DESC')
            .all(sourceId)
        : this.db.prepare('SELECT body FROM transcripts ORDER BY rowid DESC').all()
    ).map((r) => this.hydrate(String(r.body)));
  }
  get(id: string): TranscriptSummary {
    const row = this.db.prepare('SELECT body FROM transcripts WHERE id=?').get(id);
    if (!row) throw new Error('Transcript is unavailable. Reopen the transcript window.');
    return this.hydrate(String(row.body));
  }
  put(value: TranscriptSummary) {
    const { context, ...summary } = value;
    summary.contextId = this.registerContext(context);
    this.db
      .prepare(
        'INSERT INTO transcripts(id,source_id,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
      )
      .run(value.id, value.sourceId, JSON.stringify(summary));
  }
  begin(value: TranscriptSummary) {
    this.put(value);
    this.db.prepare('DELETE FROM transcript_segments WHERE transcript_id=?').run(value.id);
  }
  append(id: string, value: TranscriptSegment) {
    this.db
      .prepare('INSERT INTO transcript_segments VALUES(?,?,?)')
      .run(id, value.id, JSON.stringify(value));
  }
  segment(id: string, ordinal: number): TranscriptSegment {
    const row = this.db
      .prepare('SELECT body FROM transcript_segments WHERE transcript_id=? AND ordinal=?')
      .get(id, ordinal);
    if (!row) throw new Error('Transcript phrase is unavailable.');
    return JSON.parse(String(row.body));
  }
  cueSegment(id: string, ordinal: number): TranscriptSegment {
    const first = this.segment(id, ordinal),
      transcript = this.get(id),
      cue = cueCandidate(transcript, first);
    if (!cue) return first;
    const texts = [cue.text],
      ids = [first.id];
    for (const row of this.db
      .prepare(
        'SELECT body FROM transcript_segments WHERE transcript_id=? AND ordinal>? ORDER BY ordinal LIMIT 200',
      )
      .iterate(id, ordinal)) {
      const next = JSON.parse(String(row.body)) as TranscriptSegment;
      if (cueCandidate(transcript, next) || texts.join(' ').length + next.text.length > 9000) break;
      texts.push(next.text.trim());
      ids.push(next.id);
    }
    return { ...first, cueText: texts.filter(Boolean).join(' '), cueSegmentIds: ids };
  }
  page(id: string, page: number, search: string, editedMatches: number[] = []): TranscriptPage {
    if (
      !Number.isInteger(page) ||
      page < 0 ||
      page > 100000 ||
      typeof search !== 'string' ||
      search.length > 300
    )
      throw new Error('Invalid transcript search.');
    const transcript = this.get(id);
    // Bound each IPC response. Literal substring matching also treats % and _ literally.
    const filter = `transcript_id=? AND (instr(lower(json_extract(body,'$.text')),lower(?))>0 OR ordinal IN (SELECT value FROM json_each(?)))`;
    const matches = JSON.stringify(editedMatches);
    const total = Number(
      this.db
        .prepare(`SELECT count(*) AS n FROM transcript_segments WHERE ${filter}`)
        .get(id, search, matches)?.n || 0,
    );
    const segments = this.db
      .prepare(
        `SELECT body FROM transcript_segments WHERE ${filter} ORDER BY ordinal LIMIT 60 OFFSET ?`,
      )
      .all(id, search, matches, page * 60)
      .map((r) => {
        const segment = JSON.parse(String(r.body));
        return cueCandidate(transcript, segment) ? this.cueSegment(id, segment.id) : segment;
      });
    return { transcript, segments, total };
  }
  *segments(id: string): Generator<TranscriptSegment> {
    for (const r of this.db
      .prepare('SELECT body FROM transcript_segments WHERE transcript_id=? ORDER BY ordinal')
      .iterate(id))
      yield JSON.parse(String(r.body));
  }
  removeSource(id: string) {
    this.db.prepare('DELETE FROM transcripts WHERE source_id=?').run(id);
  }
}
