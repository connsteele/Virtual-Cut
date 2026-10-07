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
  outcome: 'read' | 'proposed' | 'refused';
}
export interface AgentAccessState {
  enabled: boolean;
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
  copy(text: string): Promise<void>;
  view(view: AgentView): void;
  onChanged(callback: () => void): () => void;
}
