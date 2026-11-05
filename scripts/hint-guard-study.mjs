// Check vocabulary hints with their guard (VC-164) on a tagged recording (VC-128 notes format).
//
// Copies the recording and transcribes it through the app's own import and local recognition:
// the game track once without hints, then the game and microphone tracks with the given names
// and terms as the game's vocabulary (hints at batch 8 with the guard). Reports:
//   - how many spans the guard redid, and the lines it redid;
//   - a game span (--span start-end, seconds) with and without hints, so a stock phrase such as
//     "Thank you for watching!" shows if it replaced dialogue;
//   - each --name's spelling on the microphone, against a no-hint microphone run (--baseline,
//     an earlier dropped-lines-study folder with mic-all.json);
//   - tagged entries whose words got worse with hints (word error rate against the notes).
// Originals are only read. Needs a local speech engine (VIRTUAL_CUT_ASR_RUNTIME) and uses the
// GPU when the runtime does: run it only when no other GPU job is running.
//   ELECTRON_RUN_AS_NODE=1 electron scripts/hint-guard-study.mjs --recording <mp4> \
//     --notes <tagged .txt> --vocabulary "Name, Name" --baseline <folder> \
//     [--span 1920-1948] [--name Orchel=Archel,Urshell] [--output folder]
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { scratchPath } from './shared.mjs';

const require = createRequire(import.meta.url);
const { values } = parseArgs({
  options: {
    recording: { type: 'string' },
    notes: { type: 'string' },
    vocabulary: { type: 'string' },
    baseline: { type: 'string' },
    span: { type: 'string', multiple: true },
    name: { type: 'string', multiple: true },
    output: { type: 'string' },
  },
});
if (!values.recording || !values.notes || !values.vocabulary || !values.baseline) {
  console.error('Give --recording, --notes, --vocabulary and --baseline.');
  process.exit(2);
}
if (process.env.VIRTUAL_CUT_ASR_RUNTIME) {
  const runtime = JSON.parse(await readFile(process.env.VIRTUAL_CUT_ASR_RUNTIME, 'utf8'));
  process.env.VIRTUAL_CUT_ASR_PYTHON ||= runtime.python;
  process.env.VIRTUAL_CUT_ASR_LIBRARIES ||= runtime.libraries;
  process.env.VIRTUAL_CUT_ASR_MODEL ||= runtime.model;
  if (runtime.gpuLibraries) process.env.VIRTUAL_CUT_ASR_GPU_LIBRARIES ||= runtime.gpuLibraries;
}
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { parseTaggedNotes } = await import('../dist-electron/intent-notes.js');

const dir = path.resolve(values.output || scratchPath('hint-guard'));
await mkdir(dir, { recursive: true });
const notes = parseTaggedNotes(await readFile(values.notes, 'utf8'));
const baseline = JSON.parse(await readFile(path.join(values.baseline, 'mic-all.json'), 'utf8'));
const copy = path.join(dir, path.basename(values.recording));
// A copy made ahead of time (while the GPU is busy elsewhere) is used as it is.
const size = async (file) => (await stat(file).catch(() => null))?.size;
if ((await size(copy)) !== (await size(values.recording))) {
  console.log(`Copying ${values.recording}…`);
  await copyFile(values.recording, copy);
}

const settle = async (service, limitMs) => {
  for (const end = Date.now() + limitMs; Date.now() < end;) {
    const snapshot = await service.snapshot();
    if (!snapshot.jobs.some((j) => ['queued', 'running'].includes(j.state))) return snapshot;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Jobs did not finish in time.');
};
const service = new ProjectService(path.join(dir, 'profile'), '');
const runs = {};
try {
  let snapshot = await service.open(path.join(dir, 'study.vcut'), {
    name: 'Hint guard study',
    destination: dir,
    cache: path.join(dir, 'cache'),
  });
  const id = snapshot.project.id,
    batch = snapshot.activeBatchId;
  await service.importFiles(id, batch, [copy], { game: 1, mic: notes.micTrack });
  snapshot = await settle(service, 20 * 60 * 1000);
  const rid = snapshot.model.recordings[0].id;
  const before = service.store.data.model;
  service.store.save(before, {
    ...before,
    contexts: [
      {
        id: 'project',
        gameMode: 'set',
        briefMode: 'replace',
        game: { id: 'study-game', name: 'Study game', vocabulary: values.vocabulary },
        brief: '',
      },
    ],
  });
  for (const [label, options] of [
    ['game-plain', { roles: ['game'], vocabulary: false }],
    ['hinted', { roles: ['game', 'mic'], vocabulary: true }],
  ]) {
    const began = Date.now();
    service.requestTranscription(id, rid, batch, { ...options, language: 'en' });
    snapshot = await settle(service, 60 * 60 * 1000);
    runs[label] = (Date.now() - began) / 1000;
  }
  const failed = snapshot.jobs.find((j) => j.kind === 'transcribe' && j.state !== 'succeeded');
  if (failed) throw new Error(failed.message || 'Transcription did not run.');
  const store = service.store;
  const pick = (role, hinted) =>
    store.transcripts
      .list(rid)
      .find((t) => t.role === role && !!t.context.vocabulary === hinted && t.state === 'complete');
  for (const [key, role, hinted] of [
    ['gamePlain', 'game', false],
    ['gameHinted', 'game', true],
    ['micHinted', 'mic', true],
  ]) {
    const t = pick(role, hinted);
    runs[key] = { summary: t, lines: [...store.transcripts.segments(t.id, -1, false, true)] };
    await writeFile(path.join(dir, `${key}.json`), JSON.stringify(runs[key].lines, null, 1));
  }
} finally {
  await service.close();
}

const words = (text) =>
  text
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
function wordErrorRate(said, heard) {
  const a = words(said),
    b = words(heard);
  if (!a.length) return b.length ? 1 : 0;
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length] / a.length;
}
const text = (lines, from, to) =>
  lines
    .filter((l) => l.end > from && l.start < to)
    .map((l) => l.text.trim())
    .join(' ');
// What the microphone heard while each tagged entry was said (word ends inside its time).
const tagged = notes.entries
  .filter((e) => !e.ignore && e.said)
  .map((e) => ({ ...e, until: e.end ?? e.at + Math.max(2, 0.4 * words(e.said).length) }));
const heard = (lines, e) =>
  lines
    .flatMap((l) => l.words || [])
    .filter((w) => w.end >= e.at - 0.5 && w.end <= e.until + 0.6)
    .map((w) => w.text)
    .join('');
const entries = tagged.map((e) => {
  const plain = heard(baseline, e),
    hinted = heard(runs.micHinted.lines, e);
  return {
    at: Number(e.at.toFixed(2)),
    said: e.said,
    plain: plain.trim(),
    hinted: hinted.trim(),
    plainError: Number(wordErrorRate(e.said, plain).toFixed(2)),
    hintedError: Number(wordErrorRate(e.said, hinted).toFixed(2)),
  };
});
const names = (values.name || []).map((spec) => {
  const [name, wrong = ''] = spec.split('=');
  const count = (lines, phrase) =>
    lines
      .map((l) => l.text.toLowerCase())
      .join(' \n ')
      .split(phrase.toLowerCase()).length - 1;
  const misspellings = wrong.split(',').filter(Boolean);
  return {
    name,
    plain: count(baseline, name),
    hinted: count(runs.micHinted.lines, name),
    misspelled: misspellings.map((m) => ({
      as: m,
      plain: count(baseline, m),
      hinted: count(runs.micHinted.lines, m),
    })),
  };
});
const spans = (values.span || []).map((s) => {
  const [from, to] = s.split('-').map(Number);
  return {
    from,
    to,
    plain: text(runs.gamePlain.lines, from, to),
    hinted: text(runs.gameHinted.lines, from, to),
  };
});
const redone = (run) => run.lines.filter((l) => l.hintGuard);
const result = {
  recording: path.basename(values.recording),
  vocabulary: values.vocabulary,
  seconds: { gamePlain: runs['game-plain'], hinted: runs.hinted },
  guard: {
    game: { redos: runs.gameHinted.summary.guardRedos, lines: redone(runs.gameHinted) },
    mic: { redos: runs.micHinted.summary.guardRedos, lines: redone(runs.micHinted) },
  },
  spans,
  names,
  worse: entries.filter((e) => e.hintedError > e.plainError),
  better: entries.filter((e) => e.hintedError < e.plainError),
  entries,
};
const time = (s) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.round((s % 1) * 10)).padStart(1, '0')}`;
const cell = (t) => String(t ?? '').replace(/\|/g, '/');
const md = [
  `# Vocabulary hints with their guard: ${result.recording}`,
  '',
  `Vocabulary: ${values.vocabulary}`,
  '',
  `Game without hints ${result.seconds.gamePlain.toFixed(1)} s; game and microphone with hints ` +
    `${result.seconds.hinted.toFixed(1)} s (batch 8, guard on).`,
  '',
  `Guard redid **${result.guard.game.redos ?? 0}** game spans and **${result.guard.mic.redos ?? 0}** microphone spans.`,
  '',
  ...[
    ...result.guard.game.lines.map((l) => ['game', l]),
    ...result.guard.mic.lines.map((l) => ['mic', l]),
  ].map(([role, l]) => `- ${role} ${time(l.start)} (${l.hintGuard}): "${l.text.trim()}"`),
  '',
  ...result.spans.flatMap((s) => [
    `## Game ${time(s.from)} to ${time(s.to)}`,
    '',
    `- Without hints: ${s.plain || '(nothing)'}`,
    `- With hints and guard: ${s.hinted || '(nothing)'}`,
    '',
  ]),
  '## Names on the microphone',
  '',
  '| Name | Without hints | With hints | Misheard as (without → with) |',
  '| --- | ---: | ---: | --- |',
  ...result.names.map(
    (n) =>
      `| ${n.name} | ${n.plain} | ${n.hinted} | ${n.misspelled.map((m) => `${m.as} ${m.plain} → ${m.hinted}`).join(', ')} |`,
  ),
  '',
  `## Tagged entries: ${result.better.length} better, ${result.worse.length} worse with hints (of ${entries.length})`,
  '',
  '| At | Said | Without hints | With hints | WER without → with |',
  '| --- | --- | --- | --- | --- |',
  ...[...result.worse, ...result.better]
    .sort((a, b) => a.at - b.at)
    .map(
      (e) =>
        `| ${time(e.at)} | ${cell(e.said)} | ${cell(e.plain)} | ${cell(e.hinted)} | ${e.plainError} → ${e.hintedError} |`,
    ),
  '',
].join('\n');
await writeFile(path.join(dir, 'report.json'), JSON.stringify(result, null, 2));
await writeFile(path.join(dir, 'report.md'), md);
console.log(`Report: ${path.join(dir, 'report.md')}`);
