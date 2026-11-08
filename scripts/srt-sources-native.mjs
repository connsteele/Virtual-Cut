// VC-236: with the SRT option on, every requested transcript gets its SRT beside the video, an
// empty one when the clip has no speech in it, and the companion names which transcript each
// SRT holds. Three clips of one synthetic recording with finished game and microphone
// transcripts: game dialogue only, microphone speech only, and no speech at all.
import { withWholeClips } from './shared.mjs';
import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
// Set VIRTUAL_CUT_TEST_EXECUTABLE to a packaged Virtual Cut.exe to run it against that build.
const packaged = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const { ProjectService } = require(
  packaged
    ? path.join(path.dirname(packaged), 'resources/app/dist-electron/project-service.cjs')
    : '../dist-electron/project-service.cjs',
);
const root = testPath('srt-sources');
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'native-')),
  source = path.join(dir, 'srt-fixture.mkv');
await new Promise((resolve, reject) => {
  const child = spawn(
    process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg',
    [
      ...['-v', 'error', '-nostdin'],
      ...['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=18'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=18'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=880:duration=18'],
      ...['-map', '0:v', '-map', '1:a', '-map', '2:a'],
      ...['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-keyint_min', '30'],
      ...['-sc_threshold', '0', '-c:a', 'flac', '-y', source],
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  child.on('error', reject);
  child.on('exit', (code) => (code ? reject(Error(err)) : resolve()));
});

const service = new ProjectService(path.join(dir, 'profile'), path.join(dir, 'tools'));
let p = await service.open(path.join(dir, 'srt.vcut'), {
  name: 'VC-236 SRT sources',
  destination: dir,
  cache: path.join(dir, 'cache'),
});
const id = p.project.id;
async function settled() {
  for (let deadline = Date.now() + 90000; Date.now() < deadline;) {
    const s = await service.snapshot();
    if (!s.jobs.some((j) => ['queued', 'running'].includes(j.state))) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Media jobs did not settle');
}
const report = { dir, clips: [] };
try {
  await service.importFiles(id, p.activeBatchId, [source], { game: 1, mic: 2 });
  p = await settled();
  const recording = p.model.recordings[0];
  const { fingerprint } = service.store.sources().find((x) => x.id === recording.id);
  // Game dialogue at 1–3.8 s, microphone speech at 7–8.8 s, nothing after 9 s.
  const transcript = (tid, role, track, starts, word) => {
    service.store.transcripts.begin({
      id: tid,
      sourceId: recording.id,
      fingerprint,
      role,
      track,
      language: 'en',
      duration: recording.duration,
      offset: 0,
      state: 'complete',
      model: 'fixture',
      device: 'cpu',
      created: new Date().toISOString(),
      context: { vocabulary: '', brief: '' },
      segmentCount: starts.length,
      wordCount: starts.length,
    });
    starts.forEach((start, i) =>
      service.store.transcripts.append(tid, {
        id: i,
        start,
        end: start + 0.8,
        text: ` ${word}${i}`,
        words: [{ text: ` ${word}${i}`, start, end: start + 0.8, probability: 1 }],
        noSpeechProbability: 0,
        averageLogProbability: 0,
      }),
    );
  };
  transcript('srt-game', 'game', 1, [1, 2, 3], 'Dialogue');
  transcript('srt-mic', 'mic', 2, [7, 8], 'Note');
  // Import makes no clip (VC-206); the whole-recording clip is the base the clips copy.
  const before = structuredClone(p.model),
    after = withWholeClips(before);
  const base = after.clips[0];
  after.clips = [
    { ...base, id: 'dialogue', start: 1.2, end: 4.2, name: 'Game dialogue only' },
    { ...base, id: 'talk', start: 6.5, end: 9.5, name: 'Mic speech only' },
    { ...base, id: 'quiet', start: 12.3, end: 15.5, name: 'No speech' },
  ].map((c) => ({ ...c, folder: '_Review' }));
  await service.save(id, before, after);
  await service.checkpoint(id);
  assert.deepEqual((await service.snapshot()).transcriptRoles[recording.id].sort(), [
    'game',
    'mic',
  ]);
  const results = {};
  for (const clip of after.clips) {
    const plan = await service.exportPlan(id, clip.id, 'mp4');
    const output = path.join(dir, clip.name + '.mp4');
    await service.startExport(id, plan.id, output, true, {
      roles: ['game', 'mic'],
      srt: true,
      companion: false,
    });
    await settled();
    const record = service.store.exports().find((e) => e.plan.id === plan.id);
    assert.equal(record.state, 'verified', record.message);
    const companion = JSON.parse(await readFile(output + '.vcut.json', 'utf8'));
    const game = await readFile(path.join(dir, clip.name + '.srt'), 'utf8'),
      mic = await readFile(path.join(dir, clip.name + '.mic.srt'), 'utf8');
    results[clip.id] = { record, companion, game, mic };
    report.clips.push({
      name: clip.name,
      actual: record.verification.actual,
      message: record.message,
      written: record.subtitles.written.map((w) => ({
        file: path.basename(w.file),
        role: w.role,
        transcriptId: w.transcriptId,
        noDialogue: !!w.noDialogue,
        bytes: Buffer.byteLength(w.role === 'game' ? game : mic),
      })),
      skipped: record.subtitles.skipped,
      companionSubtitles: companion.subtitles,
      gameSrt: game,
      micSrt: mic,
    });
  }
  await writeFile(path.join(dir, 'srt-sources.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.clips, null, 2));

  for (const [clipId, r] of Object.entries(results)) {
    const name = after.clips.find((c) => c.id === clipId).name;
    // Every requested transcript has its SRT, and the companion says which transcript it holds.
    assert.equal(r.companion.version, 4, 'The receipt version does not change');
    assert.equal(r.companion.subtitles.schema, 'virtual-cut-subtitles');
    assert.equal(r.companion.subtitles.version, 1);
    assert.deepEqual(r.companion.subtitles.files, [
      { file: name + '.srt', transcript: 'game', label: 'game dialogue' },
      { file: name + '.mic.srt', transcript: 'mic', label: 'microphone notes' },
    ]);
    assert.deepEqual(
      r.record.subtitles.written.map((w) => [w.role, w.transcriptId, path.basename(w.file)]),
      [
        ['game', 'srt-game', name + '.srt'],
        ['mic', 'srt-mic', name + '.mic.srt'],
      ],
    );
    assert.deepEqual(r.record.subtitles.skipped, []);
    // No start timecode on this source, so no Resolve copies.
    await assert.rejects(stat(path.join(dir, name + '.timecode.srt')), /ENOENT/);
  }
  const { dialogue, talk, quiet } = results;
  assert.match(dialogue.game, /^1\n00:00:00,000 --> 00:00:00,800\nDialogue0\n/);
  assert.equal(dialogue.mic, '', 'No microphone speech: an empty .mic.srt');
  assert.deepEqual(
    dialogue.record.subtitles.written.map((w) => !!w.noDialogue),
    [false, true],
  );
  assert.match(
    dialogue.record.message,
    /Subtitles: Game dialogue only\.srt, Game dialogue only\.mic\.srt \(no dialogue\)\./,
  );
  assert.equal(talk.game, '', 'No game dialogue: an empty .srt');
  assert.match(talk.mic, /Note0\n[\s\S]*Note1\n/);
  assert.deepEqual(
    talk.record.subtitles.written.map((w) => !!w.noDialogue),
    [true, false],
  );
  assert.equal(quiet.game, '');
  assert.equal(quiet.mic, '');
  assert.match(
    quiet.record.message,
    /Subtitles: No speech\.srt \(no dialogue\), No speech\.mic\.srt \(no dialogue\)\./,
  );
  console.log('SRT source checks passed:', dir);
} finally {
  await service.close();
}
