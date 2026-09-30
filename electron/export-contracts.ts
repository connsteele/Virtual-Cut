import type { Clip, Marker } from './workflow-types.js';

export type ExportContainer = 'mp4' | 'mkv';
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
  audioCodec: string;
  bytes: number;
  sha256: string;
}
export interface ExportRecord {
  plan: ExportPlan;
  input: ExportInput;
  inputHash: string;
  state: 'planned' | 'queued' | 'running' | 'verified' | 'failed' | 'cancelled' | 'interrupted';
  output?: string;
  metadata?: string;
  cleanGameConfirmed?: boolean;
  verification?: ExportVerification;
  message: string;
  updated: string;
  /** Computed at read time; exporting an older snapshot never means current edits are done. */
  current?: boolean;
}
