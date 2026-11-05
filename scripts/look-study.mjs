// Looks at a copied recording through the real MCP pipe (VC-172), as an agent app would: imports
// the copy into a disposable project, waits for its filmstrip, pairs, allows pictures, makes the
// look calls in a JSON file and saves every picture and line under the output folder with the
// time each call took. Usage:
//   node scripts/look-study.mjs <copy.mp4> <calls.json> <output folder>
// calls.json: [{ "name": "subtitles", "moments": [ ...look moments... ] }, ...]
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { require, root, electronEnvironment } from './shared.mjs';
import { agent, initialize } from './mcp-test-client.mjs';

const [copy, callsFile, out] = process.argv.slice(2);
assert(copy && callsFile && out, 'Give a copied recording, a calls file and an output folder.');
assert(!/^[A-Z]:\\YouTube/i.test(copy), 'Use a copy, never an original.');
const calls = JSON.parse(await readFile(callsFile, 'utf8'));
await mkdir(out, { recursive: true });
const { ProjectService } = require('../dist-electron/project-service.cjs');
const file = path.join(out, 'look-study.vcut'),
  cache = path.join(out, 'cache');
await mkdir(cache, { recursive: true });
process.env.VIRTUAL_CUT_PICTURE_PASS = 'manual';
const service = new ProjectService(path.join(out, 'native-profile'), '');
let snap = await service.open(file, { name: 'Look study', destination: out, cache });
if (!snap.model.recordings.length)
  await service.importFiles(snap.project.id, snap.activeBatchId, [copy], { game: 1, mic: 2 });
for (const until = Date.now() + 15 * 60000; ; await new Promise((r) => setTimeout(r, 500))) {
  snap = await service.snapshot();
  if (!snap.jobs.some((j) => ['queued', 'running'].includes(j.state))) break;
  assert(Date.now() < until, 'Import timed out');
}
const [id] = snap.model.recordings.map((r) => r.id);
await service.close();

let app;
const report = { copy, recording: id, calls: [] };
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [root, `--user-data-dir=${path.join(out, 'profile')}`, '--background-test'],
    cwd: root,
    env: electronEnvironment({ VIRTUAL_CUT_PICTURE_GPU: '0', VIRTUAL_CUT_PICTURE_PASS: 'manual' }),
  });
  const main = await app.firstWindow();
  await main.locator('[data-workflow]').waitFor();
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
  }, file);
  await main.getByRole('button', { name: 'Projects', exact: true }).click();
  await main.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await main.locator('[data-workflow]').waitFor();
  const began = Date.now();
  for (const until = Date.now() + 10 * 60000; ; await new Promise((r) => setTimeout(r, 500))) {
    const now = await main.evaluate(() => window.virtualCut.project.current());
    if (now?.filmstrips?.[id] === 'ready') break;
    assert(Date.now() < until, `No filmstrip: ${now?.filmstrips?.[id]}`);
  }
  report.filmstripWaitSeconds = Math.round((Date.now() - began) / 1000);
  await main.getByRole('button', { name: 'Agent', exact: true }).click();
  const panel = main.locator('[data-agent-access]');
  await panel.getByLabel('Allow agent apps to connect').click();
  await panel.getByRole('button', { name: 'Pair with Look study' }).click();
  const client = agent(await panel.locator('[data-config="claude-desktop"]').textContent());
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await initialize(client);
  const clientId = (await main.evaluate(() => window.virtualCut.agent.state())).clients[0].id;
  await main.evaluate((c) => window.virtualCut.agent.setPictures(c, true), clientId);
  for (const call of calls) {
    const started = Date.now();
    const reply = await client.call('tools/call', {
      name: 'look',
      arguments: { recording_id: id, moments: call.moments },
    });
    const ms = Date.now() - started;
    const lines = [];
    let n = 0;
    for (const block of reply.result.content)
      if (block.type === 'text') lines.push(block.text);
      else
        await writeFile(
          path.join(out, `${call.name}-${String(++n).padStart(2, '0')}.jpg`),
          Buffer.from(block.data, 'base64'),
        );
    await writeFile(path.join(out, `${call.name}.txt`), lines.join('\n'));
    report.calls.push({
      name: call.name,
      ms,
      pictures: n,
      error: !!reply.result.isError,
      head: lines[0],
    });
  }
  client.end();
} finally {
  await app?.close();
}
await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
