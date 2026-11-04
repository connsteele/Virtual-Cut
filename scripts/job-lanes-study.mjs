// VC-145: real recognition beside real media work, on explicitly supplied disposable copies.
// Transcribes one recording alone, then again while another recording is imported and clips
// are exported back to back, then alone again (A-B-A). Reports how fast the import and each
// export started and how much the media work slowed the transcription.
//
//   VIRTUAL_CUT_LANES_STUDY_OUTPUT  output folder (required)
//   VIRTUAL_CUT_LANES_STUDY         JSON {transcribe, track, imported, exported, clipSeconds,
//                                   device?, order?}
//   VIRTUAL_CUT_ASR_PYTHON / _LIBRARIES / _MODEL / _GPU_LIBRARIES  the local speech engine
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { require } from './shared.mjs';
const { ProjectService } = require('../dist-electron/project-service.cjs');

const dir = process.env.VIRTUAL_CUT_LANES_STUDY_OUTPUT;
if (!dir) throw Error('Set VIRTUAL_CUT_LANES_STUDY_OUTPUT to a disposable folder.');
const study = JSON.parse(process.env.VIRTUAL_CUT_LANES_STUDY || '{}');
for (const key of ['transcribe', 'imported', 'exported'])
  if (!study[key]) throw Error(`Supply ${key} in VIRTUAL_CUT_LANES_STUDY.`);
for (const file of [study.transcribe, study.imported, study.exported])
  if (/^[iI]:/.test(path.resolve(file)))
    throw Error('Use disposable copies, never the original recordings on I:.');
await mkdir(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clipSeconds = study.clipSeconds || 120;
const report = { study, runs: [] };

async function run(name, withMedia) {
  const folder = path.join(dir, name);
  await mkdir(path.join(folder, 'outputs'), { recursive: true });
  const service = new ProjectService(path.join(folder, 'profile'), '');
  assert(service.transcription.configured, service.transcription.problem);
  const snap = await service.open(path.join(folder, 'study.vcut'), {
    name: `Lanes study ${name}`,
    destination: path.join(folder, 'outputs'),
    cache: path.join(folder, 'cache'),
  });
  const project = snap.project.id,
    batch = snap.activeBatchId;
  const jobs = () => service.store.jobs();
  const idle = async () => {
    while (jobs().some((j) => ['queued', 'running'].includes(j.state))) await sleep(100);
  };
  const files = withMedia ? [study.transcribe, study.exported] : [study.transcribe];
  await service.importFiles(project, batch, files, { game: 1, mic: 2 });
  await idle();
  const recordings = service.store.data.model.recordings;
  const target = recordings.find((r) => r.sourcePath === path.resolve(study.transcribe));
  const result = { name, withMedia, exports: [] };
  service.requestTranscription(project, target.id, batch, {
    roles: [study.track === 1 ? 'game' : 'mic'],
    language: 'en',
    vocabulary: false,
    ...(study.device ? { device: study.device } : {}),
  });
  const speech = () => jobs().find((j) => j.kind === 'transcribe');
  const began = performance.now();
  // Recognition starts after audio extraction and model load; noted for each run.
  void (async () => {
    while (speech().state === 'running' && !/words/.test(speech().message)) await sleep(50);
    result.recognizingAtMs = Math.round(performance.now() - began);
  })();
  // Media work starts as soon as the transcription does and continues until it ends.
  while (speech().state === 'queued') await sleep(10);
  if (withMedia) {
    const asked = performance.now();
    await service.importFiles(project, batch, [study.imported], { game: 1, mic: 2 });
    const imported = service.store.data.model.recordings.find(
      (r) => r.sourcePath === path.resolve(study.imported),
    );
    const inspect = () => jobs().find((j) => j.kind === 'inspect' && j.sourceId === imported.id);
    while (inspect()?.state === 'queued') await sleep(10);
    result.importStartMs = Math.round(performance.now() - asked);
    const exported = service.store.data.model.recordings.find(
      (r) => r.sourcePath === path.resolve(study.exported),
    );
    const before = structuredClone(service.store.data.model),
      after = structuredClone(before),
      clip = after.clips.find((c) => c.rid === exported.id);
    Object.assign(clip, { start: 0, end: Math.min(clipSeconds, exported.duration), name: 'Study' });
    await service.save(project, before, after);
    // Export back to back for as long as the transcription runs.
    for (let n = 1; speech().state === 'running'; n++) {
      const plan = await service.exportPlan(project, clip.id, 'mkv');
      const asked = performance.now();
      await service.startExport(
        project,
        plan.id,
        path.join(folder, 'outputs', `study-${n}.mkv`),
        true,
      );
      const job = () => jobs().find((j) => j.id === plan.id);
      while (job().state === 'queued') await sleep(10);
      const startMs = Math.round(performance.now() - asked);
      while (job().state === 'running') await sleep(50);
      result.exports.push({
        startMs,
        state: service.store.exports().find((e) => e.plan.id === plan.id).state,
        elapsedMs: job().elapsedMs,
        overlapped: speech().state === 'running',
      });
    }
  }
  while (['queued', 'running'].includes(speech().state)) await sleep(100);
  const done = speech();
  assert.equal(done.state, 'succeeded', done.message);
  result.device = done.device;
  result.transcriptionMs = done.elapsedMs;
  result.recognitionMs = done.elapsedMs - result.recognizingAtMs;
  result.words = service.store.transcripts.list(target.id)[0]?.wordCount;
  await idle();
  await service.close();
  report.runs.push(result);
  await writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(result));
}

// Alternating order spreads warm-up and background load over both kinds of run.
const order = (study.order || 'alone,media,alone,media').split(',');
for (const [n, kind] of order.entries()) await run(`${n + 1}-${kind}`, kind === 'media');
const mean = (runs, key) => runs.reduce((n, r) => n + r[key], 0) / runs.length;
const alone = report.runs.filter((r) => !r.withMedia),
  media = report.runs.filter((r) => r.withMedia);
report.summary = {
  device: [...new Set(report.runs.map((r) => r.device))].join(', '),
  importStartMs: media.map((r) => r.importStartMs),
  exportStartMs: media.flatMap((r) => r.exports.map((e) => e.startMs)),
  exportsDuringTranscription: media.map((r) => r.exports.filter((e) => e.overlapped).length),
  transcriptionAloneMs: alone.map((r) => r.transcriptionMs),
  transcriptionWithMediaMs: media.map((r) => r.transcriptionMs),
  slowdownWhole: +(mean(media, 'transcriptionMs') / mean(alone, 'transcriptionMs')).toFixed(2),
  slowdownRecognition: +(mean(media, 'recognitionMs') / mean(alone, 'recognitionMs')).toFixed(2),
};
await writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary, null, 2));
