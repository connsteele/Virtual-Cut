// A project's proxy settings (VC-237), set in the Proxies window.
//
// When proxies are made: only when asked (the default), or the import step's "Make proxies"
// checkbox starts ticked, or never (the proxy chips and the viewer switch are hidden). And the
// size new proxies are made at: 1080p by default, 720p as an option.

import { isProxyHeight, type ProxyHeight } from './proxy-record.js';

/** 'ask': the import checkbox starts unticked. 'import': it starts ticked. 'never': no proxy UI. */
export type ProxyOnImport = 'ask' | 'import' | 'never';
export const proxyOnImportChoices: readonly ProxyOnImport[] = ['ask', 'import', 'never'];

export interface ProxySettings {
  onImport: ProxyOnImport;
  height: ProxyHeight;
}

export const defaultProxySettings: ProxySettings = { onImport: 'ask', height: 1080 };

/** The project's settings, with the defaults for anything missing or not understood. */
export function proxySettings(value: unknown): ProxySettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<ProxySettings>;
  return {
    onImport: proxyOnImportChoices.includes(v.onImport as ProxyOnImport)
      ? (v.onImport as ProxyOnImport)
      : defaultProxySettings.onImport,
    height: isProxyHeight(v.height) ? v.height : defaultProxySettings.height,
  };
}

/** Settings sent from a window are taken only when every field is one of the choices. */
export function isProxySettings(value: unknown): value is ProxySettings {
  const v = value as ProxySettings;
  return (
    !!v &&
    typeof v === 'object' &&
    Object.keys(v).every((k) => k === 'onImport' || k === 'height') &&
    proxyOnImportChoices.includes(v.onImport) &&
    isProxyHeight(v.height)
  );
}
