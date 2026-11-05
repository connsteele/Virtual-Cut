import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { require, root } from './shared.mjs';
const {
  screenTextLayout,
  SCREEN_TEXT_MODELS,
} = require('../dist-electron/screen-text-runtime.cjs');

/**
 * A stand-in screen text engine for checks (VC-141): this PC's Python, linked as the engine's
 * python folder, and the stub RapidOCR in scripts/screen-text-stub. The real worker, its guard
 * and FFmpeg run; only the reading is made up. Returns the install folder and its layout.
 */
export async function stubEngine(dir) {
  const system =
    process.env.VIRTUAL_CUT_STUB_PYTHON ||
    spawnSync('python', ['-c', 'import sys; print(sys.executable)'], {
      encoding: 'utf8',
    }).stdout?.trim();
  assert(system, 'Python 3 is needed on PATH (or VIRTUAL_CUT_STUB_PYTHON) for this check.');
  const folder = path.join(dir, 'engine'),
    layout = screenTextLayout(folder);
  await mkdir(folder, { recursive: true });
  await symlink(path.dirname(system), path.join(folder, 'python'), 'junction');
  await cp(path.join(root, 'scripts', 'screen-text-stub'), layout.libraries, { recursive: true });
  await mkdir(path.join(layout.libraries, 'rapidocr', 'models'), { recursive: true });
  for (const name of SCREEN_TEXT_MODELS)
    await writeFile(path.join(layout.libraries, 'rapidocr', 'models', name), 'stub');
  return { folder, layout };
}

/**
 * 20 s at 30 fps with a keyframe every second: moving picture, a 6 s frozen frame, black, moving
 * picture; two audio tracks. `tool` runs FFmpeg with the given arguments.
 */
export async function screenTextClip(tool, file) {
  await tool([
    ...['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30'],
    ...['-f', 'lavfi', '-i', 'color=c=black:size=1280x720:rate=30'],
    ...['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'],
    '-filter_complex',
    [
      '[0:v]trim=duration=6[a]',
      '[0:v]trim=start=6:duration=0.0334,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=6[b]',
      '[1:v]trim=duration=2[c]',
      '[0:v]trim=start=14:duration=6,setpts=PTS-STARTPTS[d]',
      '[a][b][c][d]concat=n=4:v=1:a=0,format=yuv420p[v]',
    ].join(';'),
    ...['-map', '[v]', '-map', '2:a', '-map', '2:a', '-t', '20'],
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-keyint_min', '30'],
    ...['-sc_threshold', '0', '-c:a', 'aac', '-y', file],
  ]);
}
