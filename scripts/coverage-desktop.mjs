import { _electron } from 'playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
let installed = false;
const collectors = new WeakMap();
export async function collectBeforeWindowClose(app) {
  await collectors.get(app)?.();
}
export function installCoverageCollector() {
  if (installed) return;
  installed = true;
  const launch = _electron.launch.bind(_electron);
  _electron.launch = async (...args) => {
    const app = await launch(...args);
    const directory = path.join(process.env.VIRTUAL_CUT_COVERAGE_DIR, 'raw');
    await mkdir(directory, { recursive: true });
    const pid = await app.evaluate(() => process.pid);
    const check = process.env.VIRTUAL_CUT_COVERAGE_CHECK;
    const windowIds = new WeakMap();
    let nextWindowId = 0;
    // An expectation is recorded at launch, before a successful collector can hide a missing one.
    await writeFile(
      path.join(directory, `${check}-expected-${pid}.json`),
      JSON.stringify({ check, pid, expected: ['main', 'renderer', 'preload'] }),
    );
    const close = app.close.bind(app);
    const collect = async () => {
      const main = await app.evaluate(() => globalThis.__coverage__);
      if (!main || !Object.keys(main).length) throw Error('Main coverage missing');
      await writeFile(
        path.join(directory, `${check}-main-${pid}.json`),
        JSON.stringify({ check, kind: 'main', pid, complete: true, coverage: main }),
      );
      const pages = app.windows();
      if (!pages.length) throw Error('Renderer coverage missing: no windows');
      for (let i = 0; i < pages.length; i++) {
        // A reopened floating window is a new renderer. Preserve its predecessor's
        // final counters instead of reusing its array position and overwriting them.
        if (!windowIds.has(pages[i])) windowIds.set(pages[i], nextWindowId++);
        const windowId = windowIds.get(pages[i]);
        const coverage = await pages[i].evaluate(() => globalThis.__coverage__);
        if (!coverage || !Object.keys(coverage).length) throw Error('Renderer coverage missing');
        await writeFile(
          path.join(directory, `${check}-renderer-${pid}-${windowId}.json`),
          JSON.stringify({ check, kind: 'renderer', pid, complete: true, coverage }),
        );
        const session = await pages[i].context().newCDPSession(pages[i]);
        const contexts = [];
        session.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
        await session.send('Runtime.enable');
        let preload;
        for (const context of contexts.filter((c) => !c.auxData?.isDefault)) {
          const result = await session.send('Runtime.evaluate', {
            expression: 'globalThis.__coverage__',
            contextId: context.id,
            returnByValue: true,
          });
          if (Object.keys(result.result.value || {}).some((file) => file.endsWith('preload.cts')))
            preload = result.result.value;
        }
        await session.detach();
        if (!preload) throw Error('Isolated preload coverage missing');
        await writeFile(
          path.join(directory, `${check}-preload-${pid}-${windowId}.json`),
          JSON.stringify({ check, kind: 'preload', pid, complete: true, coverage: preload }),
        );
      }
    };
    collectors.set(app, collect);
    app.close = async () => {
      try {
        await collect();
      } finally {
        await close();
      }
    };
    return app;
  };
}
