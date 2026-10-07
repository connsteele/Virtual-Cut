/**
 * Agent proposals (VC-161): candidates an agent app submits over MCP. They are stored outside
 * the editable model and Undo, beside spoken-cue candidates, and change nothing until the user
 * accepts one on its cue card. The decision itself is a CueDecision with `proposalId` set.
 */
export type ProposalKind = 'mark' | 'note' | 'cut' | 'clip';
/** The user's intent tags (the {} tags on his notes); a proposal may carry several. */
export type ProposalIntent = 'marker' | 'general' | 'notion' | 'edit';
export interface ProposalEvidence {
  role: 'mic' | 'game';
  transcriptId: string;
  lineIds: number[];
  start: number;
  end: number;
  /** The cited lines as they read when the proposal arrived (corrections applied). */
  quote: string;
}
/** Where a {notion} proposal's note goes: a new note, or one already in the user's notes. */
export interface NotionTarget {
  target: 'new' | 'expands' | 'duplicate';
  /** The existing note it expands or repeats, as the user would recognise it. */
  existing?: string;
}
/** The spoken cue an agent proposal reworks, as it was heard (VC-155). */
export interface RefinedCue {
  transcriptId: string;
  track: number;
  lineId: number;
  kind: import('./transcript-contracts.js').CueKind;
  time: number;
  text: string;
}
export interface AgentProposal {
  id: string;
  sourceId: string;
  kind: ProposalKind;
  time: number;
  /** Clip ranges and range markers. */
  end?: number;
  title: string;
  text: string;
  /** Splits only: suggested names for the clips before and after the split. */
  names?: { first: string; second: string };
  reason: string;
  /** The first intent; kept for proposals stored before `intents` (0.4.18). */
  intent?: ProposalIntent;
  intents?: ProposalIntent[];
  notion?: NotionTarget;
  refines?: RefinedCue;
  evidence: ProposalEvidence[];
  agent: { clientId: string; name: string; model?: string };
  submitted: string;
  submissionId: string;
  projectRevision: number;
}
