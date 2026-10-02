/* eslint-disable @typescript-eslint/no-require-imports -- Loaded by instrumented CommonJS modules. */
// Test builds only. No collector or instrumentation ships in a normal build.
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const directory = process.env.VIRTUAL_CUT_COVERAGE_DIR;
if (directory) {
  const destination = path.join(directory, 'raw');
  mkdirSync(destination, { recursive: true });
  const filename = path.join(
    destination,
    `${process.env.VIRTUAL_CUT_COVERAGE_CHECK || 'child'}-native-${process.pid}.json`,
  );
  const flush = (complete) =>
    writeFileSync(
      filename,
      JSON.stringify({
        check: process.env.VIRTUAL_CUT_COVERAGE_CHECK,
        kind: 'native',
        pid: process.pid,
        complete,
        coverage: globalThis.__coverage__ || {},
      }),
    );
  const timer = setInterval(() => flush(false), 2000);
  flush(false);
  timer.unref();
  process.on('exit', () => flush(true));
}
