// Score proposals and decisions against tagged mic notes (VC-128).
//
// Ground truth is a tagged notes file per recording (see electron/intent-notes.ts for the
// format). Proposals come from any of:
//   --proposals answer.json   a get_proposal_decisions answer (with decisions), a
//                             submit_proposals input (an agent run before review), or an array
//                             of scored proposals
//   --transcript mic.json     a mic transcript (array of segments); every phrase that is a bare
//                             "Split" or "Cut" becomes a spoken split, as the cue card offers it
// Both may be given together. Options: --label <run name>, --until <seconds> (end of the tagged
// part; default 60 s after the last note), --output <folder>.
//
// Plain Node after a build:
//   node scripts/intent-score.mjs --notes "G:/VC Audio Cues/Cai Chapter 4 Battle.txt" \
//     --transcript mic.json --proposals decisions.json --label cai-ch4
// Writes report.md and report.json to G:/Claude/Virtual Cut/intent-score/<label> unless
// --output says otherwise. Nothing is read from or written to a project.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseTaggedNotes } from '../dist-electron/intent-notes.js';
import { scoreRecording } from '../dist-electron/intent-score.js';

const { values } = parseArgs({
  options: {
    notes: { type: 'string' },
    proposals: { type: 'string', multiple: true },
    transcript: { type: 'string' },
    label: { type: 'string' },
    until: { type: 'string' },
    output: { type: 'string' },
  },
});
if (!values.notes) {
  console.error('Give --notes <tagged .txt> and at least one of --proposals or --transcript.');
  process.exit(2);
}
const kinds = {
  mark: 'marker',
  marker: 'marker',
  note: 'note',
  cut: 'split',
  split: 'split',
  clip: 'clip',
};
// Mic lines a proposal cites. With --transcript the cited line ids give each line's own time;
// otherwise one evidence entry is a span from its first to its last line, and a span longer
// than 20 s (a composite note citing lines far apart) would match everything in between, so it
// is left out and the proposal matches by its time instead.
let lineTimes;
const spans = (evidence = []) =>
  evidence
    .filter((e) => e.role === 'mic' && e.start != null)
    .flatMap((e) =>
      e.lineIds && lineTimes
        ? e.lineIds.map((id) => lineTimes.get(id)).filter(Boolean)
        : e.end - e.start <= 20
          ? [{ start: e.start, end: e.end }]
          : [],
    );
const intentsOf = (p) => [...new Set([...(p.intents || []), ...(p.intent ? [p.intent] : [])])];

/** Proposals from a decisions answer, a submit_proposals input or a plain array. */
function readProposals(json, name) {
  const rows = Array.isArray(json) ? json : json.proposals || [];
  return rows.map((p, i) => {
    if (p.source && p.mic) return p;
    if (p.proposed)
      return {
        id: p.id,
        source: 'agent',
        kind: kinds[p.kind],
        time: p.chosen?.time ?? p.proposed.time,
        end: p.chosen?.end ?? p.proposed.end,
        title: p.chosen?.title ?? p.proposed.title ?? '',
        intents: intentsOf(p),
        mic: spans(p.evidence),
        status: p.status,
        movedSeconds: p.movedSeconds,
      };
    // submit_proposals input: evidence names lines only; spans come with mic_span when the run
    // kept them, else matching falls back to time.
    return {
      id: `${name}#${i + 1}`,
      source: 'agent',
      kind: kinds[p.kind],
      time: p.time_seconds,
      end: p.end_seconds,
      title: p.title,
      intents: intentsOf(p),
      mic: p.mic_spans || [],
      status: 'pending',
    };
  });
}
/** Spoken Splits as the cue card offers them: a phrase that is only the command word. */
function spokenSplits(segments) {
  return segments
    .filter((s) => /^\s*(?:split|cut)[.!]?\s*$/i.test(s.text))
    .map((s, i) => ({
      id: `spoken-split-${i + 1}`,
      source: 'spoken',
      kind: 'split',
      time: s.start,
      title: s.text.trim(),
      intents: [],
      mic: [{ start: s.start, end: s.end }],
      status: 'pending',
    }));
}

const notes = parseTaggedNotes(await readFile(values.notes, 'utf8'));
const proposals = [];
if (values.transcript) {
  const t = JSON.parse(await readFile(values.transcript, 'utf8'));
  const lines = Array.isArray(t) ? t : t.segments || t.lines || [];
  if (lines.some((l) => l.id != null))
    lineTimes = new Map(lines.map((l) => [l.id, { start: l.start, end: l.end }]));
}
for (const file of values.proposals || [])
  proposals.push(...readProposals(JSON.parse(await readFile(file, 'utf8')), path.basename(file)));
if (values.transcript) {
  const t = JSON.parse(await readFile(values.transcript, 'utf8'));
  const lines = Array.isArray(t) ? t : t.segments || t.lines || [];
  proposals.push(...spokenSplits(lines));
}
const score = scoreRecording(notes.entries, proposals, {
  labelledUntil: values.until ? Number(values.until) : undefined,
});

const recording = path.basename(values.notes, path.extname(values.notes));
const label = values.label || new Date().toISOString().replace(/[:.]/g, '-');
const output = path.resolve(
  values.output || path.join('G:/Claude/Virtual Cut/intent-score', label),
);
const clock = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
const md = [
  `# Intent score: ${recording}`,
  '',
  `Run ${label}. Tagged part ends at ${clock(score.labelledUntil)}. ${proposals.length} proposals read ` +
    `(${proposals.filter((p) => p.source === 'agent').length} agent, ${proposals.filter((p) => p.source === 'spoken').length} spoken).`,
  '',
  '## Per intent',
  '',
  '| Intent | Tagged | Covered | Proposals | On tagged speech | Accepted | Rejected |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...score.intents.map(
    (i) =>
      `| ${i.intent} | ${i.tagged} | ${i.covered} (${pct(i.covered, i.tagged)}) | ${i.proposals} | ${i.matched} (${pct(i.matched, i.proposals)}) | ${i.accepted} | ${i.rejected} |`,
  ),
  '',
  `Decisions: ${score.decisions.accepted} accepted, ${score.decisions.rejected} rejected, ${score.decisions.pending} pending, ${score.decisions.moved} moved.`,
  '',
  '## Splits',
  '',
  '| Said at | Target | Proposed | Offset | On target |',
  '| --- | --- | --- | ---: | --- |',
  ...score.entries
    .filter((e) => e.split)
    .map(
      (e) =>
        `| ${e.written} | ${e.split.target || 'where said'} | ${e.split.proposal || 'none'} | ${e.split.offsetSeconds ?? ''} | ${e.split.onTarget ? 'yes' : 'no'} |`,
    ),
  '',
  '## Tagged speech',
  '',
  '| Time | Tags | Covered | Missing | Proposals | Said |',
  '| --- | --- | --- | --- | --- | --- |',
  ...score.entries
    .filter((e) => !e.split)
    .map(
      (e) =>
        `| ${e.written} | ${e.ignore ? 'ignore' : e.tags.join(', ')} | ${e.covered.join(', ')} | ${e.missing.join(', ')} | ${e.proposals.join(', ')} | ${e.said.slice(0, 70).replace(/\|/g, '/')} |`,
    ),
  '',
  '## False proposals',
  '',
  ...(score.falseProposals.length
    ? score.falseProposals.map((f) => `- ${clock(f.time)} ${f.title} (${f.reason}; ${f.status})`)
    : ['None.']),
  '',
];
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'report.md'), md.join('\n'));
await writeFile(
  path.join(output, 'report.json'),
  JSON.stringify({ recording, label, proposals, ...score }, null, 1),
);
console.log(md.slice(0, 18).join('\n'));
console.log(`\nReport: ${path.join(output, 'report.md')}`);
