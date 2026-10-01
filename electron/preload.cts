import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { VirtualCutApi } from './contracts.js' with { 'resolution-mode': 'import' };

// Sandboxed preloads cannot require arbitrary local modules. Keep runtime
// imports confined to Electron; the shared contract is erased by TypeScript.
const api: VirtualCutApi = {
  diagnostics: {
    summary: () => ipcRenderer.invoke('diagnostics:summary'),
    copy: () => ipcRenderer.invoke('diagnostics:copy'),
    openLogs: () => ipcRenderer.invoke('diagnostics:open'),
    export: () => ipcRenderer.invoke('diagnostics:export'),
    playback: (event) => ipcRenderer.send('diagnostics:playback', event),
  },
  project: {
    acceptReview: (id, clipId) => ipcRenderer.invoke('workspace:acceptReview', id, clipId),
    destinationPlan: (id) => ipcRenderer.invoke('workspace:destinationPlan', id),
    destinationFolders: (id, folder) =>
      ipcRenderer.invoke('workspace:destinationFolders', id, folder),
    filmstrip: (id, sourceId, times, token) =>
      ipcRenderer.invoke('workspace:filmstrip', id, sourceId, times, token),
    cancelFilmstrip: (id, token, release) =>
      ipcRenderer.invoke('workspace:cancelFilmstrip', id, token, release),
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
    revealSave: (id, saveId) => ipcRenderer.invoke('workspace:revealSave', id, saveId),
    revealSource: (id, sourceId) => ipcRenderer.invoke('workspace:revealSource', id, sourceId),
    history: (id, direction) => ipcRenderer.invoke('workspace:history', id, direction),
    batch: (id, name) => ipcRenderer.invoke('workspace:batch', id, name),
    selectBatch: (id, batchId) => ipcRenderer.invoke('workspace:select-batch', id, batchId),
    removeRecording: (id, batchId, sourceId) =>
      ipcRenderer.invoke('workspace:removeRecording', id, batchId, sourceId),
    deleteBatch: (id, batchId, targetId, mode) =>
      ipcRenderer.invoke('workspace:delete-batch', id, batchId, targetId, mode),
    import: (id, batchId, kind, audio) =>
      ipcRenderer.invoke('workspace:import', id, batchId, kind, audio),
    stageDrop: (id, batchId, files) => {
      if (!Array.isArray(files) || files.length > 10000)
        return Promise.reject(new Error('Drop up to 10,000 video files at a time.'));
      // Only native File objects from a drop or file input yield filesystem paths.
      // Paths stay inside the preload/main boundary, never in renderer state.
      return ipcRenderer.invoke(
        'workspace:stageDrop',
        id,
        batchId,
        files.map((file) => ({
          name: file.name,
          path: webUtils.getPathForFile(file),
        })),
      );
    },
    discardDrop: (token) => ipcRenderer.invoke('workspace:discardDrop', token),
    importDrop: (id, batchId, token, audio) =>
      ipcRenderer.invoke('workspace:importDrop', id, batchId, token, audio),
    relink: (id, sourceId) => ipcRenderer.invoke('workspace:relink', id, sourceId),
    audio: (id, sourceId) => ipcRenderer.invoke('workspace:audio', id, sourceId),
    job: (id, jobId, action) => ipcRenderer.invoke('workspace:job', id, jobId, action),
    exportPlan: (id, clipId, container) =>
      ipcRenderer.invoke('workspace:exportPlan', id, clipId, container),
    exportClip: (id, planId, confirmed) =>
      ipcRenderer.invoke('workspace:exportClip', id, planId, confirmed),
    revealExport: (id, exportId, kind) =>
      ipcRenderer.invoke('workspace:revealExport', id, exportId, kind),
  },
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  selectProjectFolder: () => ipcRenderer.invoke('project:select-folder'),
  openVideo: () => ipcRenderer.invoke('media:open-video'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
};

contextBridge.exposeInMainWorld('virtualCut', Object.freeze(api));
