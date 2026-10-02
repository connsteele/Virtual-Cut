// Actual recognition measurement on explicitly supplied disposable media.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const { TranscriptionRuntime } = createRequire(import.meta.url)(
  '../dist-electron/transcription-runtime.cjs',
);
const dir = process.env.VIRTUAL_CUT_ASR_STUDY_OUTPUT;
if (!dir) throw Error('Set an explicit study output folder.');
await mkdir(dir, { recursive: true });
const runtime = new TranscriptionRuntime(path.join(dir, 'profile'));
const samples = JSON.parse(process.env.VIRTUAL_CUT_ASR_STUDY_SAMPLES || '[]');
if (!samples.length) throw Error('Supply disposable samples with file, track, name.');
const probe = await runtime.inspectGpu();
await writeFile(path.join(dir, 'gpu.json'), JSON.stringify(probe, null, 2));
console.log(probe);
const report = [];
for (const sample of samples) {
  for (const variant of JSON.parse(
    process.env.VIRTUAL_CUT_ASR_STUDY_VARIANTS || '[{"device":"cuda"},{"device":"cpu"}]',
  )) {
    const { device, batchSize = 1 } = variant;
    const events = [],
      started = performance.now();
    await runtime.run(
      {
        source: sample.file,
        track: sample.track,
        offset: 0,
        language: 'en',
        vocabulary: '',
        device,
        batchSize,
        ffmpeg: process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg',
        wav: path.join(dir, 'speech.partial.wav'),
        tempDirectory: dir,
      },
      new AbortController().signal,
      (event) => events.push({ ...event, wallMs: Math.round(performance.now() - started) }),
    );
    const result = {
      name: sample.name,
      device,
      batchSize,
      elapsedMs: Math.round(performance.now() - started),
      words: events.reduce((n, e) => n + (e.segment?.words.length || 0), 0),
      peakMemoryBytes: events.find((e) => e.type === 'complete')?.peakMemoryBytes,
      stages: events.filter((e) => e.type === 'stage'),
      segments: events.filter((e) => e.segment).map((e) => e.segment),
    };
    await writeFile(
      path.join(dir, `${sample.name}-${device}-batch${batchSize}.json`),
      JSON.stringify(result, null, 2),
    );
    report.push({ ...result, segments: undefined });
    await writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report.at(-1), stages: undefined }));
  }
}
