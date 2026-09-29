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

export interface VirtualCutApi {
  getAppInfo(): Promise<AppInfo>;
  /** Opens a native picker. Selection does not import, read, or change footage. */
  selectProjectFolder(): Promise<ProjectFolder | null>;
}
