import type { Model } from './workflow-types.js';
import type { ExportContainerChoice, ExportPlan, ExportRecord } from './export-contracts.js';

export interface Batch {
  id: string;
  name: string;
  created: string;
  audioDefaults?: ImportAudio;
}
/** One-based audio stream order, independent of video/subtitle stream indices. */
export interface ImportAudio {
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
  kind: 'auto' | 'manual';
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
  started?: string;
  elapsedMs?: number;
  id: string;
  sourceId: string;
  kind: 'inspect' | 'audio' | 'export';
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
  canUndo: boolean;
  canRedo: boolean;
  saves?: SaveCopy[];
  warning?: string;
  destinations?: import('./review-plan.js').DestinationPlan;
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
export interface ProjectApi {
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
  onCloseRequested(callback: () => void): () => void;
  finishClose(): Promise<void>;
  recent(): Promise<RecentProject[]>;
  create(name: string): Promise<ProjectSnapshot | null>;
  open(id?: string): Promise<ProjectSnapshot | null>;
  current(): Promise<ProjectSnapshot | null>;
  close(): Promise<void>;
  save(id: string, before: Model, after: Model): Promise<ProjectSnapshot>;
  checkpoint(id: string): Promise<ProjectSnapshot>;
  restore(id: string, saveId: string): Promise<ProjectSnapshot>;
  revealSave(id: string, saveId: string): Promise<void>;
  revealSource(id: string, sourceId: string): Promise<void>;
  history(id: string, direction: 'undo' | 'redo'): Promise<ProjectSnapshot>;
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
  exportPlan(id: string, clipId: string, container: ExportContainerChoice): Promise<ExportPlan>;
  exportClip(
    id: string,
    planId: string,
    cleanGameConfirmed: boolean,
  ): Promise<ProjectSnapshot | null>;
  revealExport(id: string, exportId: string, kind: 'video' | 'metadata'): Promise<void>;
}
export interface FilmstripFrame {
  requested: number;
  time: number;
  data: string;
}
