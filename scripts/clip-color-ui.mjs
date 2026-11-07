// VC-207: set a clip's Resolve color on its Cut card. The card swatch and the timeline clip show
// it, it saves with the project, a new export's companion carries it, and the Resolve helper
// plans to set it. Opens the three-clip project marker-spill-native.mjs leaves behind.
import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { root, require, electronEnvironment } from './shared.mjs';
const checksRoot = testPath('marker-spill');
const fixture = JSON.parse(await readFile(path.join(checksRoot, 'latest-native.json'), 'utf8'));
const dir = await mkdtemp(path.join(checksRoot, 'ui-'));
const executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const app = await electron.launch({
  executablePath: executable || require('electron'),
  args: [
    ...(executable ? [] : [root]),
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--background-test',
  ],
  cwd: root,
  env: electronEnvironment({}),
});
const page = await app.firstWindow(),
  errors = [];
page.setDefaultTimeout(20000);
page.on('pageerror', (e) => errors.push(e.message));
const state = () => page.evaluate(() => window.virtualCut.project.current());
async function saved() {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Manual save made');
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
  await writeFile(path.join(dir, name + '.png'), Buffer.from(data, 'base64'));
}
const orange = 'rgb(232, 134, 42)'; // clipColors.Orange, #e8862a
try {
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1600, 1000);
    w.webContents.setAudioMuted(true);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name: 'Cut', exact: true })
    .click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  const card = (id) => page.locator(`[data-cut-clip="${id}"]`);
  const select = (id) => card(id).getByLabel('Clip color', { exact: true });
  const swatch = (id) => card(id).locator('i').first();
  const timelineClip = (id) => page.locator(`[data-clip-container="${id}"]`);
  // No color yet: the select says so and the swatch keeps the clip's identity color.
  await expect(select('eden')).toHaveValue('');
  const identity = await swatch('eden').evaluate((e) => getComputedStyle(e).backgroundColor);
  assert.notEqual(identity, orange);
  // Every Resolve clip color is offered, in Resolve's order, after "No clip color".
  assert.deepEqual(await select('eden').locator('option').allTextContents(), [
    'No clip color',
    'Orange',
    'Apricot',
    'Yellow',
    'Lime',
    'Olive',
    'Green',
    'Teal',
    'Navy',
    'Blue',
    'Purple',
    'Violet',
    'Pink',
    'Tan',
    'Beige',
    'Brown',
    'Chocolate',
  ]);
  await select('eden').selectOption('Orange');
  await expect(swatch('eden')).toHaveCSS('background-color', orange);
  await expect
    .poll(() => timelineClip('eden').evaluate((e) => e.style.getPropertyValue('--clip-color')))
    .toBe('#e8862a');
  await capture('clip-color-wide');
  // Keyboard: the select takes focus from the clip name with Tab order intact, and arrow keys
  // change it without opening the list.
  await select('creation').focus();
  await expect(select('creation')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(select('creation')).toHaveValue('Orange');
  await page.keyboard.press('ArrowDown');
  await expect(select('creation')).toHaveValue('Apricot');
  await select('creation').selectOption('');
  await expect(select('creation')).toHaveValue('');
  await saved();
  const model = (await state()).model;
  assert.equal(model.clips.find((c) => c.id === 'eden').color, 'Orange');
  assert.equal(model.clips.find((c) => c.id === 'creation').color, undefined);
  assert.equal(model.clips.find((c) => c.id === 'normandy').color, undefined);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await card('eden').scrollIntoViewIfNeeded();
  await expect(select('eden')).toBeInViewport();
  await capture('clip-color-compact');
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await app.close();
}

// A new export carries the color in its own companion section, and the helper plans to set it.
const { ProjectService } = require('../dist-electron/project-service.cjs');
const service = new ProjectService(path.join(dir, 'native-profile'), path.join(dir, 'tools'));
let output;
try {
  const p = await service.open(fixture.file);
  const plan = await service.exportPlan(p.project.id, 'eden', 'mp4');
  output = path.join(dir, 'Eden Prime colored.mp4');
  await service.startExport(p.project.id, plan.id, output, true);
  for (let deadline = Date.now() + 90000; ;) {
    const s = await service.snapshot();
    if (!s.jobs.some((j) => ['queued', 'running'].includes(j.state))) break;
    assert(Date.now() < deadline, 'The export did not settle');
    await new Promise((r) => setTimeout(r, 100));
  }
  const record = service.store.exports().find((e) => e.plan.id === plan.id);
  assert.equal(record.state, 'verified', record.message);
} finally {
  await service.close();
}
const companion = JSON.parse(await readFile(output + '.vcut.json', 'utf8'));
assert.equal(companion.version, 4);
assert.equal(companion.clip.color, undefined, 'The color is not in the clip object');
assert.deepEqual(
  { schema: companion.clipColor.schema, version: companion.clipColor.version },
  { schema: 'virtual-cut-clip-color', version: 1 },
);
assert.equal(companion.clipColor.name, 'Orange');
const helperPlan = await new Promise((resolve, reject) => {
  const python = spawn(
    process.env.VIRTUAL_CUT_PYTHON || 'python',
    [
      '-c',
      `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('vcut', sys.argv[1])
helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
class Item:
    color = ''
    def GetMarkers(self): return {}
    def GetClipProperty(self): return {'File Path': sys.argv[2], 'FPS': '60'}
    def GetMediaId(self): return 'media'
    def GetName(self): return 'Eden Prime colored'
    def GetClipColor(self): return self.color
    def SetClipColor(self, name): self.color = name; return True
item = Item()
plan = helper.plan_clip(item)
set_ = helper.apply_color(plan)
print(json.dumps({'line': plan['color']['line'], 'set': set_, 'color': item.color}))`,
      path.join(root, 'integrations/resolve/Virtual Cut metadata.py'),
      output,
    ],
    { windowsHide: true },
  );
  let out = '',
    err = '';
  python.stdout.on('data', (d) => (out += d));
  python.stderr.on('data', (d) => (err += d));
  python.on('error', reject);
  python.on('exit', (code) => (code ? reject(Error(err)) : resolve(JSON.parse(out))));
});
assert.deepEqual(helperPlan, { line: 'Clip color: set to Orange.', set: true, color: 'Orange' });
await writeFile(
  path.join(dir, 'clip-color.json'),
  JSON.stringify({ companion, helperPlan }, null, 2),
);
console.log('Clip color UI, save, companion and helper plan passed:', dir);
