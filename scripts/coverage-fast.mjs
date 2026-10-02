import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { instrument } from './coverage-build.mjs';
import './coverage-native.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({
  load(url, context, next) {
    if (url.startsWith('file:')) {
      const file = fileURLToPath(url);
      if (
        (file.startsWith(path.join(root, 'src') + path.sep) ||
          file.startsWith(path.join(root, 'electron') + path.sep)) &&
        /\.(ts|tsx|cts)$/.test(file) &&
        !file.endsWith('.d.ts')
      ) {
        const result = instrument(readFileSync(file, 'utf8'), file);
        return {
          format: file.endsWith('.cts') ? 'commonjs' : 'module',
          shortCircuit: true,
          source: ts.transpileModule(result.code, {
            fileName: file,
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: file.endsWith('.cts') ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext,
              jsx: ts.JsxEmit.ReactJSX,
            },
          }).outputText,
        };
      }
    }
    return next(url, context);
  },
});
