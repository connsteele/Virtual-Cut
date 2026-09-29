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
}

export interface VirtualCutApi {
  project: import('./project-contracts.js').ProjectApi;
  getAppInfo(): Promise<AppInfo>;
  /** Opens a native picker. Selection does not import, read, or change footage. */
  selectProjectFolder(): Promise<ProjectFolder | null>;
  /** Opens one video for read-only playback, without importing or copying it. */
  openVideo(): Promise<OpenedVideo | null>;
  toggleFullscreen(): Promise<boolean>;
}
