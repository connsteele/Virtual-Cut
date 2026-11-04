// Check dropped microphone lines (VC-166) against a tagged recording (VC-128 notes format).
//
// Copies the recording and transcribes its microphone track once through the app's own import and
// local recognition (as the transcript window would), then reports:
//   - every line the drop rule leaves out, with its voice score and no-speech probability;
//   - tagged entries that lost words to a drop, and spoken Splits with a dropped line beside them
//     (a misheard Split, such as "Spoiler.", is still evidence for an agent);
//   - a sweep of the thresholds over the same lines, so a change can be judged without
//     transcribing again;
//   - mic-all.json and mic-kept.json (lines before and after the drop) for intent-score.mjs.
// With --reuse <folder of an earlier run>, the saved lines are analysed again with today's rule
// and nothing is transcribed. Originals are only read. Transcribing needs a local speech engine
// (VIRTUAL_CUT_ASR_RUNTIME pointing at a transcription-runtime.json, or VIRTUAL_CUT_ASR_PYTHON,
// LIBRARIES and MODEL) and uses the GPU when the runtime does: run it when no other GPU job runs.
//   ELECTRON_RUN_AS_NODE=1 electron scripts/dropped-lines-study.mjs --recording <mp4> \
//     --notes <tagged .txt> [--label name] [--output folder] [--reuse folder]
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { scratchPath } from './shared.mjs';

const require = createRequire(import.meta.url);
const { values } = parseArgs({
  options: {
    recording: { type: 'string' },
    notes: { type: 'string' },
    label: { type: 'string' },
    output: { type: 'string' },
    reuse: { type: 'string' },
  },
});
if ((!values.recording && !values.reuse) || !values.notes) {
  console.error('Give --recording <mp4> (or --reuse <earlier run>) and --notes <tagged .txt>.');
  process.exit(2);
}
const { parseTaggedNotes } = await import('../dist-electron/intent-notes.js');
const { dropReason, dropRule, wordSpan } = await import('../dist-electron/dropped-lines.js');

const label =
  values.label || path.basename(values.recording || values.reuse).replace(/\.[^.]+$/, '');
const dir = path.resolve(values.output || scratchPath('dropped-lines', label));
await mkdir(dir, { recursive: true });
const notes = parseTaggedNotes(await readFile(values.notes, 'utf8'));

/** Transcribe the copy's microphone with the app; the lines and what the app dropped. */
async function transcribe(recording) {
  if (process.env.VIRTUAL_CUT_ASR_RUNTIME) {
    const runtime = JSON.parse(await readFile(process.env.VIRTUAL_CUT_ASR_RUNTIME, 'utf8'));
    process.env.VIRTUAL_CUT_ASR_PYTHON ||= runtime.python;
    process.env.VIRTUAL_CUT_ASR_LIBRARIES ||= runtime.libraries;
    process.env.VIRTUAL_CUT_ASR_MODEL ||= runtime.model;
    if (runtime.gpuLibraries) process.env.VIRTUAL_CUT_ASR_GPU_LIBRARIES ||= runtime.gpuLibraries;
  }
  const { ProjectService } = require('../dist-electron/project-service.cjs');
  const copy = path.join(dir, path.basename(recording));
  console.log(`Copying ${recording}…`);
  await copyFile(recording, copy);
  const settle = async (service, limitMs) => {
    for (const end = Date.now() + limitMs; Date.now() < end;) {
      const snapshot = await service.snapshot();
      if (!snapshot.jobs.some((j) => ['queued', 'running'].includes(j.state))) return snapshot;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Jobs did not finish in time.');
  };
  const service = new ProjectService(path.join(dir, 'profile'), '');
  try {
    let snapshot = await service.open(path.join(dir, 'study.vcut'), {
      name: 'Dropped lines study',
      destination: dir,
      cache: path.join(dir, 'cache'),
    });
    const id = snapshot.project.id,
      batch = snapshot.activeBatchId;
    await service.importFiles(id, batch, [copy], { game: 1, mic: notes.micTrack });
    snapshot = await settle(service, 20 * 60 * 1000);
    const rid = snapshot.model.recordings[0].id;
    const began = Date.now();
    service.requestTranscription(id, rid, batch, {
      roles: ['mic'],
      language: 'en',
      vocabulary: false,
    });
    snapshot = await settle(service, 60 * 60 * 1000);
    const job = snapshot.jobs.find((j) => j.kind === 'transcribe');
    if (job?.state !== 'succeeded') throw new Error(job?.message || 'Transcription did not run.');
    const store = service.store;
    const transcript = store.transcripts.list(rid).find((t) => t.role === 'mic');
    const all = [...store.transcripts.segments(transcript.id, -1, false, true)];
    const meta = {
      recording: path.basename(recording),
      seconds: (Date.now() - began) / 1000,
      device: job.device || transcript.device,
      words: transcript.wordCount,
      appDropped: (store.data.model.droppedLines || [])
        .filter((d) => d.transcriptId === transcript.id)
        .map((d) => [d.segmentId, d.reason]),
    };
    await writeFile(path.join(dir, 'mic-all.json'), JSON.stringify(all, null, 1));
    await writeFile(
      path.join(dir, 'mic-kept.json'),
      JSON.stringify([...store.transcripts.segments(transcript.id)], null, 1),
    );
    await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    return { all, meta };
  } finally {
    await service.close();
  }
}

const { all, meta } = values.reuse
  ? {
      all: JSON.parse(await readFile(path.join(values.reuse, 'mic-all.json'), 'utf8')),
      meta: JSON.parse(
        await readFile(path.join(values.reuse, 'meta.json'), 'utf8').catch(() => '{}'),
      ),
    }
  : await transcribe(values.recording);
const mic = { id: 'mic', role: 'mic' };
const words = (text) =>
  text
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
const line = (s, reason) => {
  const span = wordSpan(s);
  return {
    id: s.id,
    start: Number(span.start.toFixed(2)),
    seconds: Number((span.end - span.start).toFixed(2)),
    voiceScore: s.voiceScore,
    noSpeech: Number(s.noSpeechProbability.toFixed(2)),
    text: s.text.trim(),
    dropped: reason,
  };
};
// A tagged entry is said from `at` until `end`, or for about 0.4 s a word (at least 2 s).
const tagged = notes.entries
  .filter((e) => !e.ignore && e.said)
  .map((e) => ({ ...e, until: e.end ?? e.at + Math.max(2, 0.4 * words(e.said).length) }));
const near = (l, e) => l.start <= e.until + 1 && l.start + l.seconds >= e.at - 1;

/** What a rule drops, and what that costs the tagged notes. */
function judge() {
  const lines = all.map((s) => line(s, dropReason(mic, s)));
  const dropped = lines.filter((l) => l.dropped);
  const lost = [];
  for (const e of tagged) {
    const around = lines.filter((l) => near(l, e));
    const heard = (list) => new Set(list.flatMap((l) => words(l.text)));
    const before = heard(around),
      after = heard(around.filter((l) => !l.dropped));
    const missing = words(e.said).filter((w) => before.has(w) && !after.has(w));
    const beside = around.filter((l) => l.dropped);
    if (missing.length || (e.command && beside.length))
      lost.push({
        at: Number(e.at.toFixed(2)),
        tags: e.tags,
        command: e.command,
        said: e.said,
        missing,
        dropped: beside,
      });
  }
  return { lines, dropped, lost };
}

const result = { ...meta, rule: { ...dropRule }, taggedEntries: tagged.length, ...judge() };
// The lines today's rule keeps, for intent-score.mjs --transcript.
const droppedIds = new Set(result.dropped.map((l) => l.id));
await writeFile(
  path.join(dir, 'mic-kept.json'),
  JSON.stringify(
    all.filter((s) => !droppedIds.has(s.id)),
    null,
    1,
  ),
);
const saved = { ...dropRule };
result.sweep = [];
for (const shortSeconds of [1.5, 2, 3])
  for (const quietBelow of [0.05, 0.1, 0.15, 0.2, 0.3])
    for (const noSpeechAbove of [0, 0.3, 0.5, 0.7]) {
      Object.assign(dropRule, { shortSeconds, quietBelow, noSpeechAbove });
      const { dropped, lost } = judge();
      result.sweep.push({
        shortSeconds,
        quietBelow,
        noSpeechAbove,
        dropped: dropped.length,
        noVoice: dropped.filter((l) => l.dropped === 'no-voice').length,
        lost: lost.length,
      });
    }
Object.assign(dropRule, saved);
if (meta.appDropped && !values.reuse) {
  const live = JSON.stringify(meta.appDropped);
  const expected = JSON.stringify(result.dropped.map((l) => [l.id, l.dropped]));
  result.appMatchesRule = live === expected;
}
const cell = (text) => String(text ?? '').replace(/\|/g, '/');
const md = [
  `# Dropped lines: ${result.recording || label}`,
  '',
  `Rule: short = words within ${result.rule.shortSeconds} s; no voice = voice score below ` +
    `${result.rule.quietBelow} and no-speech probability ${result.rule.noSpeechAbove} or more; ` +
    'or a stock phrase.' +
    (result.seconds ? ` Transcription ${result.seconds.toFixed(1)} s on ${result.device}.` : '') +
    ` ${all.length} lines.` +
    (result.appMatchesRule != null
      ? ` The app's own drops ${result.appMatchesRule ? 'match' : 'DO NOT match'} the rule.`
      : ''),
  '',
  `Dropped **${result.dropped.length}** lines · tagged entries that lost words, or a spoken ` +
    `command with a dropped line beside it: **${result.lost.length}** of ${result.taggedEntries}`,
  '',
  '| At | Seconds | Voice | No speech | Reason | Text |',
  '| --- | --- | --- | --- | --- | --- |',
  ...result.dropped.map(
    (l) =>
      `| ${l.start} | ${l.seconds} | ${l.voiceScore} | ${l.noSpeech} | ${l.dropped} | ${cell(l.text)} |`,
  ),
  '',
  ...(result.lost.length
    ? [
        '## Tagged entries touched',
        '',
        ...result.lost.map(
          (x) =>
            `- ${x.at} s {${x.tags.join(', ')}}${x.command ? ` ${x.command}` : ''}: "${x.said}"` +
            (x.missing.length ? ` · words lost: ${x.missing.join(' ')}` : '') +
            ` · dropped beside it: ${x.dropped.map((l) => `"${l.text}"`).join(', ')}`,
        ),
        '',
      ]
    : []),
  '## Threshold sweep',
  '',
  '| Short (s) | Voice below | No speech from | Dropped | No voice | Tagged touched |',
  '| --- | --- | --- | --- | --- | --- |',
  ...result.sweep.map(
    (r) =>
      `| ${r.shortSeconds} | ${r.quietBelow} | ${r.noSpeechAbove} | ${r.dropped} | ${r.noVoice} | ${r.lost} |`,
  ),
  '',
  '## Short lines (3 s or less)',
  '',
  '| At | Seconds | Voice | No speech | Dropped | Text |',
  '| --- | --- | --- | --- | --- | --- |',
  ...result.lines
    .filter((l) => l.seconds <= 3)
    .map(
      (l) =>
        `| ${l.start} | ${l.seconds} | ${l.voiceScore} | ${l.noSpeech} | ${l.dropped || ''} | ${cell(l.text)} |`,
    ),
  '',
].join('\n');
delete result.lines;
await writeFile(path.join(dir, 'report.json'), JSON.stringify(result, null, 2));
await writeFile(path.join(dir, 'report.md'), md);
console.log(`Report: ${path.join(dir, 'report.md')}`);
