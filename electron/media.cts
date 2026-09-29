import { randomUUID } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import type { OpenedVideo } from './contracts.js' with { 'resolution-mode': 'import' };

const types: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.m4a': 'audio/mp4',
  '.jpg': 'image/jpeg',
};
export const videoExtensions = ['mp4', 'm4v', 'mov', 'mkv', 'webm'];

/** Only trusted native code grants a selected video or a confined bundled asset. */
export class VideoAccess {
  private selected: { video: OpenedVideo; path: string; modified: number; type: string } | null =
    null;

  async select(file: string): Promise<OpenedVideo> {
    const resolved = await realpath(file);
    const type = types[path.extname(resolved).toLowerCase()];
    const info = await stat(resolved);
    if (!type || !info.isFile() || info.size === 0 || !Number.isSafeInteger(info.size)) {
      throw new Error('Choose a non-empty MP4, MKV, MOV, M4V, or WebM video.');
    }
    const id = randomUUID();
    const video = {
      id,
      name: path.basename(resolved),
      bytes: info.size,
      url: `media://video/${id}`,
    };
    this.selected = { video, path: resolved, modified: info.mtimeMs, type };
    return video;
  }

  clear(): void {
    this.selected = null;
  }

  async respond(request: Request): Promise<Response> {
    const selected = this.selected;
    if (!selected || request.url !== selected.video.url) return new Response(null, { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });

    // No path is taken from the renderer or URL. Re-open the selected file
    // read-only for bounded streaming; never buffer an entire recording.
    let handle;
    try {
      handle = await open(selected.path, 'r');
      const info = await handle.stat();
      if (
        !info.isFile() ||
        info.size !== selected.video.bytes ||
        info.mtimeMs !== selected.modified
      ) {
        await handle.close();
        return new Response(null, { status: 409 });
      }
      const size = info.size;
      const headers = new Headers({
        'Content-Type': selected.type,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      // A selected recording can provide frames to the trusted renderer's
      // screenshot canvas. Other origins receive no cross-origin permission.
      const origin = request.headers.get('origin');
      if (origin === 'app://virtual-cut' || origin === 'http://127.0.0.1:5173') {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Vary', 'Origin');
      }
      let start = 0;
      let end = size - 1;
      const range = request.method === 'HEAD' ? null : request.headers.get('range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (match && (match[1] || match[2])) {
          if (match[1]) {
            start = Number(match[1]);
            end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
          } else {
            const suffix = Number(match[2]);
            start = suffix > 0 && Number.isSafeInteger(suffix) ? Math.max(0, size - suffix) : size;
          }
        } else start = size;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start >= size ||
          end < start
        ) {
          await handle.close();
          headers.set('Content-Range', `bytes */${size}`);
          return new Response(null, { status: 416, headers });
        }
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
      }
      headers.set('Content-Length', String(end - start + 1));
      if (request.method === 'HEAD') {
        await handle.close();
        return new Response(null, { status: 200, headers });
      }
      const stream = handle.createReadStream({
        start,
        end,
        autoClose: true,
        signal: request.signal,
      });
      // Response cancellation (seeking, replacing the clip, closing the window)
      // propagates through toWeb and closes this stream's file handle.
      const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
      return new Response(body, { status: range ? 206 : 200, headers });
    } catch {
      await handle?.close().catch(() => {});
      return new Response(null, { status: 404 });
    }
  }
}
