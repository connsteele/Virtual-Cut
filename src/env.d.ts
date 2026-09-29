/// <reference types="vite/client" />

import type { VirtualCutApi } from '../electron/contracts';

declare global {
  interface Window {
    virtualCut?: VirtualCutApi;
  }
}
