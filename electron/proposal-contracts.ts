/**
 * Agent proposals (VC-161): candidates an agent app submits over MCP. They are stored outside
 * the editable model and Undo, beside spoken-cue candidates, and change nothing until the user
 * accepts one on its cue card. The decision itself is a CueDecision with `proposalId` set.
 */
export type ProposalKind = 'mark' | 'note' | 'cut' | 'clip';
/** The user's intent tags (the {} tags on his notes); general and notion ride as notes. */
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
export interface AgentProposal {
  id: string;
  sourceId: string;
  kind: ProposalKind;
  time: number;
  /** Clip ranges only. */
  end?: number;
  title: string;
  text: string;
  /** Splits only: suggested names for the clips before and after the split. */
  names?: { first: string; second: string };
  reason: string;
  intent?: ProposalIntent;
  evidence: ProposalEvidence[];
  agent: { clientId: string; name: string; model?: string };
  submitted: string;
  submissionId: string;
  projectRevision: number;
}
