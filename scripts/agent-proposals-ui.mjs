import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
import { collectBeforeWindowClose } from './coverage-desktop.mjs';

// VC-161/VC-162/VC-155: an agent app reads the intent guide and proposes over MCP, the proposals
// wait on proposal cards in the transcript window (one card with the spoken cue an agent
// reworks), the user decides or reopens there, and the agent reads the decisions back.
const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(base, 'Run with the test suite so all media is disposable.');
const fixture = JSON.parse(await readFile(path.join(base, 'transcripts/latest.json'), 'utf8'));
await mkdir(path.join(base, 'agent-proposals'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'agent-proposals/run-'));
const file = path.join(dir, 'proposals.vcut');
await copyFile(fixture.file, file);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const service = new ProjectService(path.join(dir, 'native-profile'), '');
await service.open(file);
const store = service.store;
const recording = store.data.model.recordings.find((r) => r.id === fixture.rid);
const fingerprint = store.sources().find((s) => s.id === fixture.rid).fingerprint;
const lines = [
  'Okay, starting the fort chapter.',
  'Marker, Bertrand shows up here.',
  'This is where the siege starts.',
  'Siege is over, cut it here.',
];
const step = Math.min(4, recording.duration / (lines.length + 1));
store.transcripts.begin({
  ...store.transcripts.get(fixture.transcriptId),
  id: 'agent-mic',
  role: 'mic',
  state: 'complete',
  fingerprint,
  segmentCount: lines.length,
  wordCount: lines.length,
});
lines.forEach((text, i) =>
  store.transcripts.append('agent-mic', {
    id: i,
    start: i * step,
    end: i * step + step * 0.8,
    text,
    words: [{ text, start: i * step, end: i * step + step * 0.8, probability: 1 }],
    noSpeechProbability: 0,
    averageLogProbability: 0,
  }),
);
const before = store.data.model;
store.save(before, {
  ...before,
  cueDecisions: [],
  clips: [
    {
      id: 'whole',
      rid: fixture.rid,
      name: 'Whole session',
      start: 0,
      end: recording.duration,
      include: true,
      folder: '_Review',
    },
  ],
});
await service.checkpoint(fixture.id);
const media = store.sources().find((s) => s.id === fixture.rid).file;
await writeFile(
  media.slice(0, media.length - path.extname(media).length) + '.txt',
  '00:01:00\n{marker, general}\nNice crit here [Peter]\n\n00:02:00\n[cough]\n',
);
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
  child.stdout.on('data', (d) => {
    out += d;
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
  child.stderr.on('data', (d) => (stderr += d));
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
    clientInfo: { name: 'agent-proposals-check', version: '1' },
  });
  client.notify('notifications/initialized');
  const listed = (await client.call('tools/list', {})).result.tools;
  const submitTool = listed.find((t) => t.name === 'submit_proposals');
  assert.deepEqual(submitTool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  });
  assert.equal(submitTool.inputSchema.properties.proposals.type, 'array');
  assert.equal(
    listed.find((t) => t.name === 'get_proposal_decisions').annotations.readOnlyHint,
    true,
  );

  // The intent guide: the shipped guide plus the tagged notes beside other recordings only.
  const guide = (await tool(client, 'get_intent_guide')).json();
  assert.equal(guide.guide.version, '1');
  assert.deepEqual(
    guide.examples.map((e) => [e.from, e.time, e.intents.join('+'), e.context]),
    [['tagged notes', 1, 'marker+general', 'Peter']],
  );
  assert.deepEqual(
    (await tool(client, 'get_intent_guide', { recording_id: fixture.rid })).json().examples,
    [],
    "the recording's own notes are left out",
  );

  const mic = (
    await tool(client, 'get_transcript', { recording_id: fixture.rid, role: 'mic' })
  ).json();
  assert.equal(mic.transcriptId, 'agent-mic');
  const evidence = (ids) => [{ role: 'mic', transcript_id: mic.transcriptId, line_ids: ids }];
  const proposals = [
    {
      kind: 'marker',
      time_seconds: mic.lines[1].start,
      title: 'Bertrand arrives',
      note: 'He shows up at the fort.',
      reason: 'You said "Marker, Bertrand shows up here."',
      intents: ['marker', 'general'],
      refines: { transcript_id: mic.transcriptId, line_id: 1 },
      evidence: evidence([1]),
    },
    {
      kind: 'split',
      time_seconds: mic.lines[3].start,
      title: 'Siege ends',
      clip_names: { first: 'Fort and siege', second: 'Talking to Bertrand' },
      reason: 'You asked to cut when the siege is over.',
      intent: 'edit',
      evidence: evidence([3]),
    },
    {
      kind: 'clip',
      time_seconds: mic.lines[2].start,
      end_seconds: mic.lines[3].end,
      title: 'The siege',
      reason: 'From the siege start to its end.',
      evidence: evidence([2, 3]),
    },
    {
      kind: 'marker',
      time_seconds: mic.lines[2].start,
      end_seconds: mic.lines[3].end,
      title: 'Siege scene',
      note: 'The siege as one part of the fort chapter.',
      reason: 'One continuous scene: labelled, not cut.',
      intents: ['marker', 'notion'],
      notion: { target: 'new' },
      evidence: evidence([2, 3]),
    },
  ];
  // A stale citation refuses the whole call and names the field.
  const stale = await tool(client, 'submit_proposals', {
    recording_id: fixture.rid,
    proposals: [
      proposals[0],
      { ...proposals[1], evidence: [{ ...evidence([3])[0], transcript_id: 'old' }] },
    ],
  });
  assert(stale.error);
  assert.match(stale.text, /^proposals\[1\]\.evidence\[0\]\.transcript_id: stale or unknown/);
  const submitted = await tool(client, 'submit_proposals', {
    recording_id: fixture.rid,
    proposals,
    agent_model: 'check-model',
  });
  assert(!submitted.error, submitted.text);
  assert.equal(submitted.json().submitted[0].reworks, `mark cue at ${mic.lines[1].start} s`);
  const ids = submitted.json().submitted.map((p) => p.id);
  assert.equal(ids.length, 4);
  assert.equal(
    (await tool(client, 'get_annotations', { recording_id: fixture.rid })).json().recordings[0]
      .markers.length,
    0,
    'nothing changes until the user decides',
  );
  const repeat = await tool(client, 'submit_proposals', {
    recording_id: fixture.rid,
    proposals: [{ ...proposals[0], refines: undefined }],
  });
  assert.match(repeat.text, /repeats pending proposal/);
  await expect(
    panel.locator('[data-agent-activity] li', {
      hasText: `Proposed 4 for ${recording.title} · waiting in the transcript window`,
    }),
  ).toHaveCount(1);

  const opened = app.waitForEvent('window');
  await main.getByRole('button', { name: 'Transcript', exact: true }).click();
  const view = await opened;
  view.on('pageerror', (e) => errors.push(e.message));
  await view.getByLabel('Select transcript', { exact: true }).selectOption('agent-mic');
  const cards = view.locator('[data-proposal-card]:not([data-proposal-card^="cue:"])');
  await expect(cards).toHaveCount(4);
  // The agent reworked the spoken Marker cue on line 1: one card with both tags, not two.
  await expect(view.locator('[data-proposal-card^="cue:"]')).toHaveCount(0);
  await expect(view.locator('[data-filter="pending"] span')).toHaveText('4');
  const [marker, split, clip, range] = ids.map((id) =>
    view.locator(`[data-proposal-card="${id}"]`),
  );
  await expect(marker).toContainText('Spoken');
  await expect(marker).toContainText('Agent');
  await expect(marker).toContainText('Changed: retitled · note written');
  await expect(range).toContainText('Range marker');
  // A range has two times to jump to: its start and its end.
  await range.getByTitle('Go to the end', { exact: true }).click();
  await expect
    .poll(async () =>
      Math.abs((await main.locator('video').evaluate((v) => v.currentTime)) - mic.lines[3].end),
    )
    .toBeLessThan(0.05);
  await expect(range).toContainText('Range');
  await expect(range).toContainText('Notion: new note');
  await marker.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(marker).toContainText('Heard first');
  await expect(marker).toContainText('Marker, Bertrand shows up here.');
  await expect(marker).toContainText('Why: You said');
  await expect(marker).toContainText('Claude Code (check-model)');
  await marker.scrollIntoViewIfNeeded();
  await view.screenshot({ path: path.join(dir, 'proposal-cards.png') });
  // The compact transcript window keeps every field and button reachable.
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
  await expect.poll(() => view.evaluate(() => window.innerWidth)).toBeLessThan(520);
  await marker.scrollIntoViewIfNeeded();
  await view.screenshot({ path: path.join(dir, 'proposal-compact.png') });
  await resize(false);

  // Edit opens the fields in place; the nudges move the position by tenths.
  const moved = Math.round((mic.lines[1].start + 0.5) * 1000) / 1000;
  await marker.getByRole('button', { name: 'Edit', exact: true }).click();
  await view.getByLabel(`Proposal position ${ids[0]}`, { exact: true }).fill(String(moved - 0.2));
  await view.getByLabel(`Proposal position ${ids[0]} +0.1 s`).click();
  await view.getByLabel(`Proposal position ${ids[0]} +0.1 s`).click();
  // Times read like the ruler; Ctrl+Z on the card undoes its last change, then it is redone.
  const position = view.getByLabel(`Proposal position ${ids[0]}`, { exact: true });
  const ruler = (s) => {
    const ms = Math.round(s * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  };
  await expect(position).toHaveValue(ruler(moved));
  await position.focus();
  await view.keyboard.press('Control+z');
  await expect(position).toHaveValue(ruler(moved - 0.1));
  await view.getByLabel(`Proposal position ${ids[0]} +0.1 s`).click();
  await expect(position).toHaveValue(ruler(moved));
  await view.getByLabel(`Proposal title ${ids[0]}`).fill('Bertrand at the gate');
  await view.screenshot({ path: path.join(dir, 'proposal-edit.png') });
  await marker.getByRole('button', { name: 'Accept marker', exact: true }).click();
  await expect(marker).toHaveAttribute('data-status', 'accepted');
  await expect(marker).toContainText('✓ Accepted');
  await split.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(split.getByLabel(`Proposal split target ${ids[1]}`)).toHaveValue('whole');
  await expect(split.getByLabel(`Proposal first clip name ${ids[1]}`)).toHaveValue(
    'Fort and siege',
  );
  await split.getByLabel(`Proposal second clip name ${ids[1]}`).fill('Bertrand talk');
  await split.scrollIntoViewIfNeeded();
  await view.screenshot({ path: path.join(dir, 'proposal-split-names.png') });
  await split.getByRole('button', { name: 'Accept split', exact: true }).click();
  await expect(split).toHaveAttribute('data-status', 'accepted');
  // Reject folds in place; Reopen brings it back for review, here and for the agent.
  await clip.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(clip).toHaveAttribute('data-status', 'rejected');
  await clip.getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(clip).toHaveAttribute('data-status', 'pending');
  await clip.focus();
  await view.keyboard.press('r');
  await expect(clip).toHaveAttribute('data-status', 'rejected');
  // Reopening an accepted range marker takes the marker back.
  await range.getByRole('button', { name: 'Accept range marker', exact: true }).click();
  await expect(range).toHaveAttribute('data-status', 'accepted');
  await expect
    .poll(
      async () =>
        (await tool(client, 'get_annotations', { recording_id: fixture.rid })).json().recordings[0]
          .markers.length,
    )
    .toBe(2);
  await range.getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(range).toHaveAttribute('data-status', 'pending');
  await expect(view.locator('[data-filter="accepted"] span')).toHaveText('2');
  await view.locator('[data-filter="rejected"]').click();
  await expect(cards).toHaveCount(1);
  await view.screenshot({ path: path.join(dir, 'proposal-rejected-filter.png') });
  await view.locator('[data-filter="all"]').click();

  const decisions = (
    await tool(client, 'get_proposal_decisions', { recording_id: fixture.rid })
  ).json();
  assert.deepEqual(decisions.counts, { pending: 1, accepted: 2, rejected: 1 });
  const row = (id) => decisions.proposals.find((p) => p.id === id);
  assert.equal(row(ids[0]).chosen.time, moved);
  assert.equal(row(ids[0]).movedSeconds, 0.5);
  assert.equal(row(ids[0]).chosen.title, 'Bertrand at the gate');
  assert.equal(row(ids[0]).retitled, true);
  assert.deepEqual(row(ids[0]).intents, ['marker', 'general']);
  assert.equal(row(ids[0]).refines.heard, 'Marker, Bertrand shows up here.');
  assert.equal(row(ids[1]).status, 'accepted');
  assert.equal(row(ids[2]).status, 'rejected');
  assert.equal(row(ids[3]).status, 'pending');
  assert.deepEqual(row(ids[3]).notion, { target: 'new' });
  const annotated = (await tool(client, 'get_annotations', { recording_id: fixture.rid })).json();
  assert.deepEqual(
    annotated.recordings[0].markers.map((m) => m.name),
    ['Bertrand at the gate'],
    'the reopened range marker is gone',
  );
  assert.deepEqual(
    annotated.clips.map((c) => c.name),
    ['Fort and siege', 'Bertrand talk'],
    'the split made two clips with the names chosen on the card',
  );
  // Accepting the rework settled the spoken cue too.
  assert.equal(annotated.cueDecisions.filter((d) => d.kind === 'mark' && !d.proposalId).length, 1);
  assert.deepEqual(row(ids[1]).chosen.clipNames, {
    first: 'Fort and siege',
    second: 'Bertrand talk',
  });

  // Undo in the editor reverses the last change: the range marker is accepted again.
  await main.bringToFront();
  await main.keyboard.press('Control+z');
  await expect(range).toHaveAttribute('data-status', 'accepted');
  assert.equal(
    (await tool(client, 'get_proposal_decisions', { status: 'pending' })).json().proposals.length,
    0,
  );
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
