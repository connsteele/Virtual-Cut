import path from 'node:path';
import { scratchPath } from './shared.mjs';
/** Each suite run receives its own synthetic fixtures, profiles and reports. */
export const testPath = (...parts) =>
  process.env.VIRTUAL_CUT_TEST_ROOT
    ? path.resolve(process.env.VIRTUAL_CUT_TEST_ROOT, ...parts)
    : scratchPath(...parts);
