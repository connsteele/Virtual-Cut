export interface TranscriptionOptions {
  roles: ('game' | 'mic')[];
  language: string;
  vocabulary: boolean;
}
export interface TranscriptRequest extends TranscriptionOptions {
  batchId: string;
  contextId?: string;
}
export interface TranscriptWord {
  start: number;
  end: number;
  text: string;
  probability: number;
}
export interface TranscriptSegment {
  /** Derived only when reading a cue; original recognized text/timing stay unchanged. */
  cueText?: string;
  cueSegmentIds?: number[];
  cueKind?: 'mark' | 'note' | 'cut';
  id: number;
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
  noSpeechProbability: number;
  averageLogProbability: number;
}
export interface TranscriptSummary {
  pipeline?: string;
  contextId?: string;
  engineVersion?: string;
  runtimeVersion?: string;
  peakMemoryBytes?: number;
  id: string;
  sourceId: string;
  fingerprint: string;
  role: 'game' | 'mic';
  track: number;
  language: string;
  languageProbability?: number;
  duration: number;
  offset: number;
  state: 'running' | 'complete' | 'interrupted' | 'failed' | 'cancelled';
  model: string;
  device: string;
  created: string;
  completed?: string;
  context: { gameId?: string; gameName?: string; vocabulary: string; brief: string };
  segmentCount: number;
  wordCount: number;
  elapsedMs?: number;
}
export interface TranscriptEdit {
  id: string;
  transcriptId: string;
  segmentId: number;
  /** A word replacement keeps its original timing; phrase edits explicitly keep only phrase timing. */
  wordIndex?: number;
  text: string;
}
export interface CueDecision {
  id: string;
  sourceId?: string;
  track?: number;
  kind?: 'mark' | 'note' | 'cut';
  time?: number;
  status: 'accepted' | 'rejected';
  markerId?: string;
  noteId?: string;
}
export interface TranscriptPage {
  transcript: TranscriptSummary;
  segments: TranscriptSegment[];
  total: number;
}
export interface AsrRuntime {
  python: string;
  libraries: string;
  model: string;
  device: 'cpu' | 'cuda';
  threads: number;
}
export interface TranscriptSession {
  clips: { id: string; name: string; start: number; end: number }[];
  outputs: { id: string; name: string; start: number; end: number }[];
  projectId: string;
  revision: number;
  sourceId: string;
  title: string;
  position: number;
  recordings: { id: string; title: string }[];
  batches: { id: string; name: string }[];
  batchId: string;
  transcripts: TranscriptSummary[];
  edits: TranscriptEdit[];
  decisions: CueDecision[];
  jobs: {
    id: string;
    sourceId: string;
    state: string;
    progress: number;
    message: string;
    elapsedMs?: number;
  }[];
}
export interface TranscriptCommand {
  projectId: string;
  sourceId: string;
  transcriptId: string;
  action: 'correct' | 'restore' | 'accept-cue' | 'reject-cue';
  segmentId: number;
  wordIndex?: number;
  text?: string;
  /** Optimistic concurrency on the particular edit/decision. */
  expected: string;
}
export interface TranscriptApi {
  apply(token: string): Promise<import('./project-contracts.js').ProjectSnapshot>;
  open(sourceId?: string): Promise<void>;
  onSource(callback: (sourceId: string) => void): () => void;
  session(sourceId?: string): Promise<TranscriptSession | null>;
  page(
    projectId: string,
    transcriptId: string,
    page: number,
    search: string,
  ): Promise<TranscriptPage>;
  start(
    projectId: string,
    sourceId: string,
    batchId: string,
    options: TranscriptionOptions,
  ): Promise<void>;
  job(projectId: string, id: string, action: 'cancel' | 'retry' | 'pause'): Promise<void>;
  command(command: TranscriptCommand): Promise<void>;
  seek(projectId: string, sourceId: string, time: number): Promise<void>;
  runtime(): Promise<{ configured: boolean; settings: AsrRuntime }>;
  configure(
    part: 'python' | 'libraries' | 'model' | 'device',
    device?: 'cpu' | 'cuda',
  ): Promise<void>;
  onSeek(
    callback: (event: { projectId: string; sourceId: string; time: number }) => void,
  ): () => void;
  onCommand(callback: (event: { token: string; command: TranscriptCommand }) => void): () => void;
  finishCommand(token: string, error?: string): void;
  position(projectId: string, sourceId: string, time: number): void;
  onPosition(
    callback: (event: { projectId: string; sourceId: string; time: number }) => void,
  ): () => void;
  export(
    projectId: string,
    transcriptId: string,
    format: 'srt' | 'json',
    exportId?: string,
  ): Promise<string | null>;
}
