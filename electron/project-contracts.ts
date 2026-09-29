import type { Model } from './workflow-types.js';

export interface Batch {
  id: string;
  name: string;
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
  id: string;
  sourceId: string;
  kind: 'inspect' | 'audio';
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
  canUndo: boolean;
  canRedo: boolean;
  warning?: string;
}
export interface RecentProject {
  id: string;
  name: string;
  file: string;
}
export interface ProjectApi {
  onCloseRequested(callback: () => void): () => void;
  finishClose(): Promise<void>;
  recent(): Promise<RecentProject[]>;
  create(name: string): Promise<ProjectSnapshot | null>;
  open(id?: string): Promise<ProjectSnapshot | null>;
  current(): Promise<ProjectSnapshot | null>;
  close(): Promise<void>;
  save(id: string, before: Model, after: Model): Promise<ProjectSnapshot>;
  history(id: string, direction: 'undo' | 'redo'): Promise<ProjectSnapshot>;
  batch(id: string, name: string): Promise<ProjectSnapshot>;
  selectBatch(id: string, batchId: string): Promise<ProjectSnapshot>;
  import(id: string, batchId: string, kind: 'files' | 'folder'): Promise<ProjectSnapshot | null>;
  relink(id: string, sourceId: string): Promise<ProjectSnapshot | null>;
  audio(id: string, sourceId: string): Promise<ProjectSnapshot>;
  job(id: string, jobId: string, action: 'cancel' | 'retry'): Promise<ProjectSnapshot>;
}
