/** What an agent app may know about the screen. Reported by the main window only. */
export interface AgentView {
  projectId: string;
  page: string;
  recordingId?: string;
  playhead?: number;
  clipId?: string;
  markerId?: string;
}
export interface AgentClient {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  paired: string;
  lastUsed?: string;
  connected?: boolean;
}
export interface AgentActivity {
  at: string;
  clientId: string;
  clientName: string;
  tool: string;
  summary: string;
  outcome: 'read' | 'proposed' | 'withdrew' | 'amended' | 'refused';
  /** Picture calls only: how many images were sent, and their estimated tokens. */
  images?: number;
  imageTokens?: number;
}
export interface AgentAccessState {
  enabled: boolean;
  /**
   * Allow pictures (VC-195): one switch for every paired app. Whether agent apps may receive
   * rendered pictures (VC-172 look). Off until the user turns it on in the Agent panel; only
   * the main window changes it.
   */
  pictures: boolean;
  /** Listening for agent apps; false with a message when the pipe could not be opened. */
  listening: boolean;
  message?: string;
  clients: AgentClient[];
  activity: AgentActivity[];
}
export interface AgentPairing {
  client: AgentClient;
  /** Shown once. Only a hash is stored. */
  token: string;
  /** One line for `claude mcp add`, and the same launch as JSON for Claude Desktop. */
  claudeCode: string;
  claudeDesktop: string;
}
export interface AgentApi {
  state(): Promise<AgentAccessState>;
  setEnabled(enabled: boolean): Promise<AgentAccessState>;
  pair(projectId: string, name: string): Promise<AgentPairing>;
  revoke(clientId: string): Promise<AgentAccessState>;
  setPictures(allowed: boolean): Promise<AgentAccessState>;
  copy(text: string): Promise<void>;
  view(view: AgentView): void;
  onChanged(callback: () => void): () => void;
}
