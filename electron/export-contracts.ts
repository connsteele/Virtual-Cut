import type { Clip, Marker } from './workflow-types.js';

export type ExportContainer = 'mp4' | 'mkv' | 'mov' | 'm4v' | 'webm';
export type ExportContainerChoice = 'source' | 'mp4' | 'mkv';
export interface ExportPlan {
  id: string;
  clipId: string;
  sourceId: string;
  name: string;
  sourceName: string;
  gameTrack: number;
  container: ExportContainer;
  requested: { start: number; end: number };
  planned: { start: number; end: number };
  revision: number;
  created: string;
}
export interface ExportInput {
  clip: Clip;
  markers: Marker[];
  context: string;
  gameTrack: number;
  micTrack: number | null;
  sourceFile: string;
  sourceFingerprint: string;
  sourceBytes: number;
  sourceModified: number;
  sourceStart: number;
  duration: number;
  captureTime?: string;
}
export interface ExportVerification {
  actual: { start: number; end: number };
  videoStart: number;
  timestampShift: number;
  tolerance: number;
  maxTimingError: number;
  videoPackets: number;
  audioPackets: number;
  videoCodec: string;
  /** Present only when original packet durations and presentation gaps are uniform. */
  constantFrameDuration?: number;
  audioCodec: string;
  bytes: number;
  sha256: string;
}
/** Which finished transcript an SRT is written from (VC-94). */
export type SubtitleRole = 'game' | 'mic';
export interface SubtitleSidecars {
  requested: SubtitleRole[];
  written: { role: SubtitleRole; transcriptId: string; file: string; sha256: string }[];
  /** Plain reasons a requested SRT was not written; the verified video is unaffected. */
  skipped: string[];
}
export interface ExportRecord {
  /** Native filing receipt, retained independently of editorial Undo and save restore. */
  filing?: {
    queueId: string;
    batchId: string;
    reviewKey: string;
    root: string;
    folder: string;
    state: 'queued' | 'complete';
    completedAt?: string;
    media?: { width?: number; height?: number; fps?: number };
  };
  annotationVersion?: 1 | 2 | 3 | 4;
  started?: string;
  elapsedMs?: number;
  plan: ExportPlan;
  input: ExportInput;
  inputHash: string;
  state: 'planned' | 'queued' | 'running' | 'verified' | 'failed' | 'cancelled' | 'interrupted';
  output?: string;
  metadata?: string;
  cleanGameConfirmed?: boolean;
  /** SRT files written beside the verified video, cut to its actual range. */
  subtitles?: SubtitleSidecars;
  verification?: ExportVerification;
  message: string;
  updated: string;
  /** Computed at read time; exporting an older snapshot never means current edits are done. */
  current?: boolean;
}

export interface FilingPlan {
  id: string;
  batchId: string;
  root: string;
  rows: {
    clipId: string;
    name: string;
    path: string;
    folder: string;
    requested?: ExportPlan['requested'];
    planned?: ExportPlan['planned'];
    issues: string[];
  }[];
}
export interface RetainedClip {
  exportId: string;
  name: string;
  output: string;
  folder: string;
  source: string;
  completedAt: string;
  duration: number;
  note: string;
  context: string;
  markers: (Marker & { time: number })[];
  available: boolean;
  metadataAvailable: boolean;
  url?: string;
  width?: number;
  height?: number;
  fps?: number;
  video?: string;
}
