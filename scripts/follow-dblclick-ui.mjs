// VC-197 in the transcript window: with Follow playback on, double-clicking a word near the
// window's bottom edge edits that word. A click seeks to the word, and Follow used to scroll it to
// the centre before the second click landed, so another word opened (CI runs 42093060269 and
// 42096445162). The check places the word within Follow's 100 px margin by scrolling, at two
// window sizes, rather than relying on a window size. It also checks that Follow carries on once
// playback reaches the next word, that a position from before the click's seek landed doesn't
// count as moving on, and that turning Follow back on scrolls to the playing word.
// Screenshots: the editor open on the clicked word, in a normal and a compact window.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(base, 'Run with the test suite so all media is disposable.');
const fixture = JSON.parse(await readFile(path.join(base, 'transcripts/latest.json'), 'utf8'));
await mkdir(path.join(base, 'follow-dblclick'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'follow-dblclick/run-'));
const file = path.join(dir, 'follow.vcut');
await copyFile(fixture.file, file);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const service = new ProjectService(path.join(dir, 'native-profile'), '');
await service.open(file);
const store = service.store,
  summary = store.transcripts.get(fixture.transcriptId);
const transcriptId = 'vc197-game';
// Enough lines to scroll, inside the fixture's 15 s recording (a seek past its end is refused).
const places = [
  'Ashford',
  'Brightwater',
  'Coldharbour',
  'Dunmore',
  'Eastwick',
  'Fairhaven',
  'Glenrock',
  'Highmoor',
  'Ironvale',
  'Juniper',
  'Kingsbridge',
  'Larkspur',
  'Millbrook',
  'Northgate',
  'Oakhollow',
  'Pinecrest',
  'Queensport',
  'Ravenhill',
  'Stonebrook',
  'Thornfield',
  'Umberlee',
  'Valewood',
  'Westmarch',
  'Yarrowby',
  'Zephyrine',
  'Amberly',
  'Blackmere',
  'Cindervale',
  'Duskwood',
  'Elmstead',
  'Foxglove',
  'Greywater',
];
const lines = places.map((place, id) => {
  const start = 0.2 + id * 0.45,
    end = start + 0.4,
    text = `The party reaches ${place} at dusk.`;
  return {
    id,
    start,
    end,
    text: ` ${text}`,
    words: text.split(' ').map((word, i, all) => ({
      text: ` ${word}`,
      start: start + ((end - start) * i) / all.length,
      end: start + ((end - start) * (i + 1)) / all.length,
      probability: 0.9,
    })),
    noSpeechProbability: 0,
    averageLogProbability: -0.2,
  };
});
const game = {
  ...summary,
  id: transcriptId,
  role: 'game',
  segmentCount: lines.length,
  wordCount: lines.reduce((n, l) => n + l.words.length, 0),
};
store.transcripts.begin(game);
for (const line of lines) store.transcripts.append(transcriptId, line);
store.transcripts.put({ ...game, state: 'complete' });
await service.checkpoint(fixture.id);
await service.close();
const wordAt = (place) => lines.find((l) => l.text.includes(place)).words[3];
const nextWord = (place) => lines.find((l) => l.text.includes(place)).words[4];

// The transcript list scrolls in the page or in an inner box; Follow uses the window's edges.
const scroller = `(el) => {
  let s = el.parentElement;
  while (s && !(s.scrollHeight > s.clientHeight && /auto|scroll/.test(getComputedStyle(s).overflowY)))
    s = s.parentElement;
  return s || document.scrollingElement;
}`;
let app;
const errors = [];
try {
  app = await electron.launch({
    executablePath: process.env.VIRTUAL_CUT_TEST_EXECUTABLE || require('electron'),
    args: [
      ...(process.env.VIRTUAL_CUT_TEST_EXECUTABLE ? [] : [root]),
      `--user-data-dir=${path.join(dir, 'profile')}`,
      '--background-test',
    ],
    cwd: root,
    env: electronEnvironment(),
  });
  const main = await app.firstWindow();
  main.on('pageerror', (e) => errors.push(e.message));
  await main.locator('[data-workflow]').waitFor();
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
  }, file);
  await main.getByRole('button', { name: 'Projects', exact: true }).click();
  await main.getByRole('button', { name: 'Open project file…', exact: true }).click();
  const opened = app.waitForEvent('window');
  await main.getByRole('button', { name: 'Transcript', exact: true }).click();
  const view = await opened;
  view.on('pageerror', (e) => errors.push(e.message));
  await view.setViewportSize({ width: 1000, height: 640 });
  await view.getByLabel('Select transcript', { exact: true }).selectOption(transcriptId);
  const phrases = view.getByLabel('Transcript phrases');
  await expect(phrases.locator('article')).toHaveCount(lines.length);
  const follow = view.getByRole('button', { name: 'Follow playback', exact: true });
  const word = (place) => phrases.getByRole('button', { name: place, exact: true });
  // Scrolls so the word's bottom sits `gap` px above the window's bottom edge.
  const nearBottom = async (place, gap = 40) => {
    const placed = await word(place).evaluate(
      (el, [find, gap]) => {
        const s = new Function(`return ${find}`)()(el);
        s.scrollTop += el.getBoundingClientRect().bottom - (innerHeight - gap);
        return { bottom: el.getBoundingClientRect().bottom, height: innerHeight };
      },
      [scroller, gap],
    );
    const margin = placed.height - placed.bottom;
    assert(margin > 0 && margin < 100, `${place} should sit inside Follow's margin: ${margin}px`);
  };
  const scrollTop = (place) =>
    word(place).evaluate((el, find) => new Function(`return ${find}`)()(el).scrollTop, scroller);
  const centred = async (place) => {
    const at = await word(place).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { middle: (r.top + r.bottom) / 2, height: innerHeight };
    });
    return Math.abs(at.middle - at.height / 2) < at.height / 4;
  };
  // A position as the main window sends it during playback or after a seek there.
  const position = (time) =>
    app.evaluate(
      ({ BrowserWindow }, event) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('#transcript'))
          .webContents.send('transcript:position-event', event),
      { projectId: fixture.id, sourceId: fixture.rid, time },
    );

  // 1. Double-click a word near the bottom edge with Follow on: the editor opens on that word,
  // and the list stays where it was. Normal window, then compact.
  const sizes = [
    { width: 1000, height: 640, place: 'Ravenhill', shot: 'editor-on-word' },
    { width: 560, height: 420, place: 'Juniper', shot: 'editor-on-word-compact' },
  ];
  for (const { width, height, place, shot } of sizes) {
    await view.setViewportSize({ width, height });
    if ((await follow.getAttribute('aria-pressed')) !== 'true') await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed', 'true');
    await nearBottom(place);
    const before = await scrollTop(place);
    await word(place).dblclick();
    const editor = phrases.getByLabel('Correct word', { exact: true });
    await expect(editor).toHaveValue(place);
    assert.equal(await scrollTop('Ashford'), before, 'the list moved under the double-click');
    await view.screenshot({ path: path.join(dir, `${shot}.png`) });
    await editor.press('Escape');
    await expect(editor).toHaveCount(0);
    // Editing turns Follow off, as before; turning it back on scrolls to the playing word.
    await expect(follow).toHaveAttribute('aria-pressed', 'false');
    await nearBottom(place);
    await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => centred(place)).toBe(true);
  }

  // 2. A single click near the edge: no scroll, even when a position from before the click's
  // seek arrives (the first line, as if it was playing there), nor once the seek has landed.
  await view.setViewportSize({ width: 1000, height: 640 });
  await nearBottom('Thornfield');
  const still = await scrollTop('Thornfield');
  await word('Thornfield').click();
  await position(lines[0].words[1].start);
  await position(wordAt('Thornfield').start);
  await view.waitForTimeout(700);
  assert.equal(await scrollTop('Thornfield'), still, 'Follow scrolled to the clicked word');
  // 3. Playback reaches the next word ("at", same line): Follow carries on and centres it.
  await position(nextWord('Thornfield').start);
  await expect.poll(() => centred('Thornfield')).toBe(true);
  // 4. A seek from elsewhere (the main window) follows right away.
  await nearBottom('Kingsbridge');
  await position(wordAt('Kingsbridge').start);
  await expect.poll(() => centred('Kingsbridge')).toBe(true);
  assert.deepEqual(errors, []);
  console.log(`Double-click with Follow playback on edits the clicked word: ${dir}`);
} catch (error) {
  if (app)
    for (const [i, page] of app.windows().entries()) {
      await writeFile(path.join(dir, `failure-${i}.html`), await page.content());
      await page.screenshot({ path: path.join(dir, `failure-${i}.png`) }).catch(() => {});
    }
  throw error;
} finally {
  if (app) await app.close();
}
