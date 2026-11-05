import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
import { collectBeforeWindowClose } from './coverage-desktop.mjs';

// VC-195: one Allow pictures switch in the Agent panel. Off for pairings saved before the
// setting existed and for new ones; the keyboard toggles it; it persists; each paired app shows
// the pictures it received today, and look calls show their picture count in Activity. No
// picture tool runs here: looks are recorded as activity in the test profile.
const checksRoot = testPath('agent-pictures');
await mkdir(checksRoot, { recursive: true });
const dir = await mkdtemp(path.join(checksRoot, 'ui-'));
const projectFile = path.join(dir, 'pictures.vcut'),
  profile = path.join(dir, 'profile'),
  store = path.join(profile, 'agent-access.json');
const executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const errors = [];
let app, page;
async function launch() {
  app = await electron.launch({
    executablePath: executable || require('electron'),
    args: [...(executable ? [] : [root]), `--user-data-dir=${profile}`, '--background-test'],
    cwd: root,
    env: electronEnvironment({}),
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('[data-workflow]').waitFor();
}
async function close() {
  await collectBeforeWindowClose(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  if (app.process().exitCode === null)
    await new Promise((resolve) => app.process().once('exit', resolve));
}
async function size(width, height) {
  await app.evaluate(
    ({ BrowserWindow }, s) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.unmaximize();
      w.setSize(s.width, s.height);
    },
    { width, height },
  );
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(width);
}
async function capture(name) {
  const data = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise((r) => setTimeout(r, 150));
    return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      .toPNG()
      .toString('base64');
  });
  await writeFile(path.join(dir, `${name}.png`), Buffer.from(data, 'base64'));
}
const saved = async () => JSON.parse(await readFile(store, 'utf8'));
try {
  await launch();
  await app.evaluate(
    ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p.file });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p.dir] });
    },
    { file: projectFile, dir },
  );
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByLabel('New project name').fill('Pictures check');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByText('Bring recordings into this batch')).toBeVisible();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  let panel = page.locator('[data-agent-access]');
  let toggle = panel.getByRole('switch', { name: 'Allow pictures' });
  // A new profile and a new pairing start with pictures off.
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle).toHaveAccessibleDescription(
    /For every paired app\. Pictures from your recordings go to each app’s AI provider/,
  );
  await panel.getByRole('button', { name: 'Pair with Pictures check' }).click();
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(panel.locator('[data-pictures-today]')).toHaveCount(0);
  await close();

  // Rewrite the profile the way 0.4.25 saved it (no pictures field), with a second app and
  // recorded look calls: today, yesterday and one refused.
  const old = await saved();
  assert.equal(old.pictures, false, 'a new profile saves pictures off');
  delete old.pictures;
  const code = old.clients[0];
  const desktop = { ...code, id: randomUUID(), name: 'Claude Desktop' };
  old.clients.push(desktop);
  const now = Date.now(),
    at = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();
  const midnight = new Date(new Date(now).setHours(0, 0, 0, 0));
  const yesterday = new Date(midnight.getTime() - 3600000).toISOString();
  const call = (client, tool, summary, outcome, minutes, pictures) => ({
    at: typeof minutes === 'string' ? minutes : at(minutes),
    clientId: client.id,
    clientName: client.name,
    tool,
    summary,
    outcome,
    ...pictures,
  });
  // Entries within the last minutes stay "today" unless the check runs right after midnight.
  const fresh = now - midnight.getTime() > 10 * 60000;
  old.activity.push(
    call(code, 'look', 'Look: strip of Battle, 31:40–32:10', 'read', yesterday, {
      images: 7,
      imageTokens: 5600,
    }),
    call(code, 'get_transcript', 'Transcript of Battle, 31:00–34:00', 'read', 6),
    call(code, 'look', 'Look: 2 moments in Battle (frames, 720p)', 'read', 5, {
      images: 4,
      imageTokens: 4800,
    }),
    call(code, 'look', 'Look: crop at 33:30 in Battle', 'read', 4, {
      images: 1,
      imageTokens: 640,
    }),
    call(desktop, 'look', 'Look: 2 moments in City', 'refused', 3),
  );
  await writeFile(store, JSON.stringify(old, null, 2));

  await launch();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Pictures check', exact: true }).click();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  panel = page.locator('[data-agent-access]');
  toggle = panel.getByRole('switch', { name: 'Allow pictures' });
  // Pairings saved before the setting read as off.
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle).toContainText('Off');
  // Today's pictures per app: yesterday's look and the refused one are not counted.
  const apps = panel.locator('li', { has: page.getByRole('button', { name: /^Revoke / }) });
  await expect(apps).toHaveCount(2);
  if (fresh) {
    await expect(
      apps.filter({ hasText: 'Claude Code' }).locator('[data-pictures-today]'),
    ).toHaveText('Pictures today: 5 · ~5.4k tokens');
    await expect(
      apps.filter({ hasText: 'Claude Desktop' }).locator('[data-pictures-today]'),
    ).toHaveCount(0);
  }
  const activity = panel.locator('[data-agent-activity] li');
  await expect(activity.filter({ hasText: 'Look: 2 moments in City' })).toContainText(
    '(refused: pictures are off)',
  );
  await expect(activity.filter({ hasText: 'Look: crop at 33:30' })).toContainText(
    '1 picture · ~640 tokens',
  );
  await expect(activity.filter({ hasText: 'frames, 720p' })).toContainText(
    '4 pictures · ~4.8k tokens',
  );
  await expect(activity.filter({ hasText: 'Transcript of Battle' })).not.toContainText('picture');
  await panel.scrollIntoViewIfNeeded();
  await capture('1-off-old-pairing');

  // Keyboard: Tab from the connect checkbox reaches the switch; Space turns it on.
  await panel.getByLabel('Allow agent apps to connect').focus();
  await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByRole('status').filter({ hasText: 'On.' })).toHaveText(
    'On. The next look from any paired app can send pictures.',
  );
  await expect.poll(async () => (await saved()).pictures).toBe(true);
  // A pairing made while pictures are on is covered by the same switch.
  await capture('2-on-keyboard');

  // Compact window: the drawer narrows and nothing in the panel overflows it.
  await size(1280, 800);
  await expect.poll(() => panel.evaluate((p) => p.scrollWidth <= p.clientWidth + 1)).toBe(true);
  await expect(toggle).toBeVisible();
  await capture('3-compact-on');

  // Enter turns it off again; the setting persists across a restart.
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(panel.getByRole('status').filter({ hasText: 'Off.' })).toHaveText(
    'Off. The next look from any app is refused.',
  );
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  // Diagnostics record the change, never app names or what was looked at.
  const report = (await page.evaluate(() => window.virtualCut.diagnostics.summary())).text;
  assert(report.includes('agent-pictures'), 'diagnostics lack agent-pictures');
  for (const secret of ['Claude Code', 'Claude Desktop', 'Look: '])
    assert(!report.includes(secret), `diagnostics leak ${secret}`);
  await close();
  await launch();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Pictures check', exact: true }).click();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  panel = page.locator('[data-agent-access]');
  toggle = panel.getByRole('switch', { name: 'Allow pictures' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle).toContainText('On');
  assert.deepEqual(errors, []);
  await collectBeforeWindowClose(app);
  console.log(JSON.stringify({ passed: true, dir, todayChecked: fresh }));
} catch (e) {
  await capture('failure').catch(() => {});
  console.error({ errors, dir });
  throw e;
} finally {
  if (app && app.process().exitCode === null) await app.close();
}
