/** Data-only boundary shared by the renderer and the desktop process. */
export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  isPackaged: boolean;
}

export interface ProjectFolder {
  name: string;
  path: string;
}

export interface OpenedVideo {
  id: string;
  name: string;
  bytes: number;
  /** Opaque, session-only URL. Only the native picker grants access. */
  url: string;
  /** A lossless copy of audio Chromium cannot play (ALAC, PCM), heard beside the muted video. */
  audio?: { url: string; offset: number };
}

export interface VirtualCutApi {
  transcript: import('./transcript-contracts.js').TranscriptApi;
  diagnostics: import('./diagnostic-contracts.js').DiagnosticApi;
  project: import('./project-contracts.js').ProjectApi;
  /** Agent access (VC-160): pairing, activity and the view agents may read. */
  agent: import('./agent-contracts.js').AgentApi;
  getAppInfo(): Promise<AppInfo>;
  /** Opens a native picker. Selection does not import, read, or change footage. */
  selectProjectFolder(): Promise<ProjectFolder | null>;
  /** Opens one video for read-only playback, without importing or copying it. */
  openVideo(): Promise<OpenedVideo | null>;
  toggleFullscreen(): Promise<boolean>;
}
