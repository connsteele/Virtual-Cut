// Score spoken-cue recognition against labelled recordings (VC-128).
//
// Each recording `name.mp4` has `name.txt` listing what was said into the microphone, with
// times in MM:SS:FF (frames at 60 fps unless the notes say "FPS: N"). An entry whose words
// start with a cue word (Clip Start, Clip End, Marker, Split, Note, Mark, Cut) is an expected
// cue; other entries are ordinary speech, which must not produce cues. Text in parentheses is
// an annotation, not spoken. The microphone is audio track 2 unless the notes say "Mic track: N".
//
// Recordings are copied first; originals are never opened for writing. Transcription uses the
// app's own import, local recognition and cue logic, so the score reflects what the transcript
// window shows. Requires a local speech engine:
//   VIRTUAL_CUT_ASR_PYTHON, VIRTUAL_CUT_ASR_LIBRARIES, VIRTUAL_CUT_ASR_MODEL
//   (optional VIRTUAL_CUT_ASR_GPU_LIBRARIES), or VIRTUAL_CUT_ASR_RUNTIME pointing at a
//   transcription-runtime.json whose paths are read, never modified.
// Run with Electron's Node runtime:
//   ELECTRON_RUN_AS_NODE=1 electron scripts/cue-accuracy-study.mjs [samples folder]
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const samples = path.resolve(
  process.argv[2] || process.env.VIRTUAL_CUT_CUE_SAMPLES || 'G:/VC Audio Cues',
);
const output = path.resolve(
  process.env.VIRTUAL_CUT_CUE_OUTPUT || 'G:/Claude/Virtual Cut/cue-accuracy',
);
const tolerance = Number(process.env.VIRTUAL_CUT_CUE_TOLERANCE || 1);

if (process.env.VIRTUAL_CUT_ASR_RUNTIME) {
  const runtime = JSON.parse(await readFile(process.env.VIRTUAL_CUT_ASR_RUNTIME, 'utf8'));
  process.env.VIRTUAL_CUT_ASR_PYTHON ||= runtime.python;
  process.env.VIRTUAL_CUT_ASR_LIBRARIES ||= runtime.libraries;
  process.env.VIRTUAL_CUT_ASR_MODEL ||= runtime.model;
  if (runtime.gpuLibraries) process.env.VIRTUAL_CUT_ASR_GPU_LIBRARIES ||= runtime.gpuLibraries;
}
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { cueCandidate } = await import('../dist-electron/transcript-edits.js');

const kinds = [
  [/^clip[\s-]+(?:start|in)\b/i, 'clip-start'],
  [/^clip[\s-]+(?:end|out)\b/i, 'clip-end'],
  [/^marker\b/i, 'mark'],
  [/^mark\b/i, 'mark'],
  [/^split\b/i, 'cut'],
  [/^cut\b/i, 'cut'],
  [/^note\b/i, 'note'],
];
const words = (text) =>
  text
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/\ball right\b/g, 'alright')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
/** Word error rate of `heard` against `said` (edits / words said). */
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
/** Parse a labelled notes file into settings and timed entries. */
export function parseLabels(text) {
  const fps = Number(/FPS:\s*(\d+(?:\.\d+)?)/i.exec(text)?.[1] || 60);
  const micTrack = Number(/Mic track:\s*(\d+)/i.exec(text)?.[1] || 2);
  const time = (value) => {
    const [m, s, f] = value.split(':').map(Number);
    return m * 60 + s + f / fps;
  };
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\d\d:\d\d:\d\d)(?:\s*-\s*(\d\d:\d\d:\d\d))?$/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    const said = lines[j] || '';
    const spoken = said
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const kind = kinds.find(([pattern]) => pattern.test(spoken))?.[1];
    entries.push({
      start: time(m[1]),
      end: m[2] ? time(m[2]) : undefined,
      said,
      spoken,
      kind,
    });
  }
  return { fps, micTrack, entries };
}

/** Match expected cues to detections: nearest unused detection of the same kind in tolerance. */
function match(entries, detected) {
  const used = new Set();
  const cues = entries
    .filter((e) => e.kind)
    .map((expected) => {
      let best;
      detected.forEach((d, i) => {
        if (used.has(i) || d.kind !== expected.kind) return;
        const error = d.time - expected.start;
        if (Math.abs(error) <= tolerance && (!best || Math.abs(error) < Math.abs(best.error)))
          best = { i, error };
      });
      if (best) used.add(best.i);
      const d = best && detected[best.i];
      const near = best
        ? undefined
        : detected.find((x, i) => !used.has(i) && Math.abs(x.time - expected.start) <= tolerance);
      return {
        expected: expected.kind,
        at: Number(expected.start.toFixed(2)),
        said: expected.spoken,
        found: !!d,
        timeError: d ? Number(best.error.toFixed(2)) : undefined,
        heard: d?.heard,
        paired: d?.paired,
        proposedOnly: d?.proposed || undefined,
        noteWordErrorRate:
          d && expected.kind === 'note'
            ? Number(
                wordErrorRate(expected.spoken.replace(/^note\b/i, ''), d.title || '').toFixed(2),
              )
            : undefined,
        wrongKind: near ? { kind: near.kind, heard: near.heard } : undefined,
      };
    });
  const falseTriggers = detected
    .filter((_, i) => !used.has(i))
    .filter((d) => !cues.some((c) => c.wrongKind?.heard === d.heard))
    .map((d) => ({ kind: d.kind, time: Number(d.time.toFixed(2)), heard: d.heard }));
  return { cues, falseTriggers };
}

const cueWord = /^(?:marker|mark|note|cut|split|clip)$/;
const bare = (word) => word.toLowerCase().replace(/[^a-z]/g, '');
/**
 * Experimental, not in the app: also start a cue at a cue word inside a phrase when a pause
 * comes before it. The recognizer often merges a cue into the preceding speech and absorbs the
 * silence into the cue word's own duration, so a word lasting 0.8 s or more counts as a pause.
 * Bare commands (Clip Start/End, Split/Cut) also need a pause after them. The app's own guards
 * against ordinary speech ("Mark is the character…") still apply through cueCandidate.
 */
function proposedCues(transcript, segments, current) {
  const extra = [];
  for (const segment of segments) {
    const w = segment.words || [];
    for (let i = 1; i < w.length; i++) {
      const token = bare(w[i].text);
      if (!cueWord.test(token)) continue;
      const pair = token === 'clip';
      if (pair && !/^(?:start|in|end|out)$/.test(bare(w[i + 1]?.text || ''))) continue;
      const last = pair ? i + 1 : i;
      const long = (x) => x.end - x.start >= 0.8;
      if (!(w[i].start - w[i - 1].end >= 0.3 || long(w[i]))) continue;
      const text = w
        .slice(i)
        .map((x) => x.text)
        .join('')
        .trim();
      const cue = cueCandidate(transcript, { ...segment, text, words: w.slice(i) });
      if (!cue) continue;
      const next = w[last + 1];
      const pauseAfter = !next || next.start - w[last].end >= 0.3 || long(next);
      if (['clip-start', 'clip-end', 'cut'].includes(cue.kind) && !pauseAfter) continue;
      extra.push({
        kind: cue.kind,
        time: long(w[i]) ? w[i].end - 0.45 : w[i].start,
        heard: text,
        title: cue.text,
        proposed: true,
      });
    }
  }
  return [...current, ...extra].sort((a, b) => a.time - b.time);
}

async function waitForJobs(service, limitMs) {
  for (const end = Date.now() + limitMs; Date.now() < end;) {
    const snapshot = await service.snapshot();
    if (!snapshot.jobs.some((j) => ['queued', 'running'].includes(j.state))) return snapshot;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Jobs did not finish in time.');
}

async function score(file, labels, dir) {
  const copy = path.join(dir, path.basename(file));
  await copyFile(file, copy);
  const service = new ProjectService(path.join(dir, 'profile'), '');
  try {
    let snapshot = await service.open(path.join(dir, 'cues.vcut'), {
      name: 'Cue accuracy',
      destination: dir,
      cache: path.join(dir, 'cache'),
    });
    const id = snapshot.project.id,
      batch = snapshot.activeBatchId;
    await service.importFiles(id, batch, [copy], { game: 1, mic: labels.micTrack });
    snapshot = await waitForJobs(service, 10 * 60 * 1000);
    const rid = snapshot.model.recordings[0].id;
    const started = Date.now();
    service.requestTranscription(id, rid, batch, {
      roles: ['mic'],
      language: 'en',
      vocabulary: false,
    });
    snapshot = await waitForJobs(service, 30 * 60 * 1000);
    const job = snapshot.jobs.find((j) => j.kind === 'transcribe');
    if (job?.state !== 'succeeded') throw new Error(job?.message || 'Transcription did not run.');
    const store = service.store;
    const transcript = store.transcripts.list(rid).find((t) => t.role === 'mic');
    const segments = [...store.transcripts.segments(transcript.id)];
    const detected = segments
      .filter((s) => cueCandidate(transcript, s))
      .map((s) => store.transcripts.cueSegment(transcript.id, s.id, snapshot.model))
      .map((s) => ({
        kind: s.cueKind,
        time: s.words?.[0]?.start ?? s.start,
        heard: s.text.trim(),
        title: s.cueTitle,
        paired: s.cuePartner ? true : s.cueKind?.startsWith('clip') ? false : undefined,
      }));
    const { cues, falseTriggers } = match(labels.entries, detected);
    const proposed = match(labels.entries, proposedCues(transcript, segments, detected));
    // Recognition quality for every labelled entry. Each recognized word belongs to the latest
    // entry starting before it ends (the recognizer stretches words across silences, so word
    // ends are more reliable than starts).
    const spans = labels.entries.map((e) => ({
      ...e,
      until: (e.end ?? e.start + 0.5 * Math.max(1, words(e.spoken).length)) + 0.6,
      heard: [],
    }));
    for (const w of segments.flatMap((s) => s.words || [])) {
      const owner = spans
        .filter((e) => w.end >= e.start - 0.5 && w.end <= e.until)
        .sort((a, b) => b.start - a.start)[0];
      owner?.heard.push(w.text);
    }
    const entries = spans.map((e) => {
      const heard = e.heard.join('').trim();
      return {
        at: Number(e.start.toFixed(2)),
        said: e.spoken,
        heard,
        wordErrorRate: Number(wordErrorRate(e.spoken, heard).toFixed(2)),
      };
    });
    return {
      transcription: {
        elapsedMs: Date.now() - started,
        device: job.device || transcript.device,
        words: transcript.wordCount,
      },
      cues,
      falseTriggers,
      proposed,
      entries,
      transcript: segments.map((s) => ({
        start: Number(s.start.toFixed(2)),
        text: s.text.trim(),
        words: (s.words || []).map((w) => [
          w.text.trim(),
          Number(w.start.toFixed(2)),
          Number(w.end.toFixed(2)),
        ]),
      })),
    };
  } finally {
    await service.close();
  }
}

const markdown = (results) => {
  const lines = [`# Cue accuracy — ${new Date().toISOString().slice(0, 10)}`, ''];
  lines.push(
    `Tolerance: a detected cue counts if it has the expected kind within ±${tolerance} s.`,
    '',
  );
  for (const r of results) {
    lines.push(`## ${r.recording}`, '');
    if (r.error) {
      lines.push(`Not scored: ${r.error}`, '');
      continue;
    }
    const found = r.cues.filter((c) => c.found).length;
    lines.push(
      `Cues found: **${found} of ${r.cues.length}** · false triggers: **${r.falseTriggers.length}** · ` +
        `transcription ${(r.transcription.elapsedMs / 1000).toFixed(1)} s`,
      '',
      '| Said at | Expected | Found | Time error | Heard |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const c of r.cues)
      lines.push(
        `| ${c.at.toFixed(2)} s | ${c.expected} | ${c.found ? 'yes' : c.wrongKind ? `no (heard as ${c.wrongKind.kind})` : 'no'}` +
          `${c.paired === false ? ', unpaired' : ''} | ${c.timeError ?? ''} | ${(c.heard || c.wrongKind?.heard || '').replace(/\|/g, '/')} |`,
      );
    if (r.falseTriggers.length) {
      lines.push('', 'False triggers:', '');
      for (const f of r.falseTriggers) lines.push(`- ${f.time} s ${f.kind}: "${f.heard}"`);
    }
    const extra = r.proposed.cues.filter((c) => c.proposedOnly);
    lines.push(
      '',
      `Experimental split rule (not in the app): cues found **${r.proposed.cues.filter((c) => c.found).length} of ` +
        `${r.proposed.cues.length}** · false triggers: **${r.proposed.falseTriggers.length}**`,
    );
    for (const c of extra)
      lines.push(
        `- also finds ${c.expected} at ${c.at.toFixed(2)} s (time error ${c.timeError}): "${c.heard}"`,
      );
    for (const f of r.proposed.falseTriggers)
      lines.push(`- false trigger ${f.kind} at ${f.time} s: "${f.heard}"`);
    lines.push('', '| Said at | Said | Heard | Word error rate |', '| --- | --- | --- | --- |');
    for (const e of r.entries)
      lines.push(
        `| ${e.at.toFixed(2)} s | ${e.said} | ${e.heard.replace(/\|/g, '/')} | ${e.wordErrorRate} |`,
      );
    lines.push('');
  }
  return lines.join('\n');
};

await mkdir(output, { recursive: true });
const run = await mkdtemp(path.join(output, 'run-'));
const results = [];
for (const name of (await readdir(samples)).filter((n) => /\.(mp4|mkv|mov)$/i.test(n)).sort()) {
  const notes = path.join(samples, name.replace(/\.[^.]+$/, '.txt'));
  let labels;
  try {
    labels = parseLabels(await readFile(notes, 'utf8'));
  } catch {
    continue;
  }
  const dir = await mkdtemp(path.join(run, 'recording-'));
  console.log(`Scoring ${name}…`);
  try {
    results.push({
      recording: name,
      labels,
      ...(await score(path.join(samples, name), labels, dir)),
    });
  } catch (error) {
    results.push({ recording: name, labels, error: String(error) });
  }
}
await writeFile(
  path.join(run, 'report.json'),
  JSON.stringify({ samples, tolerance, results }, null, 2),
);
await writeFile(path.join(run, 'report.md'), markdown(results));
console.log(`Cue accuracy report: ${path.join(run, 'report.md')}`);
