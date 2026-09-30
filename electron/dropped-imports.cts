import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { videoExtensions } from './media.cjs';
import type { DroppedImport } from './project-contracts.js' with { 'resolution-mode': 'import' };

/** One short-lived drop offer; only main owns the native file paths. */
export class DroppedImports {
  private offer?: {
    token: string;
    project: string;
    batch: string;
    files: string[];
    expires: number;
  };
  async stage(
    project: string,
    batch: string,
    entries: { name: string; path: string }[],
  ): Promise<DroppedImport> {
    this.offer = undefined;
    if (!Array.isArray(entries) || !entries.length || entries.length > 10000)
      throw new Error('Drop between 1 and 10,000 video files.');
    const files: string[] = [],
      issues: DroppedImport['issues'] = [],
      seen = new Set<string>();
    let skipped = 0;
    for (const entry of entries) {
      const name = typeof entry?.name === 'string' ? entry.name.slice(0, 200) : 'Unknown file';
      let reason = '';
      try {
        if (typeof entry?.path !== 'string' || !path.isAbsolute(entry.path))
          throw new Error('Drag a saved file from Windows Explorer.');
        const file = await realpath(entry.path);
        if (!(await stat(file)).isFile()) throw new Error('Use Import folder for folders.');
        if (!videoExtensions.includes(path.extname(file).slice(1).toLowerCase()))
          throw new Error('Not a supported video file.');
        const key = file.toLowerCase();
        if (seen.has(key)) throw new Error('Already included in this drop.');
        seen.add(key);
        files.push(file);
      } catch (e) {
        reason =
          e instanceof Error && !('code' in e) ? e.message : 'File is missing or cannot be read.';
      }
      if (reason) {
        skipped++;
        if (issues.length < 20) issues.push({ name, reason });
      }
    }
    const token = files.length ? randomUUID() : '';
    if (token) this.offer = { token, project, batch, files, expires: Date.now() + 10 * 60 * 1000 };
    return { token, count: files.length, skipped, issues };
  }
  discard(token: string) {
    if (this.offer?.token === token) this.offer = undefined;
  }
  take(project: string, batch: string, token: string) {
    const offer = this.offer;
    if (
      !offer ||
      offer.token !== token ||
      offer.project !== project ||
      offer.batch !== batch ||
      offer.expires < Date.now()
    )
      throw new Error('This drop is no longer available. Drop the files again.');
    this.offer = undefined;
    return offer.files;
  }
}
