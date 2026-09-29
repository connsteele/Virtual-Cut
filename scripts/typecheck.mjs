import { tsc } from './shared.mjs';

for (const config of ['tsconfig.app.json', 'tsconfig.node.json', 'tsconfig.electron.json']) {
  await tsc(['--project', config, '--noEmit']);
}
