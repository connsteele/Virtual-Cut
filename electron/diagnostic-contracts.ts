export type PlaybackDiagnostic = {
  event: 'source-open' | 'reload' | 'play' | 'pause' | 'scan' | 'media-error';
  sourceId?: string;
  rate?: number;
  direction?: number;
  position?: number;
  code?: number;
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
