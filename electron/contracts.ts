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

/** What's new (VC-242): the bottom bar's dot and the one-time pop-up after an update. */
export interface WhatsNewState {
  /** The running version, as the bottom bar shows it (a test build keeps its -N label). */
  version: string;
  /** The release whose notes it runs: 0.4.30 for 0.4.30-71. */
  release: string;
  /** The release on which What's new was last opened. */
  lastOpened?: string;
  /** Notes newer than the last opening: the version number shows a dot. */
  unseen: boolean;
  /** Show the one-time "See what's new" pop-up. */
  announce: boolean;
}
export interface WhatsNewApi {
  state(): Promise<WhatsNewState>;
  /** The window was opened: clears the dot and the pop-up for this release. */
  opened(): Promise<WhatsNewState>;
  /** The pop-up was shown: it doesn't come back for this release. */
  announced(): Promise<WhatsNewState>;
}

export interface VirtualCutApi {
  transcript: import('./transcript-contracts.js').TranscriptApi;
  diagnostics: import('./diagnostic-contracts.js').DiagnosticApi;
  project: import('./project-contracts.js').ProjectApi;
  /** Agent access (VC-160): pairing, activity and the view agents may read. */
  agent: import('./agent-contracts.js').AgentApi;
  whatsNew: WhatsNewApi;
  getAppInfo(): Promise<AppInfo>;
  /** Opens a native picker. Selection does not import, read, or change footage. */
  selectProjectFolder(): Promise<ProjectFolder | null>;
  /** Opens one video for read-only playback, without importing or copying it. */
  openVideo(): Promise<OpenedVideo | null>;
  toggleFullscreen(): Promise<boolean>;
}
