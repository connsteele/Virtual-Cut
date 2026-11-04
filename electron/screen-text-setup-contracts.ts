/** The last readiness check of a screen text engine: one test image read by worker.py `check`. */
export interface ScreenTextCheck {
  /** The install folder it checked; a check of another folder is not shown. */
  folder: string;
  ok: boolean;
  /** DirectML ran both models (the graphics card); false means the processor read it. */
  gpu: boolean;
  /** Milliseconds to read the test image, after the engine started. */
  ms: number;
  /** ISO time of the check. */
  at: string;
  error?: string;
}
/** Where one screen text engine lives, as shown to the user. */
export interface ScreenTextLocation {
  folder: string;
  /** Installed by Virtual Cut's download (its own folder), rather than a development folder. */
  downloaded: boolean;
  /** Python and both models are there right now. */
  available: boolean;
}
export interface ScreenTextSetupState {
  /**
   * `checking`: the install's files are in place and the test image is being read.
   * `missing`: a ready or active download whose files were moved or deleted outside the app.
   */
  state:
    | 'idle'
    | 'planned'
    | 'installing'
    | 'checking'
    | 'ready'
    | 'cancelled'
    | 'failed'
    | 'activated'
    | 'missing';
  /** The engine in use now, and the one a switch would return to. */
  current?: ScreenTextLocation;
  other?: ScreenTextLocation;
  /** Disk space a kept, unused downloaded engine occupies (it can be deleted). */
  otherBytes?: number;
  /** VIRTUAL_CUT_OCR_RUNTIME chooses the engine (development); setup's choice waits. */
  overridden: boolean;
  /** Why screen text can't be read right now, or '' when the engine in use is complete. */
  problem: string;
  /** The current engine's last check, if it was checked. */
  check?: ScreenTextCheck;
  /** A check of the engine in use is running. */
  checking: boolean;
  version: string;
  folder: string;
  downloadBytes: number;
  installedBytes: number;
  requiredBytes: number;
  availableBytes: number;
  downloadedBytes: number;
  message: string;
  /** The result of the action just taken (switching or deleting an engine). */
  notice?: string;
}
export type ScreenTextSetupAction =
  | 'status'
  /** Choose a folder and see sizes; nothing is downloaded. */
  | 'plan'
  | 'start'
  | 'cancel'
  /** Use a checked download that could not be switched to automatically. */
  | 'activate'
  /** Read the test image with the engine in use. */
  | 'check'
  /** Switch back to the previous engine (the two swap places). */
  | 'restore'
  /** Delete a kept downloaded engine that is no longer used. */
  | 'remove-other'
  | 'reveal-current'
  | 'reveal-other';
