import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { AgentAccess, PicturesOff } = require('../dist-electron/agent-access.cjs');

const project = { id: 'project-1', name: 'Test project' };

async function profile(t) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'vc-agent-access-'));
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));
  return folder;
}

test('Allow pictures starts off and the picture check refuses', async (t) => {
  const access = new AgentAccess(await profile(t));
  const { client } = await access.pair(project, 'Claude Code');
  assert.equal(access.state().pictures, false);
  assert.equal(access.picturesAllowed(client.id), false);
  assert.throws(() => access.checkPictures(client.id), PicturesOff);
});

test('access saved before the setting existed reads as pictures off', async (t) => {
  const folder = await profile(t);
  const old = {
    id: 'old',
    name: 'Claude Desktop',
    projectId: 'p',
    projectName: 'P',
    paired: '2026-10-07T00:00:00.000Z',
    tokenHash: '00',
  };
  await writeFile(
    path.join(folder, 'agent-access.json'),
    JSON.stringify({ enabled: true, clients: [old], activity: [] }),
  );
  const access = new AgentAccess(folder);
  assert.equal(access.state().pictures, false);
  assert.throws(() => access.checkPictures('old'), PicturesOff);
});

test('one switch covers every paired app, applies to the next check and persists', async (t) => {
  const folder = await profile(t);
  const access = new AgentAccess(folder);
  const changes = [];
  access.onChange = () => changes.push('changed');
  const a = (await access.pair(project, 'Claude Code')).client;
  const b = (await access.pair(project, 'Claude Desktop')).client;
  const state = await access.setPictures(true);
  assert.equal(state.pictures, true);
  assert.doesNotThrow(() => access.checkPictures(a.id));
  assert.doesNotThrow(() => access.checkPictures(b.id));
  assert.ok(changes.length >= 3);
  const saved = JSON.parse(await readFile(path.join(folder, 'agent-access.json'), 'utf8'));
  assert.equal(saved.pictures, true);
  assert.equal(new AgentAccess(folder).picturesAllowed(b.id), true);
  await access.setPictures(false);
  assert.throws(() => access.checkPictures(a.id), PicturesOff);
  assert.throws(() => access.checkPictures(b.id), PicturesOff);
});

test('a revoked or unknown app is never allowed pictures', async (t) => {
  const access = new AgentAccess(await profile(t));
  const { client } = await access.pair(project, 'Claude Code');
  await access.setPictures(true);
  await access.revoke(client.id);
  assert.equal(access.picturesAllowed(client.id), false);
  assert.equal(access.picturesAllowed('nobody'), false);
  assert.throws(() => access.checkPictures(client.id), PicturesOff);
});

test('activity keeps picture counts and estimated tokens, never pictures', async (t) => {
  const access = new AgentAccess(await profile(t));
  const { client } = await access.pair(project, 'Claude Code');
  access.record(client, 'get_transcript', 'Transcript', 'read');
  access.record(client, 'look', 'Look: 3 moments', 'read', { images: 5, imageTokens: 6100 });
  await access.setPictures(false); // waits behind record's background save
  const [look, read] = access.state().activity;
  assert.equal(look.images, 5);
  assert.equal(look.imageTokens, 6100);
  assert.equal('images' in read, false);
});
