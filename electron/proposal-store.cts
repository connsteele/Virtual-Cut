import type { DatabaseSync } from 'node:sqlite';
import type { AgentProposal, ProposalWithdrawal } from './proposal-contracts.js' with {
  'resolution-mode': 'import',
};

/** Schema 6 (VC-161): agent proposals, outside the editorial snapshot and Undo journal. */
export function createProposalSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_proposals (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL, body TEXT NOT NULL)`);
}
/** The most proposals one recording keeps; a submission past it is refused. */
export const proposalLimit = 2000;

/**
 * Proposals are append-only: decisions live in the model, so Undo never loses a proposal. The
 * one change a stored proposal takes is its agent withdrawing it (VC-201).
 */
export class ProposalStore {
  /** Fills in what stored proposals imply (the spoken cue an agent reworked, VC-155). */
  infer?: (proposals: AgentProposal[]) => AgentProposal[];
  /** The user's decisions: a decided proposal stays listed even if withdrawn (VC-201). */
  decisions?: () => { proposalId?: string }[];
  constructor(private db: DatabaseSync) {
    createProposalSchema(db);
  }
  /**
   * The proposals in review or decided. Withdrawn ones are left out (they claim no spoken cue
   * and show no card) unless `withdrawn` asks for every stored proposal.
   */
  list(sourceId?: string, options: { withdrawn?: boolean } = {}): AgentProposal[] {
    const stored = this.stored(sourceId);
    const decided = new Set((this.decisions?.() || []).map((d) => d.proposalId));
    const open = stored.filter((p) => !p.withdrawn || decided.has(p.id));
    const inferred = this.infer ? this.infer(open) : open;
    if (!options.withdrawn) return inferred;
    const byId = new Map(inferred.map((p) => [p.id, p]));
    return stored.map((p) => byId.get(p.id) ?? p);
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
  /** The recording a stored proposal belongs to, withdrawn or not. */
  sourceOf(id: string) {
    const row = this.db.prepare('SELECT source_id FROM agent_proposals WHERE id=?').get(id);
    return row ? String(row.source_id) : undefined;
  }
  /** Marks proposals withdrawn by their agent, all or nothing (VC-201). */
  withdraw(ids: string[], withdrawal: ProposalWithdrawal) {
    const get = this.db.prepare('SELECT body FROM agent_proposals WHERE id=?');
    const put = this.db.prepare('UPDATE agent_proposals SET body=? WHERE id=?');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const id of ids) {
        const row = get.get(id);
        if (!row) throw new Error(`No stored proposal "${id}".`);
        const stored = JSON.parse(String(row.body)) as AgentProposal;
        put.run(JSON.stringify({ ...stored, withdrawn: withdrawal }), id);
      }
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
