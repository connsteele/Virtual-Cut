import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Where the screen text engine lives (VC-192). It is a Python 3.12 runtime of its own, apart from
 * the speech engine, because its ONNX Runtime (DirectML) clashes with the speech engine's (CPU).
 *
 * An install folder holds:
 *   python/python.exe   Python 3.12 embeddable
 *   libraries/          RapidOCR, onnxruntime-directml and their dependencies; the PP-OCRv6
 *                       small models ship inside libraries/rapidocr/models
 *
 * Lookup order: VIRTUAL_CUT_OCR_RUNTIME (an install folder, for development and checks), the
 * folder saved in the profile by setup, then `ocr` beside the bundled tools.
 */
export interface ScreenTextRuntimeSettings {
  folder: string;
  python: string;
  libraries: string;
}
/** Model files the reading pass loads; their presence marks a complete install. */
export const SCREEN_TEXT_MODELS = ['PP-OCRv6_det_small.onnx', 'PP-OCRv6_rec_small.onnx'];
export const screenTextLayout = (folder: string): ScreenTextRuntimeSettings => ({
  folder,
  python: path.join(folder, 'python', 'python.exe'),
  libraries: path.join(folder, 'libraries'),
});
/** The worker script the reading pass and the readiness check run (packaged like the speech worker). */
export const SCREEN_TEXT_WORKER = path.resolve(
  __dirname,
  '..',
  'integrations',
  'screen-text',
  'worker.py',
);

export class ScreenTextRuntime {
  settings: ScreenTextRuntimeSettings;
  private file: string;
  /** A setup was chosen at some point, so missing files mean it was moved or deleted. */
  private chosen: boolean;
  constructor(profile: string, toolsDirectory = '') {
    this.file = path.join(profile, 'screen-text-runtime.json');
    let saved = '';
    try {
      const value = JSON.parse(readFileSync(this.file, 'utf8')) as { folder?: unknown };
      if (typeof value.folder === 'string' && path.isAbsolute(value.folder)) saved = value.folder;
    } catch {
      /* First use, or no engine chosen yet. */
    }
    const override = process.env.VIRTUAL_CUT_OCR_RUNTIME || '';
    this.settings = screenTextLayout(
      path.resolve(override || saved || path.join(toolsDirectory, 'ocr')),
    );
    this.chosen = !!(override || saved);
  }
  /** The first required file that is absent right now, checked on every call. */
  get missing() {
    const c = this.settings;
    if (!existsSync(c.python)) return `Python was not found at ${c.python}.`;
    const models = path.join(c.libraries, 'rapidocr', 'models');
    for (const name of SCREEN_TEXT_MODELS)
      if (!existsSync(path.join(models, name)))
        return `The screen text engine was not found in ${c.libraries}.`;
    return '';
  }
  get configured() {
    return !this.missing;
  }
  /** Missing files of a setup that was chosen before, so moved or deleted outside the app. */
  get removed() {
    return this.chosen ? this.missing : '';
  }
  /** Why screen text cannot be read, or '' when the engine is in place. */
  get problem() {
    if (this.configured) return '';
    return this.removed
      ? `${this.removed} It may have been moved or deleted. Open Screen text engine to download it again.`
      : 'Screen text engine not installed.';
  }
}
