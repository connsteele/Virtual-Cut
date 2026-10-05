import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { cueCandidate, correctedText, reviewedCue } from './transcript-edits.js';
import type { Model } from './workflow-types.js' with { 'resolution-mode': 'import' };
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
  cueSegment(
    id: string,
    ordinal: number,
    model: Pick<Model, 'transcriptEdits'> = {},
  ): TranscriptSegment {
    const first = this.segment(id, ordinal),
      transcript = this.get(id),
      cue = cueCandidate(transcript, { ...first, text: correctedText(model, id, first) });
    if (!cue) return first;
    let cuePartner: TranscriptSegment['cuePartner'];
    if (cue.kind === 'clip-start' || cue.kind === 'clip-end') {
      const forward = cue.kind === 'clip-start';
      // Pair only adjacent boundary cues. Repeated starts/ends stay ambiguous.
      for (const other of this.segments(id, ordinal, !forward)) {
        const candidate = cueCandidate(transcript, {
          ...other,
          text: correctedText(model, id, other),
        });
        if (candidate?.kind !== 'clip-start' && candidate?.kind !== 'clip-end') continue;
        if (candidate.kind !== cue.kind)
          cuePartner = { id: other.id, time: candidate.time, text: candidate.text };
        break;
      }
    }
    if (cue.kind === 'clip-end' && cuePartner) {
      const start = this.cueSegment(id, cuePartner.id, model);
      return {
        ...first,
        cueKind: cue.kind,
        cueTitle: start.cueTitle,
        cueText: start.cueText,
        cueSegmentIds: start.cueSegmentIds,
        cueContext: start.cueContext,
        cueContextLimited: start.cueContextLimited,
        cuePartner,
      };
    }
    const cueContext = [{ id: first.id, start: first.start, end: first.end, text: cue.text }];
    let textLength = cue.text.length,
      cueContextLimited = false;
    for (const row of this.db
      .prepare(
        'SELECT body FROM transcript_segments WHERE transcript_id=? AND ordinal>? ORDER BY ordinal LIMIT 200',
      )
      .all(id, ordinal)) {
      const next = JSON.parse(String(row.body)) as TranscriptSegment;
      const text = correctedText(model, id, next);
      if (cueCandidate(transcript, { ...next, text })) break;
      if (textLength + text.length + 1 > 9000) {
        cueContextLimited = true;
        break;
      }
      cueContext.push({ id: next.id, start: next.start, end: next.end, text: text.trim() });
      textLength += text.length + 1;
    }
    if (cueContext.length === 201) cueContextLimited = true;
    return {
      ...first,
      cueKind: cue.kind,
      cueTitle: cue.text,
      cueText: cueContext
        .map((part) => part.text)
        .filter(Boolean)
        .join(' '),
      cueSegmentIds: cueContext.map((part) => part.id),
      cueContext,
      cueContextLimited,
      cuePartner,
    };
  }
  page(
    id: string,
    page: number,
    search: string,
    editedMatches: number[] = [],
    model: Pick<Model, 'transcriptEdits' | 'cueDecisions'> = {},
    mode: 'all' | 'cues' | 'pending' | 'accepted' | 'rejected' = 'all',
  ): TranscriptPage {
    if (
      !Number.isInteger(page) ||
      page < 0 ||
      page > 100000 ||
      typeof search !== 'string' ||
      search.length > 300
    )
      throw new Error('Invalid transcript search.');
    const transcript = this.get(id);
    if (!['all', 'cues', 'pending', 'accepted', 'rejected'].includes(mode))
      throw new Error('Invalid cue filter.');
    const cueIds: number[] = [];
    const counts = {
      all: Number(
        this.db
          .prepare('SELECT count(*) AS n FROM transcript_segments WHERE transcript_id=?')
          .get(id)?.n || 0,
      ),
      cues: 0,
      pending: 0,
      accepted: 0,
      rejected: 0,
    };
    // Only microphone transcripts can hold cues, so game dialogue skips the scan.
    if (transcript.role === 'mic')
      for (const original of this.segments(id)) {
        const segment = { ...original, text: correctedText(model, id, original) };
        if (!cueCandidate(transcript, segment)) continue;
        const status =
          reviewedCue(model.cueDecisions || [], transcript, segment)?.status || 'pending';
        counts.cues++;
        counts[status]++;
        if (mode === 'cues' || mode === status) cueIds.push(segment.id);
      }
    // Bound each IPC response. Literal substring matching also treats % and _ literally.
    const filter = `transcript_id=? AND (instr(lower(json_extract(body,'$.text')),lower(?))>0 OR ordinal IN (SELECT value FROM json_each(?))) AND (?='all' OR ordinal IN (SELECT value FROM json_each(?)))`;
    const matches = JSON.stringify(editedMatches);
    const args = [id, search, matches, mode, JSON.stringify(cueIds)];
    const total = Number(
      this.db.prepare(`SELECT count(*) AS n FROM transcript_segments WHERE ${filter}`).get(...args)
        ?.n || 0,
    );
    const segments = this.db
      .prepare(
        `SELECT body FROM transcript_segments WHERE ${filter} ORDER BY ordinal LIMIT 60 OFFSET ?`,
      )
      .all(...args, page * 60)
      .map((r) => {
        const segment = JSON.parse(String(r.body));
        return cueCandidate(transcript, { ...segment, text: correctedText(model, id, segment) })
          ? this.cueSegment(id, segment.id, model)
          : segment;
      });
    const next = this.db
      .prepare(
        'SELECT body FROM transcript_segments WHERE transcript_id=? ORDER BY ordinal LIMIT 1 OFFSET ?',
      )
      .get(id, (page + 1) * 60);
    return {
      transcript,
      segments,
      total,
      counts,
      followStart: page === 0 ? 0 : segments[0]?.start,
      followEnd: next ? JSON.parse(String(next.body)).start : undefined,
    };
  }
  pageAt(id: string, time: number) {
    const transcript = this.get(id);
    if (!Number.isFinite(time) || time < 0 || time > transcript.duration + 1)
      throw new Error('Invalid transcript time.');
    const row = this.db
      .prepare(
        "SELECT ordinal FROM transcript_segments WHERE transcript_id=? AND json_extract(body,'$.start')<=? ORDER BY ordinal DESC LIMIT 1",
      )
      .get(id, time);
    return Math.floor(Number(row?.ordinal || 0) / 60);
  }
  *segments(id: string, after = -1, backwards = false): Generator<TranscriptSegment> {
    // Keep bounded pages, rather than a live SQLite statement across generator yields.
    const statement = this.db.prepare(
      `SELECT ordinal, body FROM transcript_segments WHERE transcript_id=? AND ordinal${backwards ? '<' : '>'}? ORDER BY ordinal ${backwards ? 'DESC' : 'ASC'} LIMIT 200`,
    );
    let cursor = after;
    while (true) {
      const rows = statement.all(id, cursor);
      if (!rows.length) return;
      for (const row of rows) yield JSON.parse(String(row.body));
      cursor = Number(rows.at(-1)!.ordinal);
    }
  }
  removeSource(id: string) {
    this.db.prepare('DELETE FROM transcripts WHERE source_id=?').run(id);
  }
}
