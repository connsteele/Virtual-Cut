import { build } from 'vite';
import { root, runNode, tsc } from './shared.mjs';
import path from 'node:path';

await runNode(path.join(root, 'scripts/build-brand-assets.mjs'));
await tsc(['--project', 'tsconfig.app.json', '--noEmit']);
await tsc(['--project', 'tsconfig.node.json', '--noEmit']);
await tsc(['--project', 'tsconfig.electron.json']);
await build();
console.log('Virtual Cut built. Launch with npm start.');
