import path from 'node:path';
/** Each suite run receives its own synthetic fixtures, profiles and reports. */
export const testPath = (...parts) =>
  path.resolve(process.env.VIRTUAL_CUT_TEST_ROOT || 'G:/GPT/Work/virtual-cut', ...parts);
