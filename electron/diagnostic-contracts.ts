export type PlaybackDiagnostic = {
  event: 'source-open' | 'reload' | 'play' | 'pause' | 'scan' | 'media-error' | 'preview-recovered';
  sourceId?: string;
  rate?: number;
  direction?: number;
  position?: number;
  code?: number;
  projectId?: string;
  previewId?: string;
  fault?:
    | 'demuxer-seek'
    | 'media-read'
    | 'media-decode'
    | 'media-unsupported'
    | 'play-rejected'
    | 'unknown';
  readyState?: number;
  networkState?: number;
  /** A reload the player started by itself after a demuxer-seek fault (VC-41). */
  automatic?: boolean;
  clipCount?: number;
  paused?: boolean;
  seeking?: boolean;
  duration?: number;
  offset?: number;
  /** The viewer showed the recording's proxy (VC-238). */
  proxy?: boolean;
  recent?: PlaybackTrace[];
  /** Separate-audio sync since play began, sent with a pause (VC-29 note 28). */
  audioHolds?: number;
  audioSeeksBack?: number;
  audioSeeksForward?: number;
  videoWaits?: number;
  stalledMs?: number;
};
export type PlaybackTrace = {
  action:
    | 'source-open'
    | 'clips-changed'
    | 'seek'
    | 'seeked'
    | 'waiting'
    | 'stalled'
    | 'loaded'
    | 'reload'
    | 'error'
    | 'play'
    | 'pause'
    | 'scan'
    | 'command';
  atMs: number;
  position: number;
  target?: number;
  clipCount?: number;
  rate?: number;
};
export interface DiagnosticSummary {
  session: string;
  logging: boolean;
  dropped: number;
  text: string;
}
export interface DiagnosticApi {
  summary(): Promise<DiagnosticSummary>;
  copy(): Promise<void>;
  openLogs(): Promise<void>;
  export(): Promise<boolean>;
  playback(event: PlaybackDiagnostic): void;
}
