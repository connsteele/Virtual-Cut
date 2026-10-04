export interface TranscriptionOptions {
  device?: 'auto' | 'cpu' | 'cuda';
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
export type CueKind = 'mark' | 'note' | 'cut' | 'clip-start' | 'clip-end';
export interface TranscriptSegment {
  cuePartner?: { id: number; time: number; text?: string };
  cueTitle?: string;
  /** Bounded, corrected context proposal; never replaces immutable recognition. */
  cueContext?: { id: number; start: number; end: number; text: string }[];
  cueContextLimited?: boolean;
  /** Derived only when reading a cue; original recognized text/timing stay unchanged. */
  cueText?: string;
  cueSegmentIds?: number[];
  cueKind?: CueKind;
  id: number;
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
  noSpeechProbability: number;
  averageLogProbability: number;
}
export interface TranscriptSummary {
  deviceMessage?: string;
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
  transcriptId?: string;
  segmentIds?: number[];
  contextStart?: number;
  contextEnd?: number;
  title?: string;
  id: string;
  sourceId?: string;
  track?: number;
  kind?: CueKind;
  time?: number;
  status: 'accepted' | 'rejected';
  markerId?: string;
  noteId?: string;
  clipId?: string;
  appliedTime?: number;
}
export interface TranscriptPage {
  followStart?: number;
  followEnd?: number;
  transcript: TranscriptSummary;
  segments: TranscriptSegment[];
  total: number;
}
export interface AsrRuntime {
  python: string;
  libraries: string;
  model: string;
  gpuLibraries?: string;
  device: 'auto' | 'cpu' | 'cuda';
  threads: number;
}
export interface TranscriptSession {
  /** Opaque reading-state lifetime, reset when a project is opened or the app restarts. */
  viewSessionId?: string;
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
    device?: 'cpu' | 'cuda';
    deviceMessage?: string;
    id: string;
    sourceId: string;
    state: string;
    progress: number;
    message: string;
    elapsedMs?: number;
  }[];
}
export interface TranscriptCommand {
  title?: string;
  contextEndSegmentId?: number;
  /** Reject a context review if its source wording or pairing changed meanwhile. */
  contextExpected?: string;
  time?: number;
  endTime?: number;
  partnerSegmentId?: number;
  clipId?: string;
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
  speechSetup(
    action: import('./speech-setup-contracts.js').SpeechSetupAction,
    includeGpu?: boolean,
  ): Promise<import('./speech-setup-contracts.js').SpeechSetupState>;
  setupHelp(topic: 'engine' | 'gpu' | 'python' | 'model'): Promise<void>;
  transport(projectId: string, sourceId: string, key: 'j' | 'k' | 'l'): Promise<void>;
  onTransport(
    callback: (event: { projectId: string; sourceId: string; key: 'j' | 'k' | 'l' }) => void,
  ): () => void;
  pageAt(projectId: string, transcriptId: string, time: number): Promise<number>;
  apply(token: string): Promise<import('./project-contracts.js').ProjectSnapshot>;
  open(sourceId?: string): Promise<void>;
  onSource(callback: (sourceId: string) => void): () => void;
  session(sourceId?: string): Promise<TranscriptSession | null>;
  page(
    projectId: string,
    transcriptId: string,
    page: number,
    search: string,
    filter?: 'all' | 'cues' | 'pending' | 'accepted' | 'rejected',
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
  runtime(refresh?: boolean): Promise<{
    configured: boolean;
    /** Which file of a previously chosen setup is gone (moved or deleted outside the app). */
    removed: string;
    settings: AsrRuntime;
    gpu?: { available: boolean; message: string };
  }>;
  configure(
    part: 'python' | 'libraries' | 'model' | 'gpuLibraries' | 'device',
    device?: 'auto' | 'cpu' | 'cuda',
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
