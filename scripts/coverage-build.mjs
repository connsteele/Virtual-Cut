import { createInstrumenter } from 'istanbul-lib-instrument';
import ts from 'typescript';
import path from 'node:path';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function instrument(code, filename) {
  const instrumenter = createInstrumenter({
    esModules: true,
    parserPlugins: ['typescript', 'jsx'],
    coverageGlobalScope: 'globalThis',
    coverageGlobalScopeFunc: false,
    produceSourceMap: true,
  });
  const output = instrumenter.instrumentSync(code, path.resolve(filename));
  return {
    code: output,
    map: instrumenter.lastSourceMap(),
    coverage: instrumenter.lastFileCoverage(),
  };
}
export async function productionFiles(directory) {
  const results = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) results.push(...(await productionFiles(file)));
    else if (/\.(?:ts|tsx|cts)$/.test(file) && !file.endsWith('.d.ts')) results.push(file);
  }
  return results;
}
export async function sourceFingerprint() {
  const sources = {};
  for (const folder of ['src', 'electron'])
    for (const file of await productionFiles(path.join(root, folder)))
      sources[file] = createHash('sha256')
        .update(await readFile(file))
        .digest('hex');
  return sources;
}
export async function prepareCoverage(directory) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'sources.json'), JSON.stringify(await sourceFingerprint()));
  const baseline = {};
  for (const folder of ['src', 'electron']) {
    for (const file of await productionFiles(path.join(root, folder))) {
      const result = instrument(await readFile(file, 'utf8'), file);
      // Type-only files have no executable counters; keep them in the inventory.
      baseline[file] = result.coverage;
      if (folder === 'electron') {
        const compiled = ts.transpileModule(result.code, {
          fileName: file,
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: file.endsWith('.cts') ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext,
            esModuleInterop: true,
          },
        }).outputText;
        const output = path.join(
          root,
          'dist-electron',
          path
            .relative(path.join(root, 'electron'), file)
            .replace(/\.cts$/, '.cjs')
            .replace(/\.ts$/, '.js'),
        );
        const hook =
          file.endsWith('.cts') && !file.endsWith('preload.cts')
            ? `require(${JSON.stringify(path.join(root, 'scripts/coverage-native.cjs'))});\n`
            : '';
        await writeFile(output, hook + compiled);
      }
    }
  }
  await writeFile(path.join(directory, 'baseline.json'), JSON.stringify(baseline));
  return {
    name: 'virtual-cut-test-coverage',
    enforce: 'pre',
    transform(code, id) {
      if (!id.startsWith(root.replaceAll('\\', '/') + '/src/') || !/\.(ts|tsx)$/.test(id)) return;
      const result = instrument(code, id);
      return { code: result.code, map: result.map };
    },
  };
}
