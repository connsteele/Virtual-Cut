import type { Model } from './workflow-types.js';
import type {
  ExportContainerChoice,
  ExportPlan,
  ExportRecord,
  FilingPlan,
  RetainedClip,
  SubtitleRole,
  TranscriptOutputs,
} from './export-contracts.js';

export interface Batch {
  id: string;
  name: string;
  created: string;
  audioDefaults?: ImportAudio;
}
/** One-based audio stream order, independent of video/subtitle stream indices. */
export interface ImportAudio {
  transcription?: import('./transcript-contracts.js').TranscriptionOptions;
  game: number | null;
  mic: number | null;
}
export interface DroppedImport {
  token: string;
  count: number;
  skipped: number;
  issues: { name: string; reason: string }[];
}
export interface SaveCopy {
  id: string;
  kind: 'auto' | 'manual' | 'migration';
  created: string;
}
export interface ProjectInfo {
  id: string;
  name: string;
  file: string;
  destination: string;
  cache: string;
}
export interface MediaJob {
  device?: 'cpu' | 'cuda';
  deviceMessage?: string;
  started?: string;
  elapsedMs?: number;
  id: string;
  sourceId: string;
  /** 'proxy' makes a recording's playback proxy (VC-237). */
  kind: 'inspect' | 'audio' | 'export' | 'transcribe' | 'visual' | 'text' | 'proxy';
  /** The picture pass (VC-180): what it decodes with right now. The screen text pass (VC-141):
   * whether the engine reads on the GPU (DirectML) or the CPU. */
  use?: import('./visual-events.js').VisualUse;
  /** Who started the job; user work goes first in its lane (VC-145). Older jobs have none. */
  origin?: 'user' | 'background';
  transcription?: import('./transcript-contracts.js').TranscriptRequest;
  role?: 'game' | 'mic';
  runtimeSignature?: string;
  track?: number;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  progress: number;
  message: string;
  updated: string;
}
export interface ProjectSnapshot {
  project: ProjectInfo;
  batches: Batch[];
  activeBatchId: string;
  revision: number;
  model: Model;
  jobs: MediaJob[];
  exports: ExportRecord[];
  library?: RetainedClip[];
  canUndo: boolean;
  canRedo: boolean;
  unsavedChanges: boolean;
  unsavedEdits: boolean;
  savedAt: number;
  saves?: SaveCopy[];
  warning?: string;
  recoveryNotice?: string;
  destinations?: import('./review-plan.js').DestinationPlan;
  /** Roles with a finished transcript, by recording id; export and filing offer SRT for these. */
  transcriptRoles?: Record<string, SubtitleRole[]>;
  /** Filmstrip tile files by recording id: ready, being made, or waiting their turn. */
  filmstrips?: Record<string, 'ready' | 'making' | 'waiting'>;
  /** Stored picture events by recording id (VC-180): how they were read and what was found. */
  pictures?: Record<string, import('./visual-events.js').VisualSummary>;
  /** Stored screen text by recording id (VC-141): how many lines, and how it was read. */
  screenText?: Record<string, import('./screen-text.js').ScreenTextSummary>;
  /** Why screen text cannot be read right now ("Screen text engine not installed."), or ''. */
  screenTextEngine?: string;
  cleanup?: {
    cacheFilesRemoved: number;
    cacheFilesRetained: number;
    cacheCleanupIncomplete?: boolean;
  };
}
export interface RecentProject {
  id: string;
  name: string;
  file: string;
}
export interface ProjectDeletionPlan {
  token: string;
  id: string;
  name: string;
  file: string;
  files: { path: string; kind: 'project' | 'save' | 'preview'; bytes: number }[];
  retained: string[];
  retainedDetails: { path: string; reason: string; group: string }[];
}
export interface ProjectStorageUsage {
  measuredAt: string;
  rows: { id: string; label: string; files: number; bytes: number; unavailable: number }[];
  issues: string[];
}
export interface ProjectApi {
  storageUsage(id: string): Promise<ProjectStorageUsage>;
  deletionPlan(id: string): Promise<ProjectDeletionPlan>;
  deleteProject(
    id: string,
    token: string,
    cleanup: boolean,
  ): Promise<{ removed: number; bytes: number; retained: string[] }>;
  installResolveHelper(): Promise<string>;
  resolveHelperStatus(): Promise<ResolveHelperStatus>;
  removeResolveHelper(): Promise<ResolveHelperStatus>;
  revealResolveHelper(): Promise<void>;
  filingPlan(id: string, batchId: string): Promise<FilingPlan>;
  fileQueue(
    id: string,
    planId: string,
    confirmed: boolean,
    transcript?: TranscriptOutputs,
  ): Promise<ProjectSnapshot>;
  cancelFiling(id: string, queueId: string): Promise<ProjectSnapshot>;
  retainedMedia(id: string, exportId: string): Promise<RetainedClip>;
  inspectRetained(
    id: string,
    exportId: string,
    token: string,
  ): Promise<import('./workflow-types.js').Recording>;
  releaseRetained(id: string, token: string): Promise<void>;
  relinkExport(id: string, exportId: string): Promise<ProjectSnapshot | null>;
  chooseDestination(id: string, folder: string): Promise<string | null>;
  revealDestination(id: string, folder: string): Promise<void>;
  acceptReview(id: string, clipId: string): Promise<ProjectSnapshot>;
  destinationPlan(id: string): Promise<import('./review-plan.js').DestinationPlan>;
  destinationFolders(
    id: string,
    folder: string,
  ): Promise<import('./review-plan.js').DestinationFolders>;
  filmstrip(
    id: string,
    sourceId: string,
    times: number[],
    token: string,
  ): Promise<FilmstripFrame[]>;
  cancelFilmstrip(id: string, token: string, release?: boolean): Promise<void>;
  /** Inspected timestamps for one recording; null until inspection or after the file changes. */
  frameIndex(id: string, sourceId: string): Promise<import('./frame-index.js').FrameIndex | null>;
  onCloseRequested(callback: () => void): () => void;
  /** Native project state changed (jobs, exports, inspection, saves); refresh the snapshot. */
  onChanged(callback: () => void): () => void;
  finishClose(): Promise<void>;
  recent(): Promise<RecentProject[]>;
  create(name: string): Promise<ProjectSnapshot | null>;
  open(id?: string): Promise<ProjectSnapshot | null>;
  recover(): Promise<ProjectSnapshot | null>;
  current(): Promise<ProjectSnapshot | null>;
  close(): Promise<void>;
  save(id: string, before: Model, after: Model): Promise<ProjectSnapshot>;
  checkpoint(id: string): Promise<ProjectSnapshot>;
  autosave(id: string): Promise<ProjectSnapshot>;
  restore(id: string, saveId: string): Promise<ProjectSnapshot>;
  revealSave(id: string, saveId: string): Promise<void>;
  revealSource(id: string, sourceId: string): Promise<void>;
  history(id: string, direction: 'undo' | 'redo'): Promise<ProjectSnapshot>;
  /**
   * VC-194: what a game's Heard as rows would correct in this project's finished transcripts of
   * that game; with `apply`, makes those corrections as one edit and returns the new snapshot.
   */
  heardAs(
    id: string,
    gameId: string,
    rows: import('./heard-as.js').HeardAs[],
    apply?: boolean,
  ): Promise<{
    preview: { transcripts: number; words: number; own: number; heard: string[] };
    snapshot?: ProjectSnapshot;
  }>;
  batch(id: string, name: string): Promise<ProjectSnapshot>;
  selectBatch(id: string, batchId: string): Promise<ProjectSnapshot>;
  removeRecording(id: string, batchId: string, sourceId: string): Promise<ProjectSnapshot>;
  deleteBatch(
    id: string,
    batchId: string,
    targetId?: string,
    mode?: 'preserve' | 'remove',
  ): Promise<ProjectSnapshot>;
  import(
    id: string,
    batchId: string,
    kind: 'files' | 'folder',
    audio?: ImportAudio,
  ): Promise<ProjectSnapshot | null>;
  stageDrop(id: string, batchId: string, files: File[]): Promise<DroppedImport>;
  discardDrop(token: string): Promise<void>;
  importDrop(
    id: string,
    batchId: string,
    token: string,
    audio: ImportAudio,
  ): Promise<ProjectSnapshot>;
  relink(id: string, sourceId: string): Promise<ProjectSnapshot | null>;
  audio(id: string, sourceId: string): Promise<ProjectSnapshot>;
  job(id: string, jobId: string, action: 'cancel' | 'retry'): Promise<ProjectSnapshot>;
  /** Analyse picture now (VC-180): queue the picture pass ahead of other background work. */
  analysePicture(id: string, sourceIds: string[]): Promise<ProjectSnapshot>;
  /** The app's preview started or stopped playing; the picture pass leaves it the decoder. */
  previewPlaying(playing: boolean): Promise<void>;
  exportPlan(id: string, clipId: string, container: ExportContainerChoice): Promise<ExportPlan>;
  exportClip(
    id: string,
    planId: string,
    cleanGameConfirmed: boolean,
    transcript?: TranscriptOutputs,
  ): Promise<ProjectSnapshot | null>;
  revealExport(id: string, exportId: string, kind: 'video' | 'metadata'): Promise<void>;
}
export interface ResolveHelperStatus {
  state: 'missing' | 'installed' | 'outdated' | 'unmanaged' | 'customized';
  file: string;
}
export interface FilmstripFrame {
  requested: number;
  time: number;
  data: string;
  /** Read from the recording's tile file rather than decoded for this request. */
  stored?: boolean;
}
