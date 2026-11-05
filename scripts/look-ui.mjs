// The look tool through the real MCP pipe (VC-172, decision 0022): refused while the app's
// pictures are off (and listed as refused), then strips, frames and crops as image blocks with a
// line each, fitted to the caps, near-duplicates dropped, Activity with picture counts and
// tokens, the intent guide's look sentences only while pictures are on, and no picture files.
// Every returned picture is saved beside the project (look-*.jpg) to be looked at.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
import { screenTextClip, stubEngine } from './screen-text-stub.mjs';
import { agent, initialize, tool as mcpTool } from './mcp-test-client.mjs';

const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(base, 'Run with the test suite so all media is disposable.');
await mkdir(path.join(base, 'look-ui'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'look-ui/run-'));
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg';
const tool = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', ...args], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let error = '';
    p.stderr.on('data', (d) => (error += d));
    p.on('error', reject);
    p.on('close', (code) => (code ? reject(Error(error)) : resolve()));
  });
// 20 s, 1280x720: moving test picture 0-6 s, a frozen frame 6-12 s, black 12-14 s, moving after.
const clip = path.join(dir, 'Screen session.mp4');
await screenTextClip(tool, clip);
const { folder: engine } = await stubEngine(dir);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const file = path.join(dir, 'look.vcut'),
  cache = path.join(dir, 'cache');
await mkdir(cache);
const previous = process.env.VIRTUAL_CUT_PICTURE_PASS;
process.env.VIRTUAL_CUT_PICTURE_PASS = 'manual';
const service = new ProjectService(path.join(dir, 'native-profile'), '');
let snap = await service.open(file, { name: 'Look QA', destination: dir, cache });
await service.importFiles(snap.project.id, snap.activeBatchId, [clip], { game: 1, mic: 2 });
for (const until = Date.now() + 60000; ;) {
  snap = await service.snapshot();
  if (!snap.jobs.some((j) => ['queued', 'running'].includes(j.state))) break;
  assert(Date.now() < until, 'Import timed out');
  await new Promise((r) => setTimeout(r, 100));
}
const [id] = snap.model.recordings.map((r) => r.id);
await service.close();
if (previous === undefined) delete process.env.VIRTUAL_CUT_PICTURE_PASS;
else process.env.VIRTUAL_CUT_PICTURE_PASS = previous;

/** Every file under a folder, to show look wrote none. */
async function files(folder) {
  const out = [];
  for (const entry of await readdir(folder, { withFileTypes: true, recursive: true }))
    if (entry.isFile()) out.push(path.join(entry.parentPath, entry.name));
  return out.sort();
}

let app;
const errors = [];
const saved = [];
try {
  app = await electron.launch({
    executablePath: process.env.VIRTUAL_CUT_TEST_EXECUTABLE || require('electron'),
    args: [
      ...(process.env.VIRTUAL_CUT_TEST_EXECUTABLE ? [] : [root]),
      `--user-data-dir=${path.join(dir, 'profile')}`,
      '--background-test',
    ],
    cwd: root,
    env: electronEnvironment({
      VIRTUAL_CUT_IDLE_SECONDS: '600',
      VIRTUAL_CUT_PICTURE_GPU: '0',
      VIRTUAL_CUT_OCR_RUNTIME: engine,
    }),
  });
  const main = await app.firstWindow();
  main.on('pageerror', (e) => errors.push(e.message));
  await main.locator('[data-workflow]').waitFor();
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setAudioMuted(true);
    win.setSize(1280, 800);
  }, file);
  await main.getByRole('button', { name: 'Projects', exact: true }).click();
  await main.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await main
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name: 'Cut', exact: true })
    .click();
  // Screen text (stand-in engine) gives a box to crop; the filmstrip gives strip tiles.
  const card = main.locator(`[data-recording="${id}"]`);
  await card.click();
  await card.getByRole('button', { name: /^Analyse picture now/ }).click();
  const current = () => main.evaluate(() => window.virtualCut.project.current());
  for (const until = Date.now() + 90000; ; await new Promise((r) => setTimeout(r, 200))) {
    const now = await current();
    if (now.screenText?.[id] && now.filmstrips?.[id] === 'ready') break;
    assert(Date.now() < until, `Screen text and filmstrip not ready: ${now.filmstrips?.[id]}`);
  }

  await main.getByRole('button', { name: 'Agent', exact: true }).click();
  const panel = main.locator('[data-agent-access]');
  await panel.getByLabel('Allow agent apps to connect').click();
  await panel.getByRole('button', { name: 'Pair with Look QA' }).click();
  const client = agent(await panel.locator('[data-config="claude-desktop"]').textContent());
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await initialize(client);
  const listed = await client.call('tools/list', {});
  const lookTool = listed.result.tools.find((t) => t.name === 'look');
  assert(lookTool, 'look is offered');
  assert.equal(lookTool.annotations.readOnlyHint, true);
  const look = async (args) =>
    (await client.call('tools/call', { name: 'look', arguments: args })).result;
  const guide = async () => JSON.parse((await mcpTool(client, 'get_intent_guide', {})).text).guide;
  const agentState = () => main.evaluate(() => window.virtualCut.agent.state());
  const setPictures = (on) => main.evaluate((on) => window.virtualCut.agent.setPictures(on), on);

  // Off (the default): refused before anything is read, listed as refused, guide without looks.
  const ask = {
    recording_id: id,
    moments: [{ kind: 'frames', times: [2.5] }],
  };
  const off = await look(ask);
  assert.equal(off.isError, true);
  assert.match(off.content[0].text, /^Pictures are off for agent apps\. .*Agent panel/);
  assert.equal(off.content.length, 1);
  let activity = (await agentState()).activity[0];
  assert.deepEqual(
    [activity.tool, activity.outcome, activity.summary, activity.images],
    ['look', 'refused', 'Look at Screen session: 1 frame 720p 0:02.5', undefined],
  );
  assert.equal((await guide()).version, '4');
  assert.ok(!JSON.stringify(await guide()).includes('Look whenever seeing the picture'));

  await setPictures(true);
  assert.ok(
    (await guide()).games.general.lessons.some((l) => l.startsWith('Look whenever seeing')),
    'pictures on: the guide adds the look sentences',
  );
  const before = await files(dir);
  const save = async (name, result) => {
    const lines = [];
    let n = 0;
    for (const block of result.content) {
      if (block.type === 'text') lines.push(block.text);
      else {
        assert.equal(block.type, 'image');
        assert.equal(block.mimeType, 'image/jpeg');
        const bytes = Buffer.from(block.data, 'base64');
        assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8], 'a JPEG');
        const out = `${name}-${String(++n).padStart(2, '0')}.jpg`;
        await writeFile(path.join(dir, out), bytes);
        saved.push(out);
      }
    }
    await writeFile(path.join(dir, `${name}.txt`), lines.join('\n'));
    return { lines, images: n };
  };
  const size = (block) => {
    const b = Buffer.from(block.data, 'base64');
    // Baseline JPEG: the SOF0 segment holds height then width.
    for (let i = 2; i < b.length;) {
      const marker = b[i + 1];
      if (marker === 0xc0 || marker === 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
    return [0, 0];
  };

  // A strip across the whole recording, two 720p frames, a 1080p frame (the recording is 720p,
  // so it stays 1280x720), a screen text crop and a fraction crop.
  const text = (await current()).screenText[id];
  assert(text.lines > 0);
  const started = Date.now();
  const all = await look({
    recording_id: id,
    moments: [
      { kind: 'strip', start_seconds: 0, end_seconds: 20 },
      { kind: 'frames', times: [2.5, 16] },
      { kind: 'frames', times: [4], size: '1080p' },
      { kind: 'crop', at_seconds: 3, box: [20, 20, 160, 48], box_units: 'screen_text' },
      { kind: 'crop', at_seconds: 3, box: [0.25, 0.25, 0.75, 0.75], box_units: 'fraction' },
    ],
  });
  const ms = Date.now() - started;
  assert.ok(!all.isError, all.content[0].text);
  const first = await save('look-all', all);
  const head = all.content[0].text;
  assert.match(head, /^Look at "Screen session": (\d+) pictures, about ([\d,]+) image tokens\./);
  const [, count, tokens] = /: (\d+) pictures, about ([\d,]+) image tokens/.exec(head);
  assert.equal(Number(count), first.images);
  assert.ok(Number(tokens.replace(',', '')) <= 8000, head);
  // The frozen frame (6-12 s) gives the same tile several times: only the first is sent.
  assert.match(head, /Not sent, nearly the same as an earlier picture: Strip tile \d+\/\d+/);
  assert.ok(first.images < 21 && first.images >= 12, `${first.images} pictures`);
  const images = all.content.filter((b) => b.type === 'image');
  const labels = all.content.filter((b, i) => b.type === 'text' && i > 0).map((b) => b.text);
  assert.equal(labels.length, images.length, 'one line per picture');
  for (const [i, line] of labels.entries())
    assert.match(
      line,
      new RegExp(
        `^${i + 1}\\. (Strip tile \\d+/\\d+|Frame|Crop) of "Screen session" at \\d+:\\d\\d\\.\\d \\(\\d+\\.\\d{3} s\\)`,
      ),
    );
  const tiles = labels.filter((l) => l.includes('Strip tile'));
  assert.ok(
    tiles.every((l) => / nearest keyframe, 2\d\dx1\d\d$/.test(l)),
    tiles.join('\n'),
  );
  const frames = labels.flatMap((l, i) => (l.includes('Frame of') ? [[l, size(images[i])]] : []));
  assert.deepEqual(
    frames.map(([l, s]) => [/at (\S+)/.exec(l)[1], s.join('x')]),
    [
      ['0:02.5', '1280x720'],
      ['0:16.0', '1280x720'],
      ['0:04.0', '1280x720'],
    ],
  );
  const crops = labels.flatMap((l, i) => (l.includes('Crop of') ? [[l, size(images[i])]] : []));
  assert.equal(crops.length, 2);
  // The screen text box is on the 1280x720 read frame, padded by half its height and grown to
  // whole 28 px cells; the fraction box is the middle quarter, grown likewise.
  assert.match(crops[0][0], /x 6-174, y 6-62 of the recording's frame, full detail 168x56$/);
  assert.match(crops[1][0], /x 318-962, y 178-542 of the recording's frame, full detail 644x364$/);
  for (const image of images) assert.ok(Math.max(...size(image)) <= 1988);
  activity = (await agentState()).activity[0];
  assert.equal(activity.tool, 'look');
  assert.equal(activity.outcome, 'read');
  assert.equal(activity.images, first.images);
  assert.equal(activity.imageTokens, Number(tokens.replace(',', '')));
  assert.match(
    activity.summary,
    /^Look at Screen session: strip 0:00\.0–0:20\.0; 2 frames 720p 0:02\.5, 0:16\.0; 1 frame 1080p 0:04\.0; crop at 0:03\.0; crop at 0:03\.0$/,
  );
  await expect(
    panel.locator('[data-agent-activity] li', { hasText: 'Look at Screen session' }),
  ).toHaveCount(2);

  // A short range: tiles a quarter second apart are exact frames, not keyframes.
  const close = await look({
    recording_id: id,
    moments: [{ kind: 'strip', start_seconds: 1, end_seconds: 2, tiles: 4 }],
  });
  const near = await save('look-close', close);
  assert.ok(
    near.lines.slice(1).some((l) => l.includes('exact frame')),
    near.lines.join('\n'),
  );

  // Over the caps: fitted and said so, not refused.
  const big = await look({
    recording_id: id,
    moments: [
      { kind: 'strip', start_seconds: 0, end_seconds: 6 },
      { kind: 'frames', times: [1, 2, 3, 4, 5, 15, 16, 17], size: '720p' },
      { kind: 'frames', times: [18, 19, 19.5], size: '1080p' },
    ],
  });
  assert.ok(!big.isError, big.content[0].text);
  await save('look-fitted', big);
  assert.match(big.content[0].text, /3 frames at 1080p asked; 2 a call are sent at 1080p/);
  assert.match(big.content[0].text, /Strip of moment 1 fitted to \d+ tiles \(16 asked\)/);
  assert.ok(big.content.filter((b) => b.type === 'image').length <= 16);

  // Mistakes are refused with a reason; nothing was written anywhere.
  const wrong = await look({ recording_id: id, moments: [{ kind: 'frames', times: [99] }] });
  assert.equal(wrong.isError, true);
  assert.match(wrong.content[0].text, /Moment 1: times must be a time in seconds from 0 to 20/);
  const nobody = await look({ recording_id: 'nope', moments: [{ kind: 'frames', times: [1] }] });
  assert.match(nobody.content[0].text, /No recording with id "nope"/);
  const after = (await files(dir)).filter(
    (f) => !saved.includes(path.basename(f)) && !/look-[a-z]+\.txt$/.test(f),
  );
  const added = after.filter((f) => !before.includes(f) && !/[\\/]profile[\\/]/.test(f));
  assert.deepEqual(added, [], 'look writes no files beside the project or in its cache');
  const pictures = after.filter((f) => !before.includes(f) && /\.(jpe?g|png|webp|bmp)$/i.test(f));
  assert.deepEqual(pictures, [], 'no picture files in the profile either');

  // Off again takes effect at once, and the guide drops the look sentences.
  await setPictures(false);
  const again = await look(ask);
  assert.equal(again.isError, true);
  assert.match(again.content[0].text, /^Pictures are off/);
  assert.ok(!JSON.stringify(await guide()).includes('Look whenever seeing the picture'));
  client.end();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ status: 'passed', dir, ms, pictures: first.images, tokens, saved }, null, 2),
  );
} finally {
  await app?.close();
}
