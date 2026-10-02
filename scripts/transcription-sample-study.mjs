import { mkdir, mkdtemp, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const { TranscriptionRuntime } = createRequire(import.meta.url)(
  '../dist-electron/transcription-runtime.cjs',
);
const root = process.env.VIRTUAL_CUT_ASR_STUDY_OUTPUT || 'G:/GPT/Work/virtual-cut/m3-sample-study';
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'run-'));
const runtime = new TranscriptionRuntime(path.join(dir, 'profile'), '');
const samples = JSON.parse(process.env.VIRTUAL_CUT_ASR_STUDY_SAMPLES || '[]');
if (!samples.length)
  throw Error('Supply copied speech samples as VIRTUAL_CUT_ASR_STUDY_SAMPLES JSON.');
const report = [];
for (const sample of samples) {
  const source = path.join(dir, `${sample.name}.wav`);
  await copyFile(sample.file, source);
  for (const hinted of [false, true]) {
    const segments = [];
    const started = Date.now();
    let info,
      peakMemoryBytes = 0;
    await runtime.run(
      {
        source,
        track: 0,
        offset: 0,
        language: 'en',
        vocabulary: hinted ? 'Cai, Castor, Bertrand, Dagsion, Blaze Arts, Lita, Anna, Vandale' : '',
        ffmpeg: process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg',
        wav: path.join(dir, 'recognition.partial.wav'),
        tempDirectory: dir,
      },
      new AbortController().signal,
      (event) => {
        if (event.segment) segments.push(event.segment);
        if (event.type === 'info') info = event;
        if (event.peakMemoryBytes) peakMemoryBytes = event.peakMemoryBytes;
      },
    );
    const name = `${sample.name}-${hinted ? 'hints' : 'plain'}`;
    const result = {
      name,
      role: sample.role,
      info,
      elapsedMs: Date.now() - started,
      peakMemoryBytes,
      wordCount: segments.reduce((n, s) => n + s.words.length, 0),
      segments,
    };
    await writeFile(path.join(dir, name + '.json'), JSON.stringify(result, null, 2));
    report.push({ ...result, segments: undefined });
    console.log(JSON.stringify(report.at(-1)));
  }
}
await writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
await writeFile(path.join(root, 'latest.json'), JSON.stringify({ dir, report }, null, 2));
console.log(`Speech sample study: ${dir}`);
