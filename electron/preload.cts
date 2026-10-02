import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { VirtualCutApi } from './contracts.js' with { 'resolution-mode': 'import' };

// Sandboxed preloads cannot require arbitrary local modules. Keep runtime
// imports confined to Electron; the shared contract is erased by TypeScript.
const api: VirtualCutApi = {
  transcript: {
    open: (source) => ipcRenderer.invoke('transcript:open', source),
    onSource: (callback) => {
      const f = (_event: Electron.IpcRendererEvent, source: string) => callback(source);
      ipcRenderer.on('transcript:source-event', f);
      return () => ipcRenderer.removeListener('transcript:source-event', f);
    },
    session: (source) => ipcRenderer.invoke('transcript:session', source),
    page: (id, transcriptId, page, search) =>
      ipcRenderer.invoke('transcript:page', id, transcriptId, page, search),
    runtime: () => ipcRenderer.invoke('transcript:runtime'),
    configure: (part, device) => ipcRenderer.invoke('transcript:configure', part, device),
    start: (id, source, batch, options) =>
      ipcRenderer.invoke('transcript:start', id, source, batch, options),
    job: (id, job, action) => ipcRenderer.invoke('transcript:job', id, job, action),
    seek: (id, source, time) => ipcRenderer.invoke('transcript:seek', id, source, time),
    command: (command) => ipcRenderer.invoke('transcript:command', command),
    apply: (token) => ipcRenderer.invoke('transcript:apply', token),
    finishCommand: (token, error) => ipcRenderer.send('transcript:finishCommand', token, error),
    position: (id, source, time) => ipcRenderer.send('transcript:position', id, source, time),
    onSeek: (callback) => {
      const f = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) =>
        callback(value);
      ipcRenderer.on('transcript:seek-event', f);
      return () => ipcRenderer.removeListener('transcript:seek-event', f);
    },
    onCommand: (callback) => {
      const f = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) =>
        callback(value);
      ipcRenderer.on('transcript:command-event', f);
      return () => ipcRenderer.removeListener('transcript:command-event', f);
    },
    onPosition: (callback) => {
      const f = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) =>
        callback(value);
      ipcRenderer.on('transcript:position-event', f);
      return () => ipcRenderer.removeListener('transcript:position-event', f);
    },
    export: (id, transcriptId, format, exportId) =>
      ipcRenderer.invoke('transcript:export', id, transcriptId, format, exportId),
  },
  diagnostics: {
    summary: () => ipcRenderer.invoke('diagnostics:summary'),
    copy: () => ipcRenderer.invoke('diagnostics:copy'),
    openLogs: () => ipcRenderer.invoke('diagnostics:open'),
    export: () => ipcRenderer.invoke('diagnostics:export'),
    playback: (event) => ipcRenderer.send('diagnostics:playback', event),
  },
  project: {
    installResolveHelper: () => ipcRenderer.invoke('workspace:installResolveHelper'),
    resolveHelperStatus: () => ipcRenderer.invoke('workspace:resolveHelperStatus'),
    removeResolveHelper: () => ipcRenderer.invoke('workspace:removeResolveHelper'),
    revealResolveHelper: () => ipcRenderer.invoke('workspace:revealResolveHelper'),
    storageUsage: (id) => ipcRenderer.invoke('workspace:storageUsage', id),
    deletionPlan: (id) => ipcRenderer.invoke('workspace:deletionPlan', id),
    deleteProject: (id, token, cleanup) =>
      ipcRenderer.invoke('workspace:deleteProject', id, token, cleanup),
    recover: () => ipcRenderer.invoke('workspace:recover'),
    chooseDestination: (id, folder) =>
      ipcRenderer.invoke('workspace:chooseDestination', id, folder),
    revealDestination: (id, folder) =>
      ipcRenderer.invoke('workspace:revealDestination', id, folder),
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
    autosave: (id) => ipcRenderer.invoke('workspace:autosave', id),
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
    filingPlan: (id, batchId) => ipcRenderer.invoke('workspace:filingPlan', id, batchId),
    fileQueue: (id, planId, confirmed) =>
      ipcRenderer.invoke('workspace:fileQueue', id, planId, confirmed),
    cancelFiling: (id, queueId) => ipcRenderer.invoke('workspace:cancelFiling', id, queueId),
    retainedMedia: (id, exportId) => ipcRenderer.invoke('workspace:retainedMedia', id, exportId),
    inspectRetained: (id, exportId, token) =>
      ipcRenderer.invoke('workspace:inspectRetained', id, exportId, token),
    releaseRetained: (id, token) => ipcRenderer.invoke('workspace:releaseRetained', id, token),
    relinkExport: (id, exportId) => ipcRenderer.invoke('workspace:relinkExport', id, exportId),
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
