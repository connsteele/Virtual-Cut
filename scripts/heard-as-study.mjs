// VC-194 study: run a game's Heard as rows over saved transcripts (JSON arrays of segments, as
// the speech worker writes them) and report what changes. Every word not matched by a row must
// come out unchanged, so the diff lists only the corrected words.
//
//   node scripts/heard-as-study.mjs --rows "Cai=Kai" --out <folder> game.json mic.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { heardAsEdits, heardAsRules, heardAsUsed } from '../dist-electron/heard-as.js';
import { correctedText } from '../dist-electron/transcript-edits.js';

const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const rowsArg = take('--rows');
const out = take('--out');
if (!rowsArg || !out || !args.length)
  throw new Error(
    'Usage: heard-as-study.mjs --rows "Cai=Kai,Kye;Orchel=Archel" --out <folder> files…',
  );
const rows = rowsArg.split(';').map((r) => {
  const [name, heard] = r.split('=');
  return { name, heard: heard.split(',') };
});
const { rules, problems } = heardAsRules(rows);
const count = (segments, word) =>
  segments.reduce(
    (n, s) =>
      n +
      s.words.filter((w) => new RegExp(`^\\W*${word}(?:['’]s)?\\W*$`, 'iu').test(w.text.trim()))
        .length,
    0,
  );
const lines = [`# Heard-as study`, '', `Rows: ${rowsArg}`, ''];
if (problems.length) lines.push(...problems.map((p) => `- Problem: ${p.text}`), '');
const summary = [];
for (const file of args) {
  const segments = JSON.parse(readFileSync(file, 'utf8'));
  const transcript = { id: path.basename(file, '.json') };
  const { edits } = heardAsEdits({}, transcript, segments, rules);
  const model = { transcriptEdits: edits };
  let otherWordsChanged = 0;
  const changed = [];
  for (const segment of segments) {
    const before = segment.words.map((w) => w.text).join('');
    const after = correctedText(model, transcript.id, segment);
    const mine = edits.filter((e) => e.segmentId === segment.id);
    // Only the edited words may differ, and each only in its spelling: put the heard spelling
    // back and the original word must come out, punctuation and spacing included.
    const rebuilt = segment.words
      .map((w, i) => mine.find((e) => e.wordIndex === i)?.text ?? w.text)
      .join('');
    if (rebuilt !== after) otherWordsChanged++;
    for (const e of mine) {
      const original = segment.words[e.wordIndex].text;
      if (e.text.replace(rules.get(e.heardAs.toLowerCase()), e.heardAs) !== original)
        otherWordsChanged++;
    }
    if (before !== after)
      changed.push({ start: segment.start, before: before.trim(), after: after.trim() });
  }
  const names = [...new Set(rules.values())];
  const heard = [...rules.keys()];
  const row = {
    file: path.basename(file),
    heardBefore: Object.fromEntries(heard.map((h) => [h, count(segments, h)])),
    namesBefore: Object.fromEntries(names.map((n) => [n, count(segments, n)])),
    namesAfter: Object.fromEntries(
      names.map((n) => [
        n,
        count(
          segments.map((s) => ({
            ...s,
            words: s.words.map((w, i) => ({
              ...w,
              text: edits.find((e) => e.segmentId === s.id && e.wordIndex === i)?.text ?? w.text,
            })),
          })),
          n,
        ),
      ]),
    ),
    edits: edits.length,
    used: heardAsUsed(edits),
    linesChanged: changed.length,
    otherWordsChanged,
  };
  summary.push(row);
  lines.push(
    `## ${row.file}`,
    '',
    `- Before: ${JSON.stringify(row.heardBefore)} heard, ${JSON.stringify(row.namesBefore)} game spelling`,
    `- After: ${JSON.stringify(row.namesAfter)} game spelling; ${row.edits} word corrections in ${row.linesChanged} lines`,
    `- Words changed that no row matched: ${row.otherWordsChanged}`,
    '',
    '| Time | Before | After |',
    '| --- | --- | --- |',
    ...changed.map(
      (c) =>
        `| ${c.start.toFixed(1)} | ${c.before.replaceAll('|', '\\|')} | ${c.after.replaceAll('|', '\\|')} |`,
    ),
    '',
  );
}
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'report.md'), lines.join('\n'));
writeFileSync(path.join(out, 'report.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
