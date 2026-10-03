export interface SpeechSetupState {
  state: 'idle' | 'planned' | 'installing' | 'ready' | 'cancelled' | 'failed' | 'activated';
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
export type SpeechSetupAction = 'plan' | 'start' | 'status' | 'cancel' | 'activate' | 'restore';
