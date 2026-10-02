import { build } from 'vite';
import { root, runNode, tsc } from './shared.mjs';
import path from 'node:path';

await runNode(path.join(root, 'scripts/build-brand-assets.mjs'));
await tsc(['--project', 'tsconfig.app.json', '--noEmit']);
await tsc(['--project', 'tsconfig.node.json', '--noEmit']);
await tsc(['--project', 'tsconfig.electron.json']);
const coveragePlugin = process.env.VIRTUAL_CUT_COVERAGE_DIR
  ? await (
      await import('./coverage-build.mjs')
    ).prepareCoverage(process.env.VIRTUAL_CUT_COVERAGE_DIR)
  : null;
await build(coveragePlugin ? { plugins: [coveragePlugin] } : {});
console.log('Virtual Cut built. Launch with npm start.');
