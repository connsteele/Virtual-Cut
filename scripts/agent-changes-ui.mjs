import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
import { collectBeforeWindowClose } from './coverage-desktop.mjs';

// VC-204: an agent proposes changes to markers and clips already in the project, and amends its
// own pending cards. The cards show before and after (chips closed, a Changes table open, the
// swatch color picker in Edit, kind icons), accepting edits the project like the user would, so
// Undo in the main window returns the card to review, and Reopen puts the old values back.
const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(base, 'Run with the test suite so all media is disposable.');
const fixture = JSON.parse(await readFile(path.join(base, 'transcripts/latest.json'), 'utf8'));
await mkdir(path.join(base, 'agent-changes'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'agent-changes/run-'));
const file = path.join(dir, 'changes.vcut');
await copyFile(fixture.file, file);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const service = new ProjectService(path.join(dir, 'native-profile'), '');
await service.open(file);
const store = service.store;
const rid = fixture.rid;
const recording = store.data.model.recordings.find((r) => r.id === rid);
const d = recording.duration;
const at = (f) => Math.round(d * f * 100) / 100;
const fingerprint = store.sources().find((s) => s.id === rid).fingerprint;
const lines = ['Okay, landing on Eden Prime.', 'There goes Nihlus.', 'Ashley! Get down!'];
store.transcripts.begin({
  ...store.transcripts.get(fixture.transcriptId),
  id: 'change-mic',
  role: 'mic',
  state: 'complete',
  fingerprint,
  segmentCount: lines.length,
  wordCount: lines.length,
});
lines.forEach((text, i) =>
  store.transcripts.append('change-mic', {
    id: i,
    start: at(0.1 + i * 0.25),
    end: at(0.2 + i * 0.25),
    text,
    words: [{ text, start: at(0.1 + i * 0.25), end: at(0.2 + i * 0.25), probability: 1 }],
    noSpeechProbability: 0,
    averageLogProbability: 0,
  }),
);
const marker = (id, f, name, extra = {}) => ({
  id,
  time: at(f),
  name,
  category: 'Context',
  topic: '',
  note: '',
  color: 'Blue',
  ...extra,
});
const before = store.data.model;
store.save(before, {
  ...before,
  cueDecisions: [],
  markers: {
    ...before.markers,
    [rid]: [
      marker('m-landing', 0.1, 'Eden Prime landing', { note: 'Landing.' }),
      marker('m-ashley', 0.6, 'Ashley joins'),
    ],
  },
  clips: [
    {
      id: 'k-arrival',
      rid,
      name: 'Eden Prime arrival',
      start: 0,
      end: at(0.9),
      include: true,
      folder: '_Review',
    },
  ],
});
// Two cards seeded as an agent left them: one whose marker the user has since deleted, and one
// whose marker the user renamed after the agent looked.
const seeded = (id, targetId, seen, set, time) => ({
  id,
  sourceId: rid,
  kind: 'edit',
  time,
  title: set.name ?? seen.name ?? 'Marker',
  text: '',
  reason: 'From the color key in the brief.',
  edit: { target: 'marker', targetId, seen, set },
  evidence: [],
  agent: { clientId: 'earlier-app', name: 'Claude Code' },
  submitted: '2026-11-09T18:00:00Z',
  submissionId: 'seed',
  projectRevision: 1,
});
store.proposals.add([
  seeded('seed-gone', 'm-beacon', { color: 'Blue', name: 'Beacon' }, { color: 'Red' }, at(0.8)),
  seeded(
    'seed-since',
    'm-ashley',
    { name: 'Ashley', color: 'Blue' },
    { name: 'Ashley Williams joins', color: 'Purple' },
    at(0.6),
  ),
]);
await service.checkpoint(fixture.id);
await service.close();

const errors = [];
let app, main;
function agent(config) {
  const { command, args, env = {} } = JSON.parse(config).mcpServers['virtual-cut'];
  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...electronEnvironment(), ...env },
  });
  let out = '',
    stderr = '',
    id = 0;
  const waiting = new Map();
  child.stdout.on('data', (data) => {
    out += data;
    let end;
    while ((end = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, end).trim();
      out = out.slice(end + 1);
      if (line) {
        const message = JSON.parse(line);
        waiting.get(message.id)?.(message);
      }
    }
  });
  child.stderr.on('data', (data) => (stderr += data));
  const exited = new Promise((resolve) => child.on('exit', resolve));
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      const timer = setTimeout(() => reject(new Error(`${method} timed out: ${stderr}`)), 20000);
      waiting.set(n, (m) => (clearTimeout(timer), resolve(m)));
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });
  return {
    call,
    notify: (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'),
    end: () => child.stdin.end(),
    exited,
  };
}
const tool = async (client, name, args = {}) => {
  const reply = await client.call('tools/call', { name, arguments: args });
  const text = reply.result.content[0].text;
  return { error: !!reply.result.isError, text, json: () => JSON.parse(text) };
};
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
  main = await app.firstWindow();
  main.setDefaultTimeout(20000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.locator('[data-workflow]').waitFor();
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
  }, file);
  await main.getByRole('button', { name: 'Projects', exact: true }).click();
  await main.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await main.getByRole('button', { name: 'Agent', exact: true }).click();
  const panel = main.locator('[data-agent-access]');
  await panel.getByLabel('Allow agent apps to connect').click();
  await panel.getByRole('button', { name: /^Pair with / }).click();
  const config = await panel.locator('[data-config="claude-desktop"]').textContent();
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  const client = agent(config);
  await client.call('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'agent-changes-check', version: '1' },
  });
  client.notify('notifications/initialized');
  const listed = (await client.call('tools/list', {})).result.tools;
  for (const name of ['propose_changes', 'amend_proposal'])
    assert.deepEqual(
      listed.find((t) => t.name === name).annotations,
      { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      name,
    );
  const annotations = (await tool(client, 'get_annotations', { recording_id: rid })).json();
  assert.equal(annotations.clips[0].clipColor, undefined);

  // Changes to a marker and a clip already in the project.
  const changed = await tool(client, 'propose_changes', {
    recording_id: rid,
    changes: [
      {
        marker_id: 'm-landing',
        color: 'Green',
        note: 'The Normandy lands; first squad moment.',
        reason: 'Squad moments are Green in the color key.',
      },
      {
        clip_id: 'k-arrival',
        title: 'Eden Prime: first contact',
        end_seconds: at(0.8),
        clip_color: 'Teal',
        reason: 'The beacon walk has its own clip; Teal is for first visits.',
      },
    ],
    agent_model: 'check-model',
  });
  assert(!changed.error, changed.text);
  const [markerChange, clipChange] = changed.json().proposed.map((p) => p.id);
  assert.deepEqual(changed.json().proposed[0].before, { color: 'Blue', note: 'Landing.' });
  const again = await tool(client, 'propose_changes', {
    recording_id: rid,
    changes: [{ marker_id: 'm-landing', color: 'Red', reason: 'r' }],
  });
  assert.match(again.text, /already targets this marker; amend it with amend_proposal/);
  // A clip range with a clip color, and a marker the agent amends twice.
  const submitted = await tool(client, 'submit_proposals', {
    recording_id: rid,
    proposals: [
      {
        kind: 'clip',
        time_seconds: at(0.55),
        end_seconds: at(0.75),
        title: 'Ashley holds the line',
        clip_color: 'Purple',
        reason: 'The whole fight is a clip.',
      },
      { kind: 'marker', time_seconds: at(0.35), title: 'Nihlus goes alone', reason: 'He leaves.' },
    ],
  });
  assert(!submitted.error, submitted.text);
  const [fight, nihlus] = submitted.json().submitted.map((p) => p.id);
  const amend1 = await tool(client, 'amend_proposal', {
    proposal_id: nihlus,
    color: 'Yellow',
    title: 'Nihlus splits off',
    reason: 'Squad departures are Yellow.',
  });
  assert(!amend1.error, amend1.text);
  assert.equal(amend1.json().version, 2);
  const amend2 = await tool(client, 'amend_proposal', {
    proposal_id: nihlus,
    end_seconds: at(0.45),
    reason: 'The scene runs to the cutaway.',
  });
  assert.equal(amend2.json().version, 3);
  const otherApp = await tool(client, 'amend_proposal', {
    proposal_id: 'seed-since',
    color: 'Red',
  });
  assert.match(otherApp.text, /another paired app/);
  await expect(
    panel.locator('[data-agent-activity] li', {
      hasText: 'the card changed in the transcript window',
    }),
  ).toHaveCount(2);

  const opened = app.waitForEvent('window');
  await main.getByRole('button', { name: 'Transcript', exact: true }).click();
  const view = await opened;
  view.on('pageerror', (e) => errors.push(e.message));
  await view.getByLabel('Select transcript', { exact: true }).selectOption('change-mic');
  const card = (id) => view.locator(`[data-proposal-card="${id}"]`);
  const landing = card(markerChange),
    arrival = card(clipChange),
    since = card('seed-since'),
    gone = card('seed-gone'),
    fightCard = card(fight),
    nihlusCard = card(nihlus);
  await expect(view.locator('[data-proposal-card]:not([data-proposal-card^="cue:"])')).toHaveCount(
    6,
  );
  // Kind icons between the Agent tag and the kind; a change card's carries the pencil.
  await expect(landing).toContainText('Change marker');
  await expect(landing.locator('[data-card-icon="marker"]')).toHaveCount(1);
  await expect(landing.locator('[data-card-icon] svg')).toHaveCount(2);
  await expect(arrival.locator('[data-card-icon="clip"]')).toHaveCount(1);
  await expect(fightCard.locator('[data-card-icon="clip"]')).toHaveCount(1);
  await expect(nihlusCard.locator('[data-card-icon="range"]')).toHaveCount(1);
  // Closed: line 2 shows the new color only; the chips carry the change with both swatches.
  await expect(landing.locator('[data-proposal-chips="changes"]')).toContainText(
    /Changes\s*Color\s*Blue\s*→\s*Green\s*Note/,
  );
  await expect(arrival.locator('[data-proposal-chips="changes"]')).toContainText('Name');
  await expect(arrival.locator('[data-proposal-chips="changes"]')).toContainText('Clip color');
  await expect(arrival.locator('[data-proposal-chips="changes"]')).toContainText(/None\s*→\s*Teal/);
  await expect(arrival).toContainText('was');
  await expect(since).toContainText('Changed since proposed');
  await expect(gone).toContainText('Marker deleted');
  await expect(gone.getByRole('button', { name: /gone/ })).toBeDisabled();
  await expect(fightCard).toContainText('Blue as range marker');
  await expect(fightCard.locator('[data-color-kind="clip"]')).toHaveAttribute(
    'data-proposal-color',
    'Purple',
  );
  await expect(nihlusCard).toContainText('Amended 2×');
  await expect(nihlusCard.locator('[data-proposal-chips="amended"]')).toContainText('End added at');
  await view.screenshot({ path: path.join(dir, 'change-cards.png'), fullPage: true });

  // Open: the chips give way to a centered Changes header over before and after.
  await landing.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(landing.locator('[data-proposal-chips]')).toHaveCount(0);
  const table = landing.getByRole('table', { name: `Changes ${markerChange}` });
  await expect(table).toContainText('Color');
  await expect(table).toContainText('Landing.');
  await expect(landing).toContainText('Stays the same: name, time, end');
  await since.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(since.getByRole('table')).toContainText('now');
  await landing.scrollIntoViewIfNeeded();
  await view.screenshot({ path: path.join(dir, 'change-open.png') });
  // Edit changes only the After column; the picker shows a swatch before every color.
  await landing.getByRole('button', { name: 'Edit', exact: true }).click();
  const picker = landing.getByRole('button', { name: /^Change color/ });
  await picker.click();
  const list = landing.getByRole('listbox');
  await expect(list.getByRole('option')).toHaveCount(16);
  await expect(list.getByRole('option', { selected: true })).toContainText('Green');
  await landing.scrollIntoViewIfNeeded();
  await view.screenshot({ path: path.join(dir, 'change-picker.png') });
  // Keys stay in the picker: M jumps to Mint, Enter picks it; A never accepts from here.
  await view.keyboard.press('m');
  await view.keyboard.press('Enter');
  await expect(list).toHaveCount(0);
  await expect(picker).toHaveAccessibleName(`Change color ${markerChange}: Mint`);
  await picker.press('a');
  await expect(landing).toHaveAttribute('data-status', 'pending');
  await expect(landing.locator('[data-proposal-chips]')).toHaveCount(0);
  await landing.getByRole('button', { name: 'Done editing', exact: true }).click();
  await landing
    .getByRole('button', { name: /^Accept/ })
    .first()
    .click();
  await expect(landing).toHaveAttribute('data-status', 'accepted');
  await expect(landing.locator('[data-proposal-chips="kept"]')).toContainText(
    'you changed the color',
  );
  const markersNow = async () =>
    (await tool(client, 'get_annotations', { recording_id: rid })).json().recordings[0].markers;
  assert.equal((await markersNow()).find((m) => m.id === 'm-landing').color, 'Mint');
  const read = (
    await tool(client, 'get_proposal_decisions', { proposal_ids: [markerChange] })
  ).json().proposals[0];
  assert.deepEqual([read.kind, read.chosen.color, read.userChanged], ['change', 'Mint', ['color']]);
  // Undo in the main window takes the accept back: the marker is Blue and the card waits again.
  await main.bringToFront();
  await main.keyboard.press('Control+z');
  await expect(landing).toHaveAttribute('data-status', 'pending');
  assert.equal((await markersNow()).find((m) => m.id === 'm-landing').color, 'Blue');
  // The card keeps the user's version; accept it again, then Reopen: the old values come back.
  await expect(landing.getByRole('table', { name: `Changes ${markerChange}` })).toContainText(
    'Mint',
  );
  await landing
    .getByRole('button', { name: /^Accept/ })
    .first()
    .click();
  await expect(landing).toHaveAttribute('data-status', 'accepted');
  assert.equal((await markersNow()).find((m) => m.id === 'm-landing').color, 'Mint');
  await landing.getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(landing).toHaveAttribute('data-status', 'pending');
  const reopened = (await markersNow()).find((m) => m.id === 'm-landing');
  assert.deepEqual([reopened.color, reopened.note], ['Blue', 'Landing.']);

  // The clip change trims, renames and colors the clip.
  await arrival
    .getByRole('button', { name: /^Accept/ })
    .first()
    .click();
  await expect(arrival).toHaveAttribute('data-status', 'accepted');
  const clipNow = (await tool(client, 'get_annotations', { recording_id: rid }))
    .json()
    .clips.find((c) => c.id === 'k-arrival');
  assert.deepEqual(
    [clipNow.name, clipNow.end, clipNow.clipColor],
    ['Eden Prime: first contact', at(0.8), 'Teal'],
  );
  // The new clip range keeps its clip color when accepted as a clip.
  await fightCard.getByRole('button', { name: 'Accept as clip', exact: true }).first().click();
  await expect(fightCard).toHaveAttribute('data-status', 'accepted');
  const fightRow = (await tool(client, 'get_proposal_decisions', { proposal_ids: [fight] })).json()
    .proposals[0];
  assert.equal(fightRow.chosen.clipColor, 'Purple');

  // An amended card opens to the newest amend's table and every version, newest first.
  await nihlusCard.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(nihlusCard.getByRole('table', { name: `Amend ${nihlus}` })).toContainText(
    'Before · v2',
  );
  const versions = nihlusCard.locator(`[data-proposal-versions="${nihlus}"] [data-version]`);
  await expect(versions).toHaveCount(3);
  await expect(versions.first()).toHaveAttribute('data-version', '3');
  await expect(versions.nth(1)).toContainText('Squad departures are Yellow.');
  await nihlusCard.scrollIntoViewIfNeeded();
  await view.screenshot({ path: path.join(dir, 'amended-open.png') });
  // The compact window keeps the table and the picker usable.
  const resize = (compact) =>
    app.evaluate(({ BrowserWindow }, compact) => {
      const w = BrowserWindow.getAllWindows().find((x) =>
        x.webContents.getURL().endsWith('#transcript'),
      );
      if (compact) {
        globalThis.__transcriptBounds = w.getBounds();
        w.setSize(500, 700);
      } else w.setBounds(globalThis.__transcriptBounds);
    }, compact);
  await resize(true);
  await since.getByRole('button', { name: 'Edit', exact: true }).click();
  await since.getByRole('button', { name: /^Change color/ }).click();
  const compactList = since.getByRole('listbox');
  await expect(compactList).toBeVisible();
  const box = await compactList.boundingBox();
  const width = await view.evaluate(() => document.documentElement.clientWidth);
  assert(box.x >= 0 && box.x + box.width <= width + 1, 'the picker stays inside the window');
  await since.scrollIntoViewIfNeeded();
  await view.screenshot({ path: path.join(dir, 'change-compact.png') });
  await view.keyboard.press('Escape');
  await expect(compactList).toHaveCount(0);
  await resize(false);
  client.end();
  await client.exited;
  assert.deepEqual(errors, []);
  await collectBeforeWindowClose(app);
  console.log(JSON.stringify({ passed: true, dir }));
} catch (e) {
  await main?.screenshot({ path: path.join(dir, 'failure.png') }).catch(() => {});
  console.error({ errors, dir });
  throw e;
} finally {
  if (app && app.process().exitCode === null) await app.close();
}
