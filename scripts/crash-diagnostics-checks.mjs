import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile, utimes } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron as electron, expect } from 'playwright/test';
import { require, root, electronEnvironment, stopChild } from './shared.mjs';
import { collectBeforeWindowClose } from './coverage-desktop.mjs';

const base = process.env.VIRTUAL_CUT_TEST_ROOT || 'G:/GPT/Work/virtual-cut/review-0.4.3/checks';
await mkdir(base, { recursive: true });
const dir = await mkdtemp(path.join(base, 'crash-diagnostics-'));
const profile = path.join(dir, 'profile');
const logDir = path.join(profile, 'diagnostics');
const records = async () => {
  const names = await readdir(logDir).catch(() => []);
  const texts = await Promise.all(
    names.filter((n) => n.endsWith('.jsonl')).map((n) => readFile(path.join(logDir, n), 'utf8')),
  );
  return texts.flatMap((text) =>
    text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
};
const launch = () =>
  electron.launch({
    executablePath: process.env.VIRTUAL_CUT_TEST_EXECUTABLE || require('electron'),
    args: [
      ...(process.env.VIRTUAL_CUT_TEST_EXECUTABLE ? [] : [root]),
      `--user-data-dir=${profile}`,
      '--background-test',
      '--disable-gpu',
    ],
    cwd: root,
    env: electronEnvironment({ TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' }),
  });
let app, ownedChild;
try {
  app = await launch();
  ownedChild = app.process();
  const main = await app.firstWindow();
  await main.waitForFunction(() => !!window.virtualCut);
  const setup = await app.evaluate(({ app, crashReporter, BrowserWindow }) => ({
    uploads: crashReporter.getUploadToServer(),
    dumps: app.getPath('crashDumps'),
    visible: BrowserWindow.getAllWindows().some((w) => w.isVisible()),
  }));
  assert.equal(setup.uploads, false);
  assert.equal(setup.visible, false);
  assert.equal(setup.dumps, path.join(logDir, 'crashes'));
  const popup = app.waitForEvent('window');
  await main.evaluate(() => window.virtualCut.transcript.open());
  const transcript = await popup;
  await transcript.waitForFunction(() => !!window.virtualCut);
  await transcript.evaluate(() => console.error('SECRET_TRANSCRIPT_TEXT'));
  await transcript
    .evaluate(() => window.virtualCut.transcript.seek('invalid', 'invalid', 4))
    .catch(() => {});
  await expect
    .poll(async () =>
      (await records()).some(
        (r) => r.event === 'transcript-action-failed' && r.window === 'transcript',
      ),
    )
    .toBe(true);
  await expect
    .poll(async () =>
      (await records()).some((r) => r.event === 'renderer-error' && r.window === 'transcript'),
    )
    .toBe(true);
  await collectBeforeWindowClose(app);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('#transcript'),
    );
    w.webContents.forcefullyCrashRenderer();
  });
  await expect
    .poll(
      async () =>
        (await records()).some((r) => r.event === 'renderer-gone' && r.window === 'transcript'),
      { timeout: 15000 },
    )
    .toBe(true);
  const dumpFiles = async (folder) => {
    const result = [];
    for (const e of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const f = path.join(folder, e.name);
      if (e.isDirectory()) result.push(...(await dumpFiles(f)));
      else if (e.name.endsWith('.dmp')) result.push(f);
    }
    return result;
  };
  await expect
    .poll(async () => (await dumpFiles(setup.dumps)).length, { timeout: 20000 })
    .toBeGreaterThan(0);
  // Its renderer is intentionally gone; preserve the pre-crash counters and
  // leave live windows available for the normal final collector.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#transcript'))
      ?.destroy(),
  );
  await app.close();
  app = undefined;
  assert(!(await readdir(logDir)).some((n) => n.startsWith('active-')));
  const firstSession = (await records()).find((r) => r.event === 'session-start').session;
  app = await launch();
  ownedChild = app.process();
  await app.firstWindow();
  await expect
    .poll(async () =>
      (await records()).some((r) => r.event === 'session-start' && r.session !== firstSession),
    )
    .toBe(true);
  assert(!(await records()).some((r) => r.event === 'previous-session-unfinished'));
  const killedSession = (await records()).find(
    (r) => r.event === 'session-start' && r.session !== firstSession,
  ).session;
  await collectBeforeWindowClose(app);
  await stopChild(ownedChild);
  app = undefined;
  app = await launch();
  ownedChild = app.process();
  await app.firstWindow();
  await expect
    .poll(async () =>
      (await records()).some(
        (r) => r.event === 'previous-session-unfinished' && r.previousSession === killedSession,
      ),
    )
    .toBe(true);
  await app.close();
  app = undefined;
  const events = await records();
  assert(!JSON.stringify(events).includes('SECRET_TRANSCRIPT_TEXT'));
  assert(events.some((r) => r.event === 'window-close-request'));
  assert(events.some((r) => r.event === 'session-end'));

  // Exercise fatal synchronous persistence in a separate process that really exits.
  const fatalProfile = path.join(dir, 'fatal');
  const fatalChild = spawnSync(
    process.execPath,
    [
      '-e',
      `const { Diagnostics } = require('./dist-electron/diagnostics.cjs'); const d = new Diagnostics(${JSON.stringify(fatalProfile)}); d.beginSession(); process.on('uncaughtExceptionMonitor', e => d.fatal(e)); throw new TypeError('SECRET_FATAL');`,
    ],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  );
  assert.notEqual(fatalChild.status, 0);
  const fatalFiles = await readdir(path.join(fatalProfile, 'diagnostics'));
  const fatalText = await readFile(
    path.join(
      fatalProfile,
      'diagnostics',
      fatalFiles.find((f) => f.endsWith('.jsonl')),
    ),
    'utf8',
  );
  assert.equal(JSON.parse(fatalText).errorType, 'TypeError');
  assert(!fatalText.includes('SECRET_FATAL'));
  const { Diagnostics } = require('../dist-electron/diagnostics.cjs');
  const retentionProfile = path.join(dir, 'retention'),
    d = new Diagnostics(retentionProfile);
  const dumpFolder = path.join(d.directory, 'crashes', 'reports');
  await mkdir(dumpFolder, { recursive: true });
  for (let i = 0; i < 7; i++) {
    const f = path.join(dumpFolder, `${randomUUID()}.dmp`);
    await writeFile(f, 'disposable');
    await utimes(f, new Date(Date.now() - 120000), new Date(Date.now() - 120000 - i * 1000));
  }
  await writeFile(path.join(dumpFolder, 'preserve.txt'), 'database/unknown files are retained');
  await d.pruneCrashDumps();
  assert.equal((await readdir(dumpFolder)).filter((f) => f.endsWith('.dmp')).length, 5);
  assert((await readdir(dumpFolder)).includes('preserve.txt'));
  await writeFile(
    path.join(dir, 'report.json'),
    JSON.stringify(
      {
        nativeDump: true,
        transcriptCrash: true,
        redaction: true,
        normalExit: true,
        forcedExitDetected: true,
        synchronousFatal: true,
        retention: true,
        uploads: false,
      },
      null,
      2,
    ),
  );
  console.log('Crash diagnostics checks passed:', dir);
} finally {
  if (app) await app.close().catch(() => stopChild(ownedChild));
}
