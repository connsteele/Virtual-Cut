import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
import { collectBeforeWindowClose } from './coverage-desktop.mjs';
const fixture = JSON.parse(
  await readFile(
    process.env.VIRTUAL_CUT_TRANSCRIPT_FIXTURE ||
      path.join(
        process.env.VIRTUAL_CUT_TEST_ROOT || 'G:/GPT/Work/virtual-cut/m3-storage-validation',
        'transcripts',
        'latest.json',
      ),
    'utf8',
  ),
);
const output = path.join(
  process.env.VIRTUAL_CUT_TEST_ROOT || 'G:/GPT/Work/virtual-cut/m3-ui-validation',
  'transcript-ui',
);
await mkdir(output, { recursive: true });
const dir = await mkdtemp(path.join(output, 'run-'));
const file = path.join(dir, 'speech-review.vcut');
await copyFile(fixture.file, file);
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
    env: electronEnvironment({ TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' }),
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('[data-workflow]').waitFor();
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
  }, file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Transcript', exact: true })).toBeEnabled();
  const newWindow = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Transcript', exact: true }).click();
  const transcript = await newWindow;
  transcript.setDefaultTimeout(20000);
  transcript.on('pageerror', (e) => errors.push(e.message));
  await expect(transcript).toHaveTitle('Transcription · Virtual Cut');
  await expect(transcript.getByLabel('Transcript phrases').locator('article')).not.toHaveCount(0);
  const alignment = await transcript.evaluate(() => {
    const recording = document.querySelector('select'),
      start = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Transcribe'),
      settings = document.querySelector('[aria-label="Speech engine"]');
    // One toolbar row: the controls share a vertical centre (VC-114 stage 2a).
    return [recording, start, settings].map((e) => {
      const r = e.getBoundingClientRect();
      return (r.top + r.bottom) / 2;
    });
  });
  const widths = await transcript.evaluate(() => {
    const bar = document.querySelector('[role="toolbar"]');
    return `${Math.round(bar.clientWidth)} px: ${[...bar.children].map((c) => Math.round(c.getBoundingClientRect().width)).join(' + ')}`;
  });
  assert.ok(
    Math.max(...alignment) - Math.min(...alignment) < 2,
    `Recording and its actions share one row (${alignment.join(', ')}; ${widths})`,
  );
  const leadingGap = await transcript.evaluate(() => {
    const help = document.querySelector('details summary').parentElement;
    const first = document.querySelector('[aria-label="Transcript phrases"] article');
    return first.getBoundingClientRect().top - help.getBoundingClientRect().bottom;
  });
  assert.ok(
    leadingGap >= 0 && leadingGap < 40,
    `No large unused area above transcript (${leadingGap}px)`,
  );
  const phrases = transcript.getByLabel('Transcript phrases');
  const words = phrases.locator('article').first().locator('[class*="words"] button');
  await words.nth(3).click();
  await expect(transcript.getByLabel('Transcript correction')).toHaveCount(0);
  const expectedTime = await transcript.evaluate(() =>
    document.querySelector('[class*="words"] [class*="selected"]')?.getAttribute('title'),
  );
  await expect.poll(() => page.locator('video').evaluate((v) => v.currentTime)).toBeGreaterThan(0);
  const position = await page.locator('video').evaluate((v) => v.currentTime);
  assert.ok(position > 0, `Word click must seek the main viewer (${expectedTime})`);
  const anchor = await transcript.evaluate(async () => {
    const api = window.virtualCut.transcript,
      session = await api.session();
    return (
      await api.page(
        session.projectId,
        session.transcripts.find((t) => t.state === 'complete').id,
        0,
        '',
      )
    ).segments[0].words[3].start;
  });
  assert.ok(
    Math.abs(position - anchor) < 0.04,
    `Word seek error ${Math.abs(position - anchor)} seconds`,
  );
  await words.nth(3).dblclick();
  await expect(transcript.getByLabel('Transcript correction')).toBeVisible();
  await transcript.keyboard.press('Escape');
  await expect(transcript.getByLabel('Transcript correction')).toHaveCount(0);
  await words.nth(3).dblclick();
  await transcript.getByLabel('Corrected transcript text').fill('Cai');
  await transcript.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(words.nth(3)).toHaveText('Cai');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(words.nth(3)).not.toHaveText('Cai');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(words.nth(3)).toHaveText('Cai');
  await transcript.getByRole('button', { name: 'Close edit', exact: true }).click();
  await phrases
    .locator('article')
    .first()
    .getByRole('button', { name: 'Edit phrase', exact: true })
    .click();
  await transcript
    .getByLabel('Corrected transcript text')
    .fill('A corrected phrase with different words.');
  await transcript.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(phrases.locator('article').first()).toContainText('phrase timing');
  await transcript.getByRole('button', { name: 'Restore original', exact: true }).click();
  await expect(phrases.locator('article').first()).not.toContainText('phrase timing');
  await transcript.getByRole('button', { name: 'Close edit', exact: true }).click();
  await transcript.getByLabel('Search transcript').fill('zzzz-not-present');
  await expect(transcript.getByText('No matching phrases.')).toBeVisible();
  await transcript.getByLabel('Search transcript').fill('');
  await expect(phrases.locator('article')).not.toHaveCount(0);
  await transcript.getByLabel('Search transcript').fill('Cai');
  await expect(phrases.locator('article').first()).toContainText('Cai');
  await transcript.getByLabel('Search transcript').fill('');
  // An isolated floating renderer cannot use broad workspace/file access.
  // One toolbar row (VC-114 stage 2a, VC-92); search sits left of the filter chips (M336).
  const tools = transcript.getByRole('toolbar', { name: 'Transcript tools' });
  await expect(tools.getByLabel('Select transcript', { exact: true })).toBeVisible();
  // No recording switcher (the window follows the main window); short track labels (M336).
  await expect(tools.getByLabel('Recording', { exact: true })).toHaveCount(0);
  await expect(
    tools.getByLabel('Select transcript', { exact: true }).locator('option').first(),
  ).toHaveText(/^(Microphone|Game) · /);
  const searchBox = transcript.getByLabel('Search transcript');
  await expect(searchBox).toHaveAttribute('placeholder', 'Search');
  assert(
    await searchBox.evaluate(
      (input) =>
        input.closest('div').nextElementSibling?.getAttribute('aria-label') === 'Transcript filter',
    ),
    'Search sits left of the filter chips',
  );
  await transcript.screenshot({ path: path.join(dir, 'transcript-toolbar.png') });
  await transcript.locator('[data-filter="pending"]').click();
  await expect(phrases.locator('article')).toHaveCount(1);
  await expect(transcript.locator('[data-filter="pending"] span')).toHaveText('1');
  await expect(transcript.locator('[data-filter="accepted"] span')).toHaveText('0');
  const notesBefore = await page.evaluate(
    async () => (await window.virtualCut.project.current()).model.notes.length,
  );
  await transcript.getByRole('button', { name: 'Accept timed note', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.virtualCut.project.current()).model.notes.length),
    )
    .toBe(notesBefore + 1);
  await expect(transcript.getByText('No matching cues.')).toBeVisible();
  await expect(transcript.locator('[data-filter="pending"] span')).toHaveText('0');
  await expect(transcript.locator('[data-filter="accepted"] span')).toHaveText('1');
  await transcript.locator('[data-filter="accepted"]').click();
  await expect(phrases.locator('article')).toHaveCount(1);
  await transcript.locator('[data-filter="pending"]').click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    transcript.getByRole('button', { name: 'Accept timed note', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.virtualCut.project.current()).model.notes.length),
    )
    .toBe(notesBefore);
  await transcript.locator('[data-filter="all"]').click();
  const exported = path.join(dir, 'transcript.json');
  await app.evaluate(({ dialog }, file) => {
    globalThis.transcriptSaveDialogs = [];
    dialog.showSaveDialog = async (_parent, options) => {
      globalThis.transcriptSaveDialogs.push(options);
      return { canceled: false, filePath: file };
    };
  }, exported);
  // Export is one menu holding the format and, when completed clips exist, the timing.
  const openExport = async () => {
    const toggle = transcript.getByRole('button', { name: 'Export', exact: true });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  };
  const exportJson = async (timing) => {
    await openExport();
    await transcript.getByLabel('Export format').selectOption('json');
    if (timing !== undefined)
      await transcript.getByLabel('Export transcript timing').selectOption(timing);
    await transcript.getByRole('button', { name: 'Export transcript', exact: true }).click();
    await expect(transcript.getByRole('dialog', { name: 'Export transcript' })).toHaveCount(0);
  };
  await exportJson();
  await expect.poll(async () => !!(await readFile(exported, 'utf8').catch(() => ''))).toBe(true);
  const exportedText = await readFile(exported, 'utf8');
  assert(
    exportedText.includes('Cai') && exportedText.includes('several'),
    'Export preserves correction and recognition original',
  );
  let saveOptions = await app.evaluate(() => globalThis.transcriptSaveDialogs.at(-1));
  assert.equal(saveOptions.title, 'Export source transcript');
  assert.match(saveOptions.defaultPath, /-source-transcript-mic\.json$/);
  const outputs = await transcript.evaluate(
    async () => (await window.virtualCut.transcript.session()).outputs,
  );
  assert(outputs.length, 'Fixture provides a verified completed output');
  await exportJson(outputs[0].id);
  await expect
    .poll(async () => JSON.parse(await readFile(exported, 'utf8')).scope.exportId)
    .toBe(outputs[0].id);
  saveOptions = await app.evaluate(() => globalThis.transcriptSaveDialogs.at(-1));
  assert.equal(saveOptions.title, 'Export completed clip transcript');
  assert.match(saveOptions.defaultPath, /-clip-transcript-mic\.json$/);
  const clipHandoff = JSON.parse(await readFile(exported, 'utf8'));
  assert.equal(clipHandoff.scope.name, outputs[0].name);
  assert.equal(clipHandoff.scope.start, outputs[0].start);
  assert.equal(clipHandoff.scope.end, outputs[0].end);
  const companion = `${clipHandoff.scope.output}.vcut.json`;
  const companionBefore = await readFile(companion, 'utf8');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, companion);
  await exportJson(outputs[0].id);
  await expect(transcript.getByRole('alert')).toContainText('Video companions are preserved');
  assert.equal(await readFile(companion, 'utf8'), companionBefore);
  await openExport();
  await transcript.getByLabel('Export transcript timing').selectOption('');
  await transcript.keyboard.press('Escape');
  await expect(transcript.getByRole('dialog', { name: 'Export transcript' })).toHaveCount(0);
  assert.match(
    await transcript.evaluate(() =>
      window.virtualCut.project
        .current()
        .then(() => 'unsafe')
        .catch((e) => e.message),
    ),
    /rejected/,
  );
  for (const [width, height, name] of [
    [760, 850, 'wide'],
    [500, 600, 'compact'],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('#transcript'))
          .setSize(size[0], size[1]);
      },
      [width, height],
    );
    await new Promise((r) => setTimeout(r, 250));
    const shot = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('#transcript'))
          .webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      )
        .toPNG()
        .toString('base64'),
    );
    await writeFile(path.join(dir, `${name}.png`), Buffer.from(shot, 'base64'));
    assert.ok(
      await transcript.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'No horizontal overflow',
    );
  }
  await collectBeforeWindowClose(app);
  await transcript.close();
  await writeFile(
    path.join(dir, 'profile', 'transcript-window.json'),
    JSON.stringify({ x: 999999, y: 999999, width: 760, height: 850 }),
  );
  const reopenedPromise = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Transcript', exact: true }).click();
  const reopened = await reopenedPromise;
  assert.equal(
    await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith('#transcript'),
        ),
        b = w.getBounds();
      return screen
        .getAllDisplays()
        .some(
          (d) =>
            b.x >= d.workArea.x &&
            b.x < d.workArea.x + d.workArea.width &&
            b.y >= d.workArea.y &&
            b.y < d.workArea.y + d.workArea.height,
        );
    }),
    true,
    'A disconnected monitor must not hide the reopened transcript window',
  );
  await expect(reopened.getByLabel('Transcript phrases')).toContainText('Cai');
  // Context is editable without running recognition; batch inheritance is visible.
  await collectBeforeWindowClose(app);
  await reopened.close();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByText('Project game and video brief', { exact: true }).click();
  const projectContext = page.getByRole('region', { name: 'Project context', exact: true }).last();
  await projectContext.getByLabel('Game context').selectOption('set');
  await projectContext.getByLabel('Game name', { exact: true }).fill('Review game');
  await projectContext.getByLabel('Names and game terms (optional)').fill('Cai, Castor');
  await projectContext.getByLabel('Video brief (optional)').fill('Character development');
  await expect(projectContext).toContainText('Using: Review game');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Batch context', exact: true }).click();
  const batchContext = page.getByRole('region', { name: 'Batch context', exact: true });
  await batchContext.getByLabel('Game context').selectOption('inherit');
  await expect(batchContext).toContainText('Using: Review game');
  await batchContext.getByLabel('Video brief').selectOption('append');
  await batchContext.getByLabel('Batch brief', { exact: true }).fill('Opening scene');
  await batchContext.getByLabel('Game context').selectOption('none');
  await expect(batchContext).toContainText('Using: no specific game');
  await batchContext.getByLabel('Game context').selectOption('inherit');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  // Optional real installed-runtime acceptance: empty GPU location, then restore it.
  // A disposable profile and native picker stub protect the user's working settings.
  if (process.env.VIRTUAL_CUT_VERIFY_GPU === '1') {
    const next = app.waitForEvent('window');
    await page.getByRole('button', { name: 'Transcript', exact: true }).click();
    const view = await next;
    const before = await view.evaluate(() => window.virtualCut.transcript.runtime(true));
    assert.equal(before.configured, true);
    assert.equal(before.gpu.available, true);
    const empty = path.join(dir, 'empty-gpu');
    await mkdir(empty);
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, empty);
    await view.getByRole('button', { name: 'Speech engine', exact: true }).click();
    const advanced = view.locator('details', { hasText: 'Advanced: use my own Python' });
    if (!(await advanced.evaluate((d) => d.open))) await advanced.locator('summary').click();
    await view.getByRole('button', { name: 'Choose GPU runtime…', exact: true }).click();
    await expect(view.getByRole('region', { name: 'Speech engine settings' })).toContainText(empty);
    await view.getByRole('button', { name: 'Transcribe', exact: true }).click();
    const status = view.getByRole('region', { name: 'Transcription device readiness' });
    const start = view.getByRole('button', { name: 'Start transcription', exact: true });
    await expect(status.getByRole('alert')).toContainText('Automatic will use CPU');
    await expect(start).toBeDisabled();
    await view.getByLabel('Continue this request on CPU').check();
    await expect(start).toBeEnabled();
    await view.getByLabel('Processing device').selectOption('cuda');
    await expect(start).toBeDisabled();
    await expect(status.getByRole('alert')).toContainText('NVIDIA GPU is unavailable');
    const missing = await view.evaluate(() => window.virtualCut.transcript.runtime());
    for (const name of ['Import files', 'Import folder']) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.getByLabel('Transcribe this import locally').check();
      await expect(
        page.getByRole('region', { name: 'Transcription device readiness' }),
      ).toContainText('Automatic will use CPU');
      const choose = page.getByRole('button', {
        name: name === 'Import files' ? 'Choose files…' : 'Choose folder…',
        exact: true,
      });
      await expect(choose).toBeDisabled();
      await page.getByLabel('Continue this request on CPU').check();
      await expect(choose).toBeEnabled();
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    }
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, before.settings.gpuLibraries);
    await view.getByText('Advanced: use my own Python installation', { exact: true }).click();
    await view.getByRole('button', { name: 'Choose GPU runtime…', exact: true }).click();
    await view.getByLabel('Processing device').selectOption('auto');
    await status.getByRole('button', { name: 'Check again', exact: true }).click();
    await expect(status.getByRole('status')).toContainText('NVIDIA GPU is available');
    await expect(start).toBeEnabled();
    const restored = await view.evaluate(() => window.virtualCut.transcript.runtime());
    assert.equal(restored.settings.gpuLibraries, before.settings.gpuLibraries);
    assert.equal(restored.gpu.available, true);
    await writeFile(
      path.join(dir, 'actual-gpu-readiness.json'),
      JSON.stringify({ passed: true, before, missing, restored }, null, 2),
    );
    await collectBeforeWindowClose(app);
    await view.close();
    // Import calls the same real native probe with the restored, available runtime.
    await page.getByRole('button', { name: 'Import files', exact: true }).click();
    await page.getByLabel('Transcribe this import locally').check();
    await expect(
      page.getByRole('region', { name: 'Transcription device readiness' }),
    ).toContainText('NVIDIA GPU is available');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }
  // Consent belongs to each import, rather than silently carrying forward.
  await app.evaluate(({ ipcMain }) => {
    globalThis.gpuTest = { available: false, configured: true, calls: 0 };
    ipcMain.removeHandler('transcript:runtime');
    ipcMain.handle('transcript:runtime', async () => {
      globalThis.gpuTest.calls++;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return {
        configured: globalThis.gpuTest.configured,
        settings: { device: 'auto' },
        gpu: { available: globalThis.gpuTest.available, message: 'Synthetic NVIDIA runtime check' },
      };
    });
  });
  for (const name of ['Import files', 'Import folder']) {
    await page.getByRole('button', { name, exact: true }).click();
    const consent = page.getByLabel('Transcribe this import locally');
    await expect(consent).not.toBeChecked();
    await consent.check();
    const submit = page.getByRole('button', {
      name: name === 'Import files' ? 'Choose files…' : 'Choose folder…',
      exact: true,
    });
    const readiness = page.getByRole('region', { name: 'Transcription device readiness' });
    await expect(submit).toBeDisabled();
    await expect(readiness.getByRole('alert')).toContainText('Automatic will use CPU');
    await expect(submit).toBeDisabled();
    await page.getByLabel('Continue this request on CPU').check();
    await expect(submit).toBeEnabled();
    await page.getByLabel('Processing device').selectOption('cpu');
    await expect(readiness).toHaveCount(0);
    await expect(submit).toBeEnabled();
    await page.getByLabel('Processing device').selectOption('auto');
    await expect(page.getByLabel('Continue this request on CPU')).not.toBeChecked();
    await expect(submit).toBeDisabled();
    await app.evaluate(() => {
      globalThis.gpuTest.available = true;
    });
    await page.getByRole('button', { name: 'Check again', exact: true }).click();
    await expect(readiness.getByRole('status')).toContainText('NVIDIA GPU is available');
    await expect(submit).toBeEnabled();
    await app.evaluate(() => {
      globalThis.gpuTest.available = false;
    });
    await page.getByLabel('Processing device').selectOption('cuda');
    await expect(readiness.getByRole('alert')).toContainText('NVIDIA GPU is unavailable');
    await expect(submit).toBeDisabled();
    await page.getByLabel('Processing device').selectOption('cpu');
    await expect(submit).toBeEnabled();
    await expect(page.getByLabel('Transcribe audio')).toHaveValue('both');
    await expect(page.getByLabel('Processing device')).toHaveValue('cpu');
    await page.getByLabel('Transcribe audio').selectOption('mic');
    await page.getByLabel('Speech language').selectOption('en');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }
  const deviceWindow = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Transcript', exact: true }).click();
  const deviceView = await deviceWindow;
  deviceView.on('pageerror', (e) => errors.push(e.message));
  await deviceView.getByRole('button', { name: 'Transcribe', exact: true }).click();
  await expect(
    deviceView.getByRole('region', { name: 'Transcription device readiness' }).getByRole('alert'),
  ).toContainText('Automatic will use CPU');
  await expect(
    deviceView.getByRole('button', { name: 'Start transcription', exact: true }),
  ).toBeDisabled();
  await deviceView.getByLabel('Continue this request on CPU').check();
  await expect(
    deviceView.getByRole('button', { name: 'Start transcription', exact: true }),
  ).toBeEnabled();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#transcript'))
      .setSize(500, 600),
  );
  assert.equal(
    await deviceView.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  const warningImage = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#transcript'))
        .webContents.capturePage(undefined, { stayHidden: true })
    )
      .toPNG()
      .toString('base64'),
  );
  await writeFile(path.join(dir, 'gpu-warning-compact.png'), Buffer.from(warningImage, 'base64'));
  await collectBeforeWindowClose(app);
  await deviceView.close();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const savedContexts = await page.evaluate(
    async () => (await window.virtualCut.project.current()).model.contexts,
  );
  assert.equal(savedContexts.find((c) => c.id === 'project').game.name, 'Review game');
  assert.ok(
    savedContexts.some(
      (c) => c.gameMode === 'inherit' && c.briefMode === 'append' && c.brief === 'Opening scene',
    ),
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(dir, 'result.json'),
    JSON.stringify(
      {
        fixture,
        wordSeek: position,
        anchor,
        seekErrorSeconds: Math.abs(position - anchor),
        passed: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `Floating transcript, seeking, corrections, Undo, phrase timing, reopen and IPC isolation passed: ${dir}`,
  );
} catch (error) {
  if (app) {
    const main = await app.firstWindow();
    await writeFile(path.join(dir, 'failure.html'), await main.content());
  }
  throw error;
} finally {
  if (app) await app.close();
}
