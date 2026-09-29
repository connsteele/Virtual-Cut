import { contextBridge, ipcRenderer } from 'electron';
import type { VirtualCutApi } from './contracts.js' with { 'resolution-mode': 'import' };

// Sandboxed preloads cannot require arbitrary local modules. Keep runtime
// imports confined to Electron; the shared contract is erased by TypeScript.
const api: VirtualCutApi = {
  project: {
    onCloseRequested: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('workspace:closing', listener);
      return () => ipcRenderer.removeListener('workspace:closing', listener);
    },
    finishClose: () => ipcRenderer.invoke('workspace:finish-close'),
    recent: () => ipcRenderer.invoke('workspace:recent'),
    create: (name) => ipcRenderer.invoke('workspace:create', name),
    open: (id) => ipcRenderer.invoke('workspace:open', id),
    current: () => ipcRenderer.invoke('workspace:current'),
    close: () => ipcRenderer.invoke('workspace:close'),
    save: (id, before, after) => ipcRenderer.invoke('workspace:save', id, before, after),
    checkpoint: (id) => ipcRenderer.invoke('workspace:checkpoint', id),
    restore: (id, saveId) => ipcRenderer.invoke('workspace:restore', id, saveId),
    history: (id, direction) => ipcRenderer.invoke('workspace:history', id, direction),
    batch: (id, name) => ipcRenderer.invoke('workspace:batch', id, name),
    selectBatch: (id, batchId) => ipcRenderer.invoke('workspace:select-batch', id, batchId),
    import: (id, batchId, kind, audio) =>
      ipcRenderer.invoke('workspace:import', id, batchId, kind, audio),
    relink: (id, sourceId) => ipcRenderer.invoke('workspace:relink', id, sourceId),
    audio: (id, sourceId) => ipcRenderer.invoke('workspace:audio', id, sourceId),
    job: (id, jobId, action) => ipcRenderer.invoke('workspace:job', id, jobId, action),
  },
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  selectProjectFolder: () => ipcRenderer.invoke('project:select-folder'),
  openVideo: () => ipcRenderer.invoke('media:open-video'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
};

contextBridge.exposeInMainWorld('virtualCut', Object.freeze(api));
