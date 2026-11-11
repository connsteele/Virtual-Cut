import type { Clip, Marker } from './workflow-types.js';
import type {
  TranscriptEdit,
  TranscriptSegment,
  TranscriptSummary,
} from './transcript-contracts.js';

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
  /**
   * VC-212: the source spans a clip with gaps exports, in order, each from keyframe to keyframe.
   * Absent for a clip without gaps that remove anything; such clips export as before.
   */
  pieces?: { start: number; end: number }[];
  /** Each gap as marked and the span the export actually leaves out (absent: too short). */
  gaps?: ExportGap[];
  revision: number;
  created: string;
}
export interface ExportGap {
  id: string;
  requested: { start: number; end: number };
  removed?: { start: number; end: number };
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
  /**
   * VC-212: a stitched clip's verified pieces (source spans, in order) and its length on its own
   * clock. Its game audio is re-encoded losslessly with fades at the joins, so its samples were
   * compared with the original's rather than its packets.
   */
  pieces?: { start: number; end: number }[];
  length?: number;
  /**
   * The finished video's start timecode as FFprobe reads it, and the same point in seconds at
   * the video's nominal frame rate (VC-158). Absent when the video carries none.
   */
  startTimecode?: { value: string; seconds: number };
  bytes: number;
  sha256: string;
}
/** Which finished transcript an SRT is written from (VC-94). */
export type SubtitleRole = 'game' | 'mic';
/** The transcript option offered with export and filing (VC-94, VC-154). */
export interface TranscriptOutputs {
  roles: SubtitleRole[];
  /** SRT files beside the video. */
  srt: boolean;
  /** Original recognition, corrections and word timing in the .vcut.json companion. */
  companion: boolean;
}
/** Transcript data frozen when the export is queued, so the companion is reproducible. */
export interface CompanionTranscripts {
  requested: SubtitleRole[];
  items: {
    transcript: TranscriptSummary;
    segments: TranscriptSegment[];
    edits: TranscriptEdit[];
  }[];
  /** Snapshots sent to the window carry only the included roles, not the data. */
  included?: SubtitleRole[];
}
export interface SubtitleSidecars {
  requested: SubtitleRole[];
  /**
   * Set on exports queued since VC-236: every requested transcript gets its SRT, an empty one
   * when the clip has no speech in it, and the companion names each SRT's transcript. Absent on
   * older exports, whose companions must keep reproducing byte for byte.
   */
  named?: true;
  written: {
    role: SubtitleRole;
    transcriptId: string;
    file: string;
    sha256: string;
    /** Set on the copy shifted to the video's start timecode for Resolve (VC-158). */
    timecode?: string;
    /** An empty SRT: this transcript has no speech in the clip (VC-236). */
    noDialogue?: true;
  }[];
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
  /**
   * 'clip': the companion, chapters and Library carry the markers of the clip's own range, not
   * of its outward keyframe padding (VC-208). Absent on older exports, whose companions must
   * keep reproducing byte for byte.
   */
  markerScope?: 'clip';
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
  /** Transcript history embedded in the companion (VC-154). */
  companionTranscripts?: CompanionTranscripts;
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
