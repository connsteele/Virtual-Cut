import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { cueCandidate, correctedText, reviewedCue } from './transcript-edits.js';
import type { Model } from './workflow-types.js' with { 'resolution-mode': 'import' };
import type {
  DropReason,
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
  /**
   * Lines dropped from a transcript (VC-166), from the project's edits. Every reader skips them
   * (pages, cues, proposals, agents, exports); only the Original view asks for them.
   */
  dropped: (transcriptId: string) => ReadonlyMap<number, DropReason> = () => new Map();
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
    const dropped = this.dropped(id);
    for (const row of this.db
      .prepare(
        'SELECT body FROM transcript_segments WHERE transcript_id=? AND ordinal>? ORDER BY ordinal LIMIT 200',
      )
      .all(id, ordinal)) {
      const next = JSON.parse(String(row.body)) as TranscriptSegment;
      if (dropped.has(next.id)) continue;
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
  /**
   * One page of phrases, or of a microphone and a game transcript interleaved in time order
   * (VC-185, `also` names the game transcript and its corrected-search matches). The combined
   * page lists each phrase's transcript in `owners`; only the microphone can hold cues.
   */
  page(
    id: string,
    page: number,
    search: string,
    editedMatches: number[] = [],
    model: Pick<Model, 'transcriptEdits' | 'cueDecisions'> = {},
    mode: 'all' | 'cues' | 'pending' | 'accepted' | 'rejected' = 'all',
    also?: { id: string; matches: number[] },
    /** The Original view: dropped lines come back too, each saying why it was dropped. */
    original = false,
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
    const partner = also && this.pair(transcript, also.id);
    const cueIds: number[] = [];
    const dropped = this.dropped(id),
      partnerDropped = partner ? this.dropped(partner.id) : new Map<number, DropReason>();
    const hidden = (lines: ReadonlyMap<number, DropReason>) =>
      JSON.stringify(original ? [] : [...lines.keys()]);
    const counted = (transcriptId: string, lines: ReadonlyMap<number, DropReason>) =>
      Number(
        this.db
          .prepare('SELECT count(*) AS n FROM transcript_segments WHERE transcript_id=?')
          .get(transcriptId)?.n || 0,
      ) - (original ? 0 : lines.size);
    const counts = {
      all: counted(id, dropped) + (partner ? counted(partner.id, partnerDropped) : 0),
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
    const filter = `transcript_id=? AND (instr(lower(json_extract(body,'$.text')),lower(?))>0 OR ordinal IN (SELECT value FROM json_each(?))) AND (?='all' OR ordinal IN (SELECT value FROM json_each(?))) AND ordinal NOT IN (SELECT value FROM json_each(?))`;
    const args: (string | number)[] = [
      id,
      search,
      JSON.stringify(editedMatches),
      mode,
      JSON.stringify(cueIds),
      hidden(dropped),
    ];
    // Game phrases hold no cues, so a cue filter leaves only the microphone's.
    const where = partner ? `(${filter}) OR (${filter})` : filter;
    if (partner)
      args.push(
        partner.id,
        search,
        JSON.stringify(also.matches),
        mode,
        '[]',
        hidden(partnerDropped),
      );
    // Time order across both; at the same start the microphone comes first.
    const order = partner ? `json_extract(body,'$.start'), transcript_id<>?, ordinal` : 'ordinal';
    const orderArgs = partner ? [id] : [];
    const total = Number(
      this.db.prepare(`SELECT count(*) AS n FROM transcript_segments WHERE ${where}`).get(...args)
        ?.n || 0,
    );
    const rows = this.db
      .prepare(
        `SELECT transcript_id, body FROM transcript_segments WHERE ${where} ORDER BY ${order} LIMIT 60 OFFSET ?`,
      )
      .all(...args, ...orderArgs, page * 60);
    const segments = rows.map((r) => {
      const segment = JSON.parse(String(r.body));
      const owner = String(r.transcript_id);
      const reason = (owner === id ? dropped : partnerDropped).get(segment.id);
      if (reason) return { ...segment, dropped: reason };
      return owner === id &&
        cueCandidate(transcript, { ...segment, text: correctedText(model, id, segment) })
        ? this.cueSegment(id, segment.id, model)
        : segment;
    });
    // Where the next page starts, in the same reading (dropped lines left out unless Original).
    const shown = `NOT (transcript_id=? AND ordinal IN (SELECT value FROM json_each(?)))`;
    const next = this.db
      .prepare(
        partner
          ? `SELECT body FROM transcript_segments WHERE transcript_id IN (?,?) AND ${shown} AND ${shown} ORDER BY ${order} LIMIT 1 OFFSET ?`
          : `SELECT body FROM transcript_segments WHERE transcript_id=? AND ${shown} ORDER BY ordinal LIMIT 1 OFFSET ?`,
      )
      .get(
        ...(partner
          ? [id, partner.id, id, hidden(dropped), partner.id, hidden(partnerDropped), id]
          : [id, id, hidden(dropped)]),
        (page + 1) * 60,
      );
    return {
      transcript,
      segments,
      total,
      counts,
      followStart: page === 0 ? 0 : segments[0]?.start,
      followEnd: next ? JSON.parse(String(next.body)).start : undefined,
      ...(partner ? { partner, owners: rows.map((r) => String(r.transcript_id)) } : {}),
    };
  }
  /** The game transcript read beside a microphone transcript: same recording, other role. */
  private pair(mic: TranscriptSummary, gameId: string) {
    const game = this.get(gameId);
    if (mic.role !== 'mic' || game.role !== 'game' || game.sourceId !== mic.sourceId)
      throw new Error('These transcripts cannot be read together.');
    return game;
  }
  pageAt(id: string, time: number, also?: string, original = false) {
    const transcript = this.get(id);
    if (!Number.isFinite(time) || time < 0 || time > transcript.duration + 1)
      throw new Error('Invalid transcript time.');
    const hidden = (transcriptId: string) =>
      JSON.stringify(original ? [] : [...this.dropped(transcriptId).keys()]);
    const shown = `NOT (transcript_id=? AND ordinal IN (SELECT value FROM json_each(?)))`;
    if (also) {
      // The combined page holding the last phrase, of either transcript, started by `time`.
      const partner = this.pair(transcript, also);
      const before = Number(
        this.db
          .prepare(
            `SELECT count(*) AS n FROM transcript_segments WHERE transcript_id IN (?,?) AND ${shown} AND ${shown} AND json_extract(body,'$.start')<=?`,
          )
          .get(id, partner.id, id, hidden(id), partner.id, hidden(partner.id), time)?.n || 0,
      );
      return Math.floor(Math.max(0, before - 1) / 60);
    }
    const row = this.db
      .prepare(
        "SELECT ordinal FROM transcript_segments WHERE transcript_id=? AND json_extract(body,'$.start')<=? ORDER BY ordinal DESC LIMIT 1",
      )
      .get(id, time);
    const ordinal = Number(row?.ordinal || 0);
    // Pages hold 60 shown lines, so dropped lines before this one move it to an earlier page.
    const dropped = original ? 0 : [...this.dropped(id).keys()].filter((n) => n < ordinal).length;
    return Math.floor((ordinal - dropped) / 60);
  }
  /** Lines in order, without dropped ones unless `all` (VC-166). */
  *segments(id: string, after = -1, backwards = false, all = false): Generator<TranscriptSegment> {
    const dropped = all ? new Map<number, DropReason>() : this.dropped(id);
    // Keep bounded pages, rather than a live SQLite statement across generator yields.
    const statement = this.db.prepare(
      `SELECT ordinal, body FROM transcript_segments WHERE transcript_id=? AND ordinal${backwards ? '<' : '>'}? ORDER BY ordinal ${backwards ? 'DESC' : 'ASC'} LIMIT 200`,
    );
    let cursor = after;
    while (true) {
      const rows = statement.all(id, cursor);
      if (!rows.length) return;
      for (const row of rows)
        if (!dropped.has(Number(row.ordinal))) yield JSON.parse(String(row.body));
      cursor = Number(rows.at(-1)!.ordinal);
    }
  }
  removeSource(id: string) {
    this.db.prepare('DELETE FROM transcripts WHERE source_id=?').run(id);
  }
}
