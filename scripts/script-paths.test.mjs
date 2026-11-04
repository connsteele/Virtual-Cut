// Scripts take machine paths from settings (.env, see .env.example), never from the code
// (VC-190). This fails when a drive-letter path such as G:/ or W:\ appears in scripts/.
// Unit tests (*.test.*) are exempt: their Windows paths are sample input for path handling and
// are never opened.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scripts = path.dirname(fileURLToPath(import.meta.url));
// A letter, a colon and a slash, not inside a word ("https://") or after an escape (/\d:\d/).
const drivePath = /(?<![\w\\/])[A-Za-z]:[\\/]/;

export function drivePaths(text) {
  return text
    .split('\n')
    .map((line, i) => ({ line: i + 1, text: line.trim() }))
    .filter((l) => drivePath.test(l.text));
}

test('the pattern finds drive paths and leaves URLs and patterns alone', () => {
  for (const sample of ["'G:/GPT/Temp'", '"W:\\\\AI\\\\Claude"', '`F:/VC Audio Cues`', 'C:\\x'])
    assert.equal(drivePaths(sample).length, 1, sample);
  for (const sample of [
    "'media://video/id'",
    "'https://example.com'",
    "import os from 'node:os';",
    '/^(\\d\\d:\\d\\d:\\d\\d)$/',
    'name: /^Source folder:/',
  ])
    assert.deepEqual(drivePaths(sample), [], sample);
});

test('no script names a drive-letter path', async () => {
  const found = [];
  for (const name of await readdir(scripts)) {
    if (/\.test\.\w+$/.test(name) || !/\.(mjs|cjs|js|py|json|html)$/.test(name)) continue;
    for (const l of drivePaths(await readFile(path.join(scripts, name), 'utf8')))
      found.push(`${name}:${l.line}: ${l.text}`);
  }
  assert.deepEqual(found, [], 'Move these paths into a setting (.env.example).');
});
