import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
import { collectBeforeWindowClose } from './coverage-desktop.mjs';
import { agent, tool } from './mcp-test-client.mjs';
import { notesSince, releaseOf, toolsNamed } from '../dist-electron/release-notes.js';

// What's new (VC-242): after an update the version number shows a dot and a one-time pop-up
// offers the notes; the window lists them newest first with a Paired agents box; a paired app
// that last read 0.4.28 gets every newer For agents list from get_whats_new, and the box then
// shows it as current. Screenshots: the pop-up, the window wide and in a compact window.
const checksRoot = testPath('whats-new');
await mkdir(checksRoot, { recursive: true });
const dir = await mkdtemp(path.join(checksRoot, 'ui-'));
const projectFile = path.join(dir, 'whats-new.vcut'),
  profile = path.join(dir, 'profile');
const executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const errors = [];
let app, page;

// A profile last used on 0.4.28, with an agent app that read the 0.4.28 notes.
const token = 'whats-new-check-token-0000000000000';
await mkdir(profile, { recursive: true });
await writeFile(
  path.join(profile, 'whats-new.json'),
  JSON.stringify({ opened: '0.4.28', announced: '0.4.28' }),
);
await writeFile(
  path.join(profile, 'agent-access.json'),
  JSON.stringify({
    enabled: true,
    pictures: false,
    clients: [
      {
        id: 'batch-agent',
        name: 'Batch agent',
        projectId: 'another-project',
        projectName: 'Mass Effect batch',
        paired: '2026-11-01T10:00:00.000Z',
        notesRead: '0.4.28',
        notesReadAt: '2026-11-06T10:00:00.000Z',
        tokenHash: createHash('sha256').update(token).digest('hex'),
      },
    ],
    activity: [],
  }),
);

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
async function size(width, height) {
  await app.evaluate(
    ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(...s),
    [width, height],
  );
  await page.waitForFunction((w) => window.innerWidth <= w, width);
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
async function close() {
  await collectBeforeWindowClose(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  if (app.process().exitCode === null)
    await new Promise((resolve) => app.process().once('exit', resolve));
}
try {
  await launch();
  await size(1600, 1000);
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  const release = releaseOf(version);
  const newer = notesSince(version, '0.4.28').map((n) => n.version);
  assert(newer.length, `the ${release} notes have versions after 0.4.28`);

  // The bottom bar shows only the number, with a dot, and the pop-up offers the notes.
  let versionButton = page.getByRole('button', { name: /^Version .+: what's new/ });
  await expect(page.locator('[data-app-version]')).toHaveText(version);
  await expect(versionButton).toHaveAccessibleName(`Version ${version}: what's new (new notes)`);
  await expect(page.locator('[data-whats-new-dot]')).toBeVisible();
  let popup = page.locator('[data-whats-new-popup]');
  await expect(popup).toContainText(`Virtual Cut updated to ${version}`);
  await expect(popup.getByRole('button', { name: 'See what’s new' })).toBeVisible();
  // The pop-up never takes focus from the page.
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
  await capture('whats-new-popup');
  await popup.getByRole('button', { name: 'Later' }).click();
  await expect(popup).toHaveCount(0);
  await expect(page.locator('[data-whats-new-dot]')).toBeVisible();
  await close();

  // One time only: the next start shows the dot but not the pop-up.
  await launch();
  versionButton = page.getByRole('button', { name: /^Version .+: what's new/ });
  popup = page.locator('[data-whats-new-popup]');
  await size(1600, 1000);
  await expect(page.locator('[data-whats-new-dot]')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(popup).toHaveCount(0);

  // A project and a second agent app, paired on this version.
  await app.evaluate(
    ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p.file });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p.dir] });
    },
    { file: projectFile, dir },
  );
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByLabel('New project name').fill('Whats new check');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByText('Bring recordings into this batch')).toBeVisible();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  const panel = page.locator('[data-agent-access]');
  await expect(panel.getByLabel('Allow agent apps to connect')).toBeChecked();
  await panel.getByRole('button', { name: 'Pair with Whats new check' }).click();
  const config = await panel.locator('[data-config="claude-desktop"]').textContent();
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await page.keyboard.press('Escape');

  // The app that last read 0.4.28 is told to read the notes, and gets everything newer.
  const parsed = JSON.parse(config);
  const server = parsed.mcpServers['virtual-cut'];
  server.args = server.args.map((a) => (a.startsWith('--pair=') ? `--pair=${token}` : a));
  const batch = agent(JSON.stringify(parsed));
  const init = await batch.call('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'whats-new-check', version: '1' },
  });
  batch.notify('notifications/initialized');
  const range = newer.length === 1 ? newer[0] : `${newer[newer.length - 1]} to ${newer[0]}`;
  assert(
    init.result.instructions.startsWith(
      `Virtual Cut is at ${version}, and this app has not read the release notes for ${range}. Call get_whats_new`,
    ),
    init.result.instructions,
  );
  const listed = (await batch.call('tools/list', {})).result.tools;
  const whatsNewTool = listed.find((t) => t.name === 'get_whats_new');
  assert.deepEqual(whatsNewTool.annotations, { readOnlyHint: true });
  assert.deepEqual(Object.keys(whatsNewTool.inputSchema.properties), ['since']);
  // Every tool the server offers is named in some version's notes, so none ships unmentioned.
  const named = toolsNamed();
  for (const t of listed) assert(named.has(t.name), `no release notes name ${t.name}`);
  const first = await tool(batch, 'get_whats_new');
  assert(!first.error, first.text);
  const answer = JSON.parse(first.text);
  assert.equal(answer.basis, 'last read');
  assert.equal(answer.since, '0.4.28');
  assert.match(answer.toolList, /reconnect/);
  assert.deepEqual(
    answer.versions.map((v) => v.version),
    newer,
  );
  for (const v of answer.versions) {
    // The whole notes: the agent groups, what changed for the user, and final or draft.
    assert(v.forAgents.tools.length, v.version);
    assert.match(v.forAgents.intentGuide, /^Version \d/);
    assert(v.forTheUser.length, v.version);
    assert.match(v.status, /^(Final\.|Draft notes)/);
  }
  // No paths or media in the answer (decision 0014).
  assert.doesNotMatch(first.text, /[A-Z]:\\|\.vcut|\.mp4|\.mkv|base64/i);
  await writeFile(path.join(dir, 'get-whats-new.json'), first.text);
  // Read once: the next call has nothing new; `since` reads further back.
  const again = JSON.parse((await tool(batch, 'get_whats_new')).text);
  assert.deepEqual(again.versions, []);
  assert.match(again.note, new RegExp(`Nothing new since ${release.replaceAll('.', '\\.')}`));
  const since = JSON.parse((await tool(batch, 'get_whats_new', { since: '0.4.26' })).text);
  assert.equal(since.basis, 'since');
  assert.deepEqual(
    since.versions.map((v) => v.version),
    notesSince(version, '0.4.26').map((n) => n.version),
  );
  assert((await tool(batch, 'get_whats_new', { since: 'latest' })).error);
  batch.end();
  assert.equal(await batch.exited, 0);
  const saved = JSON.parse(await readFile(path.join(profile, 'agent-access.json'), 'utf8'));
  assert.equal(saved.clients.find((c) => c.id === 'batch-agent').notesRead, release);
  assert.equal(saved.clients.find((c) => c.name === 'Claude Code').pairedVersion, release);

  // The keyboard opens What's new from the version number; the dot clears.
  await versionButton.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: "What's new" });
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-whats-new-dot]')).toHaveCount(0);
  await expect(dialog).toContainText(`You’re on ${version}`);
  const versions = dialog.locator('[data-version]');
  await expect(versions.first()).toHaveAttribute('data-version', release);
  assert.deepEqual(
    await versions.evaluateAll((list) => list.map((d) => d.dataset.version)),
    notesSince(version).map((n) => n.version),
  );
  // Versions after the last opening are open and tagged; older ones stay closed.
  for (const v of newer) {
    const card = dialog.locator(`[data-version="${v}"]`);
    await expect(card).toHaveAttribute('open', '');
    await expect(card).toContainText('New since you last looked');
  }
  await expect(dialog.locator('[data-version="0.4.27"]')).not.toHaveAttribute('open', '');
  const agents = dialog.locator('[data-paired-agents]');
  await expect(agents.locator('li', { hasText: 'Batch agent' })).toContainText(
    `Read ${release} notes`,
  );
  await expect(agents.locator('li', { hasText: 'Claude Code' })).toContainText(
    `Paired on ${release}, nothing new since`,
  );
  await expect(dialog.locator('[data-agent-notes]').first()).toContainText('For agents');
  await capture('whats-new-window');
  const state = await page.evaluate(() => window.virtualCut.whatsNew.state());
  assert.equal(state.unseen, false);
  assert.equal(state.announce, false);

  // Keyboard: the switch and each version are reachable, Escape returns to the number.
  const agentSwitch = dialog.getByRole('checkbox', { name: 'Show agent notes' });
  await agentSwitch.focus();
  await page.keyboard.press('Space');
  await expect(agentSwitch).not.toBeChecked();
  await expect(dialog.locator('[data-agent-notes]')).toHaveCount(0);
  await expect(agents).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(dialog.locator(`[data-version="${release}"] > summary`)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(dialog.locator(`[data-version="${release}"]`)).not.toHaveAttribute('open', '');
  await page.keyboard.press('Space');
  await agentSwitch.click();
  await expect(agentSwitch).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(versionButton).toBeFocused();
  await expect(versionButton).toHaveAccessibleName(`Version ${version}: what's new`);

  // Compact window: the dialog fits and each version's two lists stack.
  await size(1100, 720);
  await versionButton.click();
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const viewport = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  assert(box.x >= 0 && box.x + box.width <= viewport.w, 'dialog fits the width');
  assert(box.y >= 0 && box.y + box.height <= viewport.h, 'dialog fits the height');
  const latest = dialog.locator(`[data-version="${release}"]`);
  const userList = await latest.getByRole('heading', { name: 'For you' }).boundingBox();
  const agentList = await latest.locator('[data-agent-notes]').boundingBox();
  assert(agentList.y > userList.y + userList.height, 'For agents sits below For you');
  assert.equal(
    await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth),
    true,
    'no sideways scrolling',
  );
  await capture('whats-new-compact');
  await page.keyboard.press('Escape');
  // Settings is unchanged.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toContainText('Fastest scrubbing');
  await expect(page.getByRole('dialog', { name: 'Settings' })).not.toContainText('What’s new');
  await page.keyboard.press('Escape');

  assert.deepEqual(errors, []);
  await collectBeforeWindowClose(app);
  console.log(JSON.stringify({ passed: true, dir }));
} catch (e) {
  await capture('failure').catch(() => {});
  console.error({ errors, dir });
  throw e;
} finally {
  if (app && app.process().exitCode === null) await app.close();
}
