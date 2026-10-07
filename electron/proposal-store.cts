import type { DatabaseSync } from 'node:sqlite';
import type { AgentProposal } from './proposal-contracts.js' with { 'resolution-mode': 'import' };

/** Schema 6 (VC-161): agent proposals, outside the editorial snapshot and Undo journal. */
export function createProposalSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_proposals (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL, body TEXT NOT NULL)`);
}
/** The most proposals one recording keeps; a submission past it is refused. */
export const proposalLimit = 2000;

/** Proposals are append-only: decisions live in the model, so Undo never loses a proposal. */
export class ProposalStore {
  /** Fills in what stored proposals imply (the spoken cue an agent reworked, VC-155). */
  infer?: (proposals: AgentProposal[]) => AgentProposal[];
  constructor(private db: DatabaseSync) {
    createProposalSchema(db);
  }
  list(sourceId?: string): AgentProposal[] {
    const stored = this.stored(sourceId);
    return this.infer ? this.infer(stored) : stored;
  }
  private stored(sourceId?: string): AgentProposal[] {
    return (
      sourceId
        ? this.db
            .prepare('SELECT body FROM agent_proposals WHERE source_id=? ORDER BY rowid')
            .all(sourceId)
        : this.db.prepare('SELECT body FROM agent_proposals ORDER BY rowid').all()
    ).map((r) => JSON.parse(String(r.body)));
  }
  get(id: string): AgentProposal {
    const row = this.db.prepare('SELECT source_id FROM agent_proposals WHERE id=?').get(id);
    const proposal = row && this.list(String(row.source_id)).find((p) => p.id === id);
    if (!proposal) throw new Error('This proposal is no longer available. Reopen the transcript.');
    return proposal;
  }
  count(sourceId: string) {
    return Number(
      this.db.prepare('SELECT count(*) AS n FROM agent_proposals WHERE source_id=?').get(sourceId)
        ?.n || 0,
    );
  }
  /** All or nothing: a submission never lands half-stored. */
  add(proposals: AgentProposal[]) {
    const put = this.db.prepare('INSERT INTO agent_proposals (id, source_id, body) VALUES (?,?,?)');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const p of proposals) put.run(p.id, p.sourceId, JSON.stringify(p));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  /** Restoring a save copy keeps today's proposals and brings back any the copy holds. */
  merge(proposals: AgentProposal[]) {
    const put = this.db.prepare(
      'INSERT OR IGNORE INTO agent_proposals (id, source_id, body) VALUES (?,?,?)',
    );
    for (const p of proposals) put.run(p.id, p.sourceId, JSON.stringify(p));
  }
  removeSource(id: string) {
    this.db.prepare('DELETE FROM agent_proposals WHERE source_id=?').run(id);
  }
}
