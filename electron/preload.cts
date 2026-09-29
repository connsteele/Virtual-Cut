import { contextBridge, ipcRenderer } from 'electron';
import type { VirtualCutApi } from './contracts.js' with { 'resolution-mode': 'import' };

// Sandboxed preloads cannot require arbitrary local modules. Keep runtime
// imports confined to Electron; the shared contract is erased by TypeScript.
const api: VirtualCutApi = {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  selectProjectFolder: () => ipcRenderer.invoke('project:select-folder'),
};

contextBridge.exposeInMainWorld('virtualCut', Object.freeze(api));
