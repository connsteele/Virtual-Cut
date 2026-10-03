import type { BrowserWindow } from 'electron';
import type { Diagnostics } from './diagnostics.cjs';
import { errorCode } from './diagnostics.cjs';

/** No console text, URLs, transcript contents or arbitrary renderer fields are stored. */
export function observeWindow(
  window: BrowserWindow,
  role: 'main' | 'transcript',
  diagnostics: Diagnostics,
) {
  const fields = { window: role, windowId: window.id };
  diagnostics.record('window-open', fields);
  window.on('close', () => diagnostics.record('window-close-request', fields));
  window.on('closed', () => diagnostics.record('window-closed', fields));
  window.on('unresponsive', () => {
    diagnostics.record('window-unresponsive', fields);
    void diagnostics.flush();
  });
  window.on('responsive', () => diagnostics.record('window-responsive', fields));
  window.webContents.on('render-process-gone', (_event, details) => {
    diagnostics.record('renderer-gone', {
      ...fields,
      reason: details.reason,
      exitCode: details.exitCode,
    });
    void diagnostics.flush();
  });
  window.webContents.on('preload-error', (_event, _path, error) => {
    diagnostics.record('preload-error', { ...fields, errorCode: errorCode(error) });
  });
  window.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (mainFrame) diagnostics.record('window-load-failed', { ...fields, code });
  });
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error')
      diagnostics.record('renderer-error', {
        ...fields,
        line: details.lineNumber,
        script: details.sourceId.replace('app://virtual-cut/', ''),
      });
  });
}
