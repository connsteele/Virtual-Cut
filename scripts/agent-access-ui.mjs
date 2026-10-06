import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
import { collectBeforeWindowClose } from './coverage-desktop.mjs';

// VC-159/VC-160: an agent app pairs, launches `--mcp`, reads over MCP, and loses access on
// revoke or when access is off. The launcher never opens a window or a second app.
const checksRoot = testPath('agent-access');
await mkdir(checksRoot, { recursive: true });
const dir = await mkdtemp(path.join(checksRoot, 'ui-'));
const projectFile = path.join(dir, 'agents.vcut'),
  profile = path.join(dir, 'profile');
const executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const errors = [];
let app, page;
async function launch() {
  app = await electron.launch({
    executablePath: executable || require('electron'),
    args: [...(executable ? [] : [root]), `--user-data-dir=${profile}`, '--background-test'],
    cwd: root,
    env: electronEnvironment({
      TEMP: process.env.TEMP || 'G:/GPT/Temp',
      TMP: process.env.TEMP || 'G:/GPT/Temp',
    }),
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('[data-workflow]').waitFor();
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
/** Starts the configured launcher and speaks newline-delimited JSON-RPC to it. */
function agent(config) {
  const { command, args } = JSON.parse(config).mcpServers['virtual-cut'];
  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: electronEnvironment(),
  });
  let out = '',
    stderr = '',
    id = 0;
  const waiting = new Map();
  child.stdout.on('data', (d) => {
    out += d;
    let end;
    while ((end = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, end).trim();
      out = out.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      waiting.get(message.id)?.(message);
    }
  });
  child.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      const timer = setTimeout(() => reject(new Error(`${method} timed out: ${stderr}`)), 20000);
      waiting.set(n, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });
  return {
    call,
    notify: (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'),
    exited,
    stderr: () => stderr,
    end: () => child.stdin.end(),
    kill: () => child.kill(),
  };
}
async function initialize(client) {
  const init = await client.call('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'agent-access-check', version: '1' },
  });
  assert.equal(init.result.serverInfo.name, 'virtual-cut');
  client.notify('notifications/initialized');
}
const tool = async (client, name, args = {}) => {
  const reply = await client.call('tools/call', { name, arguments: args });
  return { error: !!reply.result.isError, text: reply.result.content[0].text };
};
try {
  await launch();
  const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await app.evaluate(
    ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p.file });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p.dir] });
    },
    { file: projectFile, dir },
  );
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByLabel('New project name').fill('Agent check');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByText('Bring recordings into this batch')).toBeVisible();

  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  const panel = page.locator('[data-agent-access]');
  const toggle = panel.getByLabel('Allow agent apps to connect');
  await expect(toggle).not.toBeChecked();
  await panel.getByRole('button', { name: 'Pair with Agent check' }).click();
  const config = await panel.locator('[data-config="claude-desktop"]').textContent();
  assert.match(
    await panel.locator('[data-config="claude-code"]').textContent(),
    /^claude mcp add --scope user virtual-cut -- .+ --mcp --pair=[\w-]{32}$/,
  );
  await panel.getByRole('button', { name: 'Done', exact: true }).click();

  // Off by default: the launcher explains instead of starting anything.
  const offline = agent(config);
  assert.equal(await offline.exited, 1);
  assert.match(offline.stderr(), /not running, or agent access is off/);
  // A launcher without a pairing never connects.
  const { command, args } = JSON.parse(config).mcpServers['virtual-cut'];
  const unpaired = agent(
    JSON.stringify({
      mcpServers: { 'virtual-cut': { command, args: args.filter((a) => !a.startsWith('--pair')) } },
    }),
  );
  assert.equal(await unpaired.exited, 1);
  assert.match(unpaired.stderr(), /not paired/);

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(panel.getByRole('status')).toHaveText('Waiting for paired agent apps.');
  const client = agent(config);
  await initialize(client);
  const listed = (await client.call('tools/list', {})).result.tools;
  assert.deepEqual(listed.map((t) => t.name).sort(), [
    'get_annotations',
    'get_context',
    'get_current_view',
    'get_project_summary',
    'get_transcript',
  ]);
  assert(listed.every((t) => t.annotations?.readOnlyHint === true));
  const view = JSON.parse((await tool(client, 'get_current_view')).text);
  assert.equal(view.project.name, 'Agent check');
  assert.equal(view.page, 'cut');
  const summary = JSON.parse((await tool(client, 'get_project_summary')).text);
  assert.equal(summary.batches.length, 1);
  const refused = await tool(client, 'get_transcript', { recording_id: 'missing', role: 'mic' });
  assert(refused.error);
  assert.match(refused.text, /No recording with id "missing"/);
  // Arguments outside the schema are rejected by the SDK before reaching the project.
  assert((await tool(client, 'get_transcript', { recording_id: 'x', role: 'both' })).error);
  assert.equal(await windows(), 1, 'the launcher never opens a window');
  await expect(panel.locator('[data-agent-activity] li')).toHaveCount(3);
  await expect(panel.locator('[data-agent-activity] li').first()).toContainText(
    'Mic transcript of missing',
  );
  await expect(panel.getByText('connected')).toBeVisible();
  await capture('agent-access');

  // Revoking cuts the live connection and refuses the same pairing afterwards.
  await panel.getByRole('button', { name: 'Revoke Claude Code' }).click();
  assert.equal(await client.exited, 0);
  const revoked = agent(config);
  assert.equal(await revoked.exited, 1);
  assert.match(revoked.stderr(), /not paired, or its pairing was revoked/);

  // Turning access off closes the pipe.
  await panel.getByRole('textbox', { name: 'Agent app' }).fill('Claude Desktop');
  await panel.getByRole('button', { name: 'Pair with Agent check' }).click();
  await expect(panel.getByRole('button', { name: 'Revoke Claude Desktop' })).toBeVisible();
  const second = await panel.locator('[data-config="claude-desktop"]').textContent();
  const live = agent(second);
  await initialize(live);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  assert.equal(await live.exited, 0);
  const closed = agent(second);
  assert.equal(await closed.exited, 1);
  assert.match(closed.stderr(), /not running, or agent access is off/);
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
