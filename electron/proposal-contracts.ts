/**
 * Agent proposals (VC-161): candidates an agent app submits over MCP. They are stored outside
 * the editable model and Undo, beside spoken-cue candidates, and change nothing until the user
 * accepts one on its cue card. The decision itself is a CueDecision with `proposalId` set.
 */
export type ProposalKind = 'mark' | 'note' | 'cut' | 'clip' | 'edit';
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
  /** Markers and clip ranges: the marker color suggested (VC-200), one of Resolve's 16. */
  color?: import('./workflow-types.js').MarkerColor;
  /** Clip ranges: the Resolve clip color suggested for the clip accepting makes (VC-204). */
  clipColor?: import('./workflow-types.js').ClipColor;
  /** A change to a marker or clip already in the project (VC-204); kind `edit`. */
  edit?: ProposalEdit;
  /**
   * The agent's earlier versions of this card, oldest first (VC-204 `amend_proposal`). The
   * proposal itself is the newest; its version number is `versions.length + 1`.
   */
  versions?: ProposalVersion[];
  /** When the agent last amended it, and why (VC-204). */
  amended?: { at: string; reason?: string };
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
  /**
   * The agent took it back before the user decided it (VC-201): it leaves review but stays
   * stored, labelled as the agent's own withdrawal rather than the user's rejection.
   */
  withdrawn?: ProposalWithdrawal;
}
export interface ProposalWithdrawal {
  at: string;
  /** The paired app that withdrew it, always the app that submitted it. */
  clientId: string;
  reason?: string;
}
/**
 * The fields a change proposal touches (VC-204). For a clip, `time` is its start and `color` its
 * Resolve clip color (`null` clears it); for a marker `color` is a marker color and `end: null`
 * makes a range marker a point marker again.
 */
export interface EditFields {
  name?: string;
  time?: number;
  end?: number | null;
  color?: string | null;
  note?: string;
}
export interface ProposalEdit {
  target: 'marker' | 'clip';
  targetId: string;
  /** The touched fields as the agent saw them when it proposed the change. */
  seen: EditFields;
  /** The values it proposes. */
  set: EditFields;
}
/** One earlier version of an amended proposal: what the card said before the amend. */
export interface ProposalVersion {
  /** When this version was made: submitted, or amended into. */
  at: string;
  /** Why the agent amended the card into this version, when it said (never for the first). */
  reason?: string;
  values: ProposalValues;
}
export type ProposalValues = Pick<
  AgentProposal,
  'time' | 'end' | 'title' | 'text' | 'names' | 'color' | 'clipColor' | 'edit' | 'reason'
>;
