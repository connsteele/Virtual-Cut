import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  agentNotes,
  compareVersions,
  intentGuideLine,
  notesSince,
  releaseNotes,
  releaseNotesProblem,
  releaseOf,
  toolsNamed,
  unreadNotice,
} from '../dist-electron/release-notes.js';
const require = createRequire(import.meta.url);
const { AgentAccess } = require('../dist-electron/agent-access.cjs');

// What's new (VC-242): the notes built into each version, for the user and for agents.
const note = (version, extra = {}) => ({
  version,
  date: '2026-11-06',
  title: `Release ${version}`,
  user: ['A change.'],
  agents: { tools: [`Agents in ${version}.`], intentGuide: 4 },
  ...extra,
});
const sample = [note('0.4.30'), note('0.4.28'), note('0.4.29'), note('0.4.10')];

test('versions compare by number, and test builds read their release', () => {
  assert.equal(releaseOf('0.4.30-71'), '0.4.30');
  assert(compareVersions('0.4.10', '0.4.9') > 0);
  assert(compareVersions('0.4.29', '0.4.30-71') < 0);
  assert.equal(compareVersions('0.4.30-71', '0.4.30'), 0);
  assert.deepEqual(
    notesSince('0.4.30-71', '0.4.28', sample).map((n) => n.version),
    ['0.4.30', '0.4.29'],
  );
  // Nothing newer than the running version, all of them without a starting point.
  assert.deepEqual(
    notesSince('0.4.29', undefined, sample).map((n) => n.version),
    ['0.4.29', '0.4.28', '0.4.10'],
  );
});

test('an agent that last read 0.4.28 gets the whole 0.4.29 and 0.4.30 notes', () => {
  const notes = [
    note('0.4.30', {
      draft: true,
      agents: { tools: ['New `a_tool`.'], doNow: ['Do this.'], gaps: ['Not yet.'], intentGuide: 5 },
    }),
    note('0.4.29', { agents: { tools: [], intentGuide: 4 } }),
    note('0.4.28'),
  ];
  const answer = agentNotes('0.4.30-71', '0.4.28', 'last read', notes);
  assert.equal(answer.since, '0.4.28');
  assert.equal(answer.basis, 'last read');
  assert.deepEqual(answer.versions[0], {
    version: '0.4.30',
    date: '2026-11-06',
    title: 'Release 0.4.30',
    status:
      "Draft notes: they may change before 0.4.30 is delivered. Every delivered version's notes are final.",
    forAgents: {
      tools: ['New `a_tool`.'],
      doDifferentlyNow: ['Do this.'],
      knownGaps: ['Not yet.'],
      intentGuide: 'Version 5: read `get_intent_guide` again.',
    },
    forTheUser: ['A change.'],
  });
  // Empty groups are left out; an empty tool list says so.
  assert.deepEqual(answer.versions[1].forAgents, {
    tools: ['No tool changes.'],
    intentGuide: 'Version 4, unchanged.',
  });
  assert.equal(answer.versions[1].status, 'Final.');
  assert.equal(intentGuideLine(notes[2], notes), 'Version 4.');
  const current = agentNotes('0.4.30', '0.4.30', 'last read', sample);
  assert.deepEqual(current.versions, []);
  assert.match(current.note, /Nothing new since 0\.4\.30/);
  assert.equal(
    unreadNotice('0.4.30-71', '0.4.28', sample).split('. Call')[0] + '.',
    'Virtual Cut is at 0.4.30-71, and this app has not read the release notes for 0.4.29 to 0.4.30.',
  );
  assert.match(unreadNotice('0.4.29', '0.4.28', sample), /notes for 0\.4\.29\. Call get_whats_new/);
  assert.equal(unreadNotice('0.4.30', '0.4.30', sample), '');
});

test('delivery refuses a version without finished notes', () => {
  assert.equal(releaseNotesProblem('0.4.29', sample), '');
  assert.match(releaseNotesProblem('0.4.31', sample), /no entry for 0\.4\.31/);
  assert.match(
    releaseNotesProblem('0.4.30-71', [note('0.4.30', { draft: true })]),
    /0\.4\.30 entry .+ still a draft/,
  );
  assert.match(releaseNotesProblem('0.4.30', [note('0.4.30', { user: [] })]), /user notes/);
  assert.match(releaseNotesProblem('0.4.30', [note('0.4.30', { date: 'Nov 9' })]), /YYYY-MM-DD/);
});

test('the shipped notes are complete, newest first and free of private details', () => {
  const versions = releaseNotes.map((n) => n.version);
  assert.deepEqual(
    versions,
    [...versions].sort((a, b) => compareVersions(b, a)),
  );
  for (const v of ['0.4.26', '0.4.27', '0.4.28', '0.4.29'])
    assert.equal(releaseNotesProblem(v), '', v);
  for (const n of releaseNotes) {
    const a = n.agents;
    const lines = [n.title, ...n.user, ...a.tools, ...(a.doNow || []), ...(a.gaps || [])];
    const text = lines.join('\n');
    // The repository is public: no board links, ticket ids, drive paths or file locations.
    assert.doesNotMatch(text, /https?:|notion|VC-\d|\b[A-Z]:[\\/]|\\Users\\/i, n.version);
    assert.equal(text.split('`').length % 2, 1, `${n.version} has an unclosed backtick`);
    assert(Number.isInteger(a.intentGuide), n.version);
  }
  // Tools first offered in these versions are named in their notes; the desktop check compares
  // the server's whole tool list.
  for (const t of ['look', 'withdraw_proposals', 'propose_changes', 'amend_proposal'])
    assert(toolsNamed().has(t), t);
});

test('pairings remember the version they were paired on and the notes they read', async (t) => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'vc-release-notes-'));
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));
  const access = new AgentAccess(folder);
  const { client: old } = await access.pair({ id: 'p', name: 'P' }, 'Old app');
  access.version = '0.4.30';
  const { client } = await access.pair({ id: 'p', name: 'P' }, 'Claude Code');
  assert.equal(client.pairedVersion, '0.4.30');
  assert.equal(access.notesFrom(old.id), undefined, 'older pairings read every note');
  assert.equal(access.notesFrom(client.id), '0.4.30');
  access.notesWereRead(old.id, '0.4.28');
  assert.equal(access.notesFrom(old.id), '0.4.28');
  // The write is queued: read the saved pairing back once it has landed.
  await new Promise((r) => setTimeout(r, 100));
  const reread = new AgentAccess(folder).state().clients.find((c) => c.id === old.id);
  assert.equal(reread.notesRead, '0.4.28');
  assert.match(reread.notesReadAt, /^\d{4}-\d{2}-\d{2}T/);
});
