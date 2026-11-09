import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { readdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WhatsNewState } from './contracts.js' with { 'resolution-mode': 'import' };
import { compareVersions, releaseOf } from './release-notes.js';

interface Stored {
  /** The release on which What's new was last opened. */
  opened?: string;
  /** The release whose one-time pop-up was shown. */
  announced?: string;
}

/**
 * Whether this profile ran Virtual Cut before, judged by its diagnostics sessions. Call it before
 * this session's diagnostics start writing.
 */
export function earlierSessions(userData: string) {
  try {
    return readdirSync(path.join(userData, 'diagnostics')).some((n) =>
      /^session-.+\.jsonl$/.test(n),
    );
  } catch {
    return false;
  }
}

/**
 * What's new (VC-242): remembers, in the user profile, the release on which the window was last
 * opened and whose pop-up was shown, for the bottom bar's dot and the one-time pop-up. A new
 * profile starts with nothing to announce; a profile used by a version before this one starts
 * with this release unseen.
 */
export function registerWhatsNew(options: {
  userData: string;
  ranBefore: boolean;
  trusted: (event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>) => void;
}) {
  const file = path.join(options.userData, 'whats-new.json');
  const release = releaseOf(app.getVersion());
  let data: Stored = {};
  let fresh = false;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Stored;
    data = {
      opened: typeof value.opened === 'string' ? value.opened : undefined,
      announced: typeof value.announced === 'string' ? value.announced : undefined,
    };
  } catch {
    fresh = true;
  }
  let writing: Promise<void> = Promise.resolve();
  const persist = () => {
    const body = JSON.stringify(data);
    writing = writing
      .catch(() => {})
      .then(async () => {
        const temporary = file + '.' + process.pid + '.tmp';
        await writeFile(temporary, body, 'utf8');
        await rename(temporary, file);
      });
    return writing;
  };
  if (fresh && !options.ranBefore) {
    data = { opened: release, announced: release };
    void persist().catch(() => {});
  }
  const older = (v: string | undefined) => !v || compareVersions(v, release) < 0;
  const state = (): WhatsNewState => ({
    version: app.getVersion(),
    release,
    lastOpened: data.opened,
    unseen: older(data.opened),
    announce: older(data.announced) && older(data.opened),
  });
  ipcMain.handle('whatsNew:state', (event) => {
    options.trusted(event);
    return state();
  });
  ipcMain.handle('whatsNew:opened', async (event) => {
    options.trusted(event);
    data = { opened: release, announced: release };
    await persist().catch(() => {});
    return state();
  });
  ipcMain.handle('whatsNew:announced', async (event) => {
    options.trusted(event);
    data = { ...data, announced: release };
    await persist().catch(() => {});
    return state();
  });
}
