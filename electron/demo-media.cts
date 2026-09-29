import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { VideoAccess } from './media.cjs';

/** A local, native-owned allowlist for the explicitly prepared demo copies. */
export class DemoMedia {
  private videos = new Map<string, { access: VideoAccess; url: string }>();

  async load(manifestPath: string): Promise<void> {
    this.videos.clear();
    let text: string;
    try {
      text = await readFile(manifestPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const manifest = JSON.parse(text);
    if (
      typeof manifest.root !== 'string' ||
      !path.isAbsolute(manifest.root) ||
      !manifest.files ||
      typeof manifest.files !== 'object'
    ) {
      throw new Error('Invalid local demo media manifest.');
    }
    const root = await realpath(manifest.root);
    const entries = Object.entries(manifest.files);
    if (entries.length > 32) throw new Error('Too many demo files.');
    const prepared = new Map<string, { access: VideoAccess; url: string }>();
    for (const [id, file] of entries) {
      if (
        !/^[a-z0-9-]{1,64}$/.test(id) ||
        typeof file !== 'string' ||
        /[\\/:\0]/.test(file) ||
        file === '.' ||
        file === '..'
      ) {
        throw new Error('Invalid demo file entry.');
      }
      const resolved = await realpath(path.join(root, file));
      const relative = path.relative(root, resolved);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('Demo file is outside its configured directory.');
      }
      const access = new VideoAccess();
      const selected = await access.select(resolved);
      prepared.set(`media://video/demo/${id}`, { access, url: selected.url });
    }
    this.videos = prepared;
  }

  async respond(request: Request): Promise<Response> {
    const video = this.videos.get(request.url);
    if (!video) return new Response(null, { status: 404 });
    return video.access.respond(
      new Request(video.url, {
        method: request.method,
        headers: request.headers,
        signal: request.signal,
      }),
    );
  }
}
