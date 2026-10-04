/** Where one speech runtime lives, as shown to the user. */
export interface SpeechSetupLocation {
  /** Installed by Virtual Cut's download, or configured by hand. */
  kind: 'downloaded' | 'manual';
  /** The downloaded install folder, or the folder containing a manual setup's Python. */
  folder: string;
  python: string;
  model: string;
  /** Its Python, speech libraries and model files exist right now. */
  available: boolean;
}
export interface SpeechSetupState {
  /** The runtime transcription uses now, and the one a switch would return to. */
  current?: SpeechSetupLocation;
  other?: SpeechSetupLocation;
  /** `missing`: a ready or active download whose files were moved or deleted outside the app. */
  state:
    'idle' | 'planned' | 'installing' | 'ready' | 'cancelled' | 'failed' | 'activated' | 'missing';
  version: string;
  folder: string;
  includeGpu: boolean;
  downloadBytes: number;
  installedBytes: number;
  requiredBytes: number;
  availableBytes: number;
  downloadedBytes: number;
  message: string;
  canRestore: boolean;
}
export type SpeechSetupAction =
  | 'plan'
  | 'start'
  | 'status'
  | 'cancel'
  | 'activate'
  /** Switch to the other setup (the two swap places). */
  | 'restore'
  | 'reveal-current'
  | 'reveal-other';
