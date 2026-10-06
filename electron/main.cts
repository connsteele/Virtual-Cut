import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
  clipboard,
  crashReporter,
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { realpath, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Diagnostics, errorCode } from './diagnostics.cjs';
import { observeWindow } from './window-diagnostics.cjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppInfo, OpenedVideo, ProjectFolder } from './contracts.js' with {
  'resolution-mode': 'import',
};
import { VideoAccess, videoExtensions } from './media.cjs';
import { DemoMedia } from './demo-media.cjs';
import { ProjectService } from './project-service.cjs';
import { registerTranscriptWindow } from './transcript-window.cjs';
import { recoverProjectCopy } from './project-recovery.cjs';
import { DroppedImports } from './dropped-imports.cjs';
import {
  installResolveHelper,
  resolveHelperStatus,
  removeResolveHelper,
} from './resolve-helper.cjs';
import type { ProjectApi } from './project-contracts.js' with { 'resolution-mode': 'import' };

const APP_URL = 'app://virtual-cut/';
const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: media://video; font-src 'self' data:; connect-src 'self'; media-src 'self' media://video; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'";
let mainWindow: BrowserWindow | null = null;
let folderDialog: Promise<ProjectFolder | null> | null = null;
let videoDialog: Promise<OpenedVideo | null> | null = null;
const videoAccess = new VideoAccess();
const demoMedia = new DemoMedia();
const droppedImports = new DroppedImports();
let projects: ProjectService;
let transcriptWindow: ReturnType<typeof registerTranscriptWindow>;
let closing = false;
let diagnostics: Diagnostics;
let lastProjectFile: string | undefined;

app.setName('Virtual Cut');
app.setAppUserModelId('com.virtuallegacy.virtualcut');

// An explicit launch switch lets tests (and a manually launched secondary
// profile) keep their preferences and browser cache separate from normal use.
// Normal launches retain Electron's standard application-data location.
const requestedProfile = app.commandLine.getSwitchValue('user-data-dir');
// Opt-in automation with its own profile can run without taking over the desktop.
const backgroundTest = Boolean(requestedProfile) && app.commandLine.hasSwitch('background-test');
if (requestedProfile) {
  if (!path.isAbsolute(requestedProfile))
    throw new Error('--user-data-dir requires an absolute directory.');
  mkdirSync(requestedProfile, { recursive: true });
  app.setPath('userData', requestedProfile);
  app.setPath('sessionData', requestedProfile);
}
// A window that is never shown produces no frames, so Chromium acknowledges each
// automated mouse event only after a one-second fallback (8 s for an 8-step drag).
// Subscribing to frames keeps test windows hidden but drawing like visible ones; it
// only takes effect once a page has loaded. Frames are copied only when the page
// changes, at most 30 per second: a full-window redraw on every frame measured about
// 18% of one core in the main process (asking for only the changed area cost more).
if (backgroundTest)
  app.on('browser-window-created', (_event, window) =>
    window.webContents.on('did-finish-load', () =>
      window.webContents.beginFrameSubscription(() => {}),
    ),
  );

// Start before creating either renderer. Native dumps remain local and separate
// from the redacted text report; no submit URL or automatic upload is configured.
let crashCapture = false;
try {
  const crashDirectory = path.join(app.getPath('userData'), 'diagnostics', 'crashes');
  mkdirSync(crashDirectory, { recursive: true });
  app.setPath('crashDumps', crashDirectory);
  crashReporter.start({ uploadToServer: false });
  crashCapture = true;
} catch {
  /* Diagnostics below reports unavailable capture without blocking startup. */
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, stream: true, corsEnabled: true },
  },
]);

function getRendererUrl(): string {
  const candidate = process.env.VIRTUAL_CUT_DEV_URL;
  if (app.isPackaged || !candidate) return APP_URL;
  const parsed = new URL(candidate);
  if (
    parsed.origin !== 'http://127.0.0.1:5173' ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('The development renderer must be http://127.0.0.1:5173/.');
  }
  return parsed.href;
}

function assertTrustedSender(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>): void {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error('Desktop request rejected.');
  }
  if (event.senderFrame.url.split('#')[0] !== getRendererUrl()) {
    throw new Error('Desktop request came from an unexpected page.');
  }
}

function isInside(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function registerAppProtocol(): Promise<void> {
  const rendererDirectory = await realpath(path.join(__dirname, '..', 'dist'));
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      if (
        url.protocol !== 'app:' ||
        url.host !== 'virtual-cut' ||
        url.username ||
        url.password ||
        !['GET', 'HEAD'].includes(request.method)
      ) {
        return new Response('Not found', { status: 404 });
      }
      const decodedPath = decodeURIComponent(url.pathname);
      // Colon blocks Windows alternate data streams; backslashes and dot
      // segments must never turn an asset URL into a different local path.
      if (
        !decodedPath.startsWith('/') ||
        /[\\:\0]/.test(decodedPath) ||
        decodedPath.split('/').some((segment) => segment === '.' || segment === '..')
      ) {
        return new Response('Not found', { status: 404 });
      }
      const requestedPath = path.resolve(
        rendererDirectory,
        `.${decodedPath === '/' ? '/index.html' : decodedPath}`,
      );
      if (!isInside(rendererDirectory, requestedPath))
        return new Response('Not found', { status: 404 });
      const resolvedPath = await realpath(requestedPath);
      if (!isInside(rendererDirectory, resolvedPath) || !(await stat(resolvedPath)).isFile()) {
        return new Response('Not found', { status: 404 });
      }
      let response: Response;
      if (videoExtensions.includes(path.extname(resolvedPath).slice(1).toLowerCase())) {
        // Bundled preview media needs the same byte-range responses as local
        // footage. Its path is confined to dist above, with a separate grant.
        const bundled = new VideoAccess();
        const grant = await bundled.select(resolvedPath);
        response = await bundled.respond(
          new Request(grant.url, {
            method: request.method,
            headers: request.headers,
            signal: request.signal,
          }),
        );
      } else {
        response = await net.fetch(pathToFileURL(resolvedPath).href, { method: request.method });
      }
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', APP_CSP);
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function registerDesktopApi(): void {
  ipcMain.handle('diagnostics:summary', (event) => {
    assertTrustedSender(event);
    return diagnostics.summary();
  });
  ipcMain.handle('diagnostics:copy', async (event) => {
    assertTrustedSender(event);
    // Electron's clipboard write is asynchronous; report a failure instead of claiming success.
    await clipboard.writeText((await diagnostics.summary()).text);
  });
  ipcMain.handle('diagnostics:open', async (event) => {
    assertTrustedSender(event);
    await diagnostics.flush();
    const error = await shell.openPath(diagnostics.directory);
    if (error) throw new Error('Logs could not be opened. Check local storage access.');
  });
  ipcMain.handle('diagnostics:export', async (event) => {
    assertTrustedSender(event);
    const summary = await diagnostics.summary();
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save diagnostic report',
      defaultPath: `Virtual-Cut-diagnostics-${Date.now()}.txt`,
      filters: [{ name: 'Diagnostic report', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, summary.text, { encoding: 'utf8', flag: 'wx' });
    return true;
  });
  ipcMain.on('diagnostics:playback', (event, value: unknown) => {
    assertTrustedSender(event);
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (
      ![
        'source-open',
        'reload',
        'play',
        'pause',
        'scan',
        'media-error',
        'preview-recovered',
      ].includes(String(record.event))
    )
      return;
    diagnostics.record(String(record.event), {
      ...record,
      ...(['media-error', 'reload', 'preview-recovered'].includes(String(record.event))
        ? projects.playbackDetails(String(record.sourceId))
        : {}),
    });
  });
  // Preview work must not hold the serialized project-edit queue, especially
  // while a cancellation, Save or close request is waiting.
  ipcMain.handle('workspace:filmstrip', (event, id, sourceId, times, token) => {
    assertTrustedSender(event);
    return projects.filmstrip(id, sourceId, times, token);
  });
  ipcMain.handle('workspace:cancelFilmstrip', (event, id, token, release) => {
    assertTrustedSender(event);
    projects.cancelFilmstrip(id, token, release);
  });
  // A read-only lookup; it must not wait behind queued saves or media operations.
  ipcMain.handle('workspace:frameIndex', (event, id, sourceId) => {
    assertTrustedSender(event);
    return projects.frameIndex(id, sourceId);
  });
  type Calls = Omit<
    ProjectApi,
    | 'onCloseRequested'
    | 'onChanged'
    | 'finishClose'
    | 'selectBatch'
    | 'deleteBatch'
    | 'stageDrop'
    | 'frameIndex'
  > & {
    'finish-close': ProjectApi['finishClose'];
    'select-batch': ProjectApi['selectBatch'];
    'delete-batch': ProjectApi['deleteBatch'];
    stageDrop: (
      id: string,
      batchId: string,
      files: { name: string; path: string }[],
    ) => ReturnType<ProjectApi['stageDrop']>;
  };
  let request: Promise<unknown> = Promise.resolve();
  const workspace = <K extends keyof Calls>(
    name: K,
    fn: (...args: Parameters<Calls[K]>) => unknown,
  ) => {
    ipcMain.handle('workspace:' + name, (event, ...args: unknown[]) => {
      assertTrustedSender(event);
      const next = request.then(async () => {
        const tracked = ![
          'current',
          'recent',
          'revealSave',
          'revealSource',
          'revealExport',
          'save',
        ].includes(name);
        const operationId = randomUUID(),
          started = performance.now();
        if (tracked)
          diagnostics.record('operation-start', {
            operation: name,
            operationId,
            projectId: projects.store?.data.project.id,
          });
        try {
          const value = await fn(...(args as Parameters<Calls[K]>));
          if (tracked)
            diagnostics.record('operation-end', {
              operation: name,
              operationId,
              elapsedMs: performance.now() - started,
            });
          return value;
        } catch (e) {
          diagnostics.record('operation-failed', {
            operation: name,
            operationId,
            errorCode: errorCode(e),
          });
          throw e;
        }
      });
      request = next.catch(() => {});
      return next;
    });
  };
  workspace('recent', () => projects.recent());
  workspace('storageUsage', (id) => projects.storageUsage(id));
  workspace('deletionPlan', (id) => projects.deletionPlan(id));
  workspace('deleteProject', (id, token, cleanup) => projects.deleteProject(id, token, cleanup));
  workspace('current', () => (projects.store ? projects.snapshot() : null));
  workspace('acceptReview', (id, clipId) => projects.acceptReview(id, clipId));
  workspace('destinationPlan', (id) => projects.destinationPlan(id));
  workspace('destinationFolders', (id, folder) => projects.destinationFolders(id, folder));
  workspace('revealDestination', async (id, folder) => {
    const error = await shell.openPath(await projects.destinationLocation(id, folder));
    if (error) throw new Error('Could not open this destination folder.');
  });
  workspace('chooseDestination', async (id, folder) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose finished-video folder',
      defaultPath: await projects.destinationLocation(id, folder),
      properties: ['openDirectory'],
    });
    return result.canceled || !result.filePaths[0]
      ? null
      : projects.selectDestination(id, result.filePaths[0]);
  });
  workspace('save', (id, before, after) => projects.save(id, before, after));
  workspace('checkpoint', (id) => projects.checkpoint(id));
  workspace('autosave', (id) => projects.autosave(id));
  workspace('restore', (id, saveId) => projects.restore(id, saveId));
  workspace('revealSave', async (id, saveId) =>
    shell.showItemInFolder(await projects.saveLocation(id, saveId)),
  );
  workspace('revealSource', async (id, sourceId) =>
    shell.showItemInFolder(await projects.sourceLocation(id, sourceId)),
  );
  workspace('history', (id, direction) => projects.history(id, direction));
  workspace('batch', (id, name) => projects.batch(id, name));
  workspace('select-batch', (id, batchId) => projects.selectBatch(id, batchId));
  workspace('removeRecording', (id, batchId, sourceId) =>
    projects.removeRecording(id, batchId, sourceId),
  );
  workspace('delete-batch', (id, batchId, targetId, mode) =>
    projects.deleteBatch(id, batchId, targetId, mode),
  );
  workspace('audio', (id, sourceId) => projects.prepareAudio(id, sourceId));
  workspace('job', (id, jobId, action) => projects.job(id, jobId, action));
  workspace('exportPlan', (id, clipId, container) => projects.exportPlan(id, clipId, container));
  const resolveHelperPaths = () => ({
    bundled: path.join(app.getAppPath(), 'integrations', 'resolve', 'Virtual Cut metadata.py'),
    directory: path.join(
      app.getPath('appData'),
      'Blackmagic Design',
      'DaVinci Resolve',
      'Support',
      'Fusion',
      'Scripts',
      'Utility',
    ),
  });
  workspace('installResolveHelper', () => {
    const { bundled, directory } = resolveHelperPaths();
    return installResolveHelper(bundled, directory);
  });
  workspace('resolveHelperStatus', () => {
    const { bundled, directory } = resolveHelperPaths();
    return resolveHelperStatus(bundled, directory);
  });
  workspace('removeResolveHelper', () => {
    const { bundled, directory } = resolveHelperPaths();
    return removeResolveHelper(bundled, directory);
  });
  workspace('revealResolveHelper', async () => {
    const { bundled, directory } = resolveHelperPaths();
    const status = await resolveHelperStatus(bundled, directory);
    if (status.state === 'missing')
      throw new Error('Install the helper before opening its location.');
    shell.showItemInFolder(status.file);
  });
  workspace('filingPlan', (id, batchId) => projects.filingPlan(id, batchId));
  workspace('fileQueue', (id, planId, confirmed, transcript) =>
    projects.fileQueue(id, planId, confirmed, transcript),
  );
  workspace('cancelFiling', (id, queueId) => projects.cancelFiling(id, queueId));
  workspace('retainedMedia', (id, exportId) => projects.retainedMedia(id, exportId));
  workspace('inspectRetained', (id, exportId, token) =>
    projects.inspectRetained(id, exportId, token),
  );
  workspace('releaseRetained', (id, token) => projects.releaseRetained(id, token));
  workspace('relinkExport', async (id, exportId) => {
    const record = projects
      .require(id)
      .exports()
      .find((e) => e.plan.id === exportId && e.filing?.state === 'complete');
    if (!record) throw new Error('Choose a completed Library clip.');
    const chosen = await dialog.showOpenDialog(mainWindow!, {
      title: 'Locate the completed video and its adjacent .vcut.json companion',
      defaultPath: projects.require(id).data.project.destination,
      properties: ['openFile'],
      filters: [{ name: 'Completed video', extensions: [record.plan.container] }],
    });
    return chosen.canceled || !chosen.filePaths[0]
      ? null
      : projects.relinkExport(id, exportId, chosen.filePaths[0]);
  });
  workspace('exportClip', async (id, planId, confirmed, transcript) => {
    const s = projects.require(id),
      item = s.exports().find((e) => e.plan.id === planId);
    if (!item) throw new Error('Make a new export plan.');
    const name =
      Array.from(item.plan.name)
        .filter((c) => c.charCodeAt(0) >= 32)
        .join('')
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/[. ]+$/g, '')
        .slice(0, 160) || 'Clip';
    const chosen = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export a verified clip',
      defaultPath: path.join(s.data.project.destination, name + '.' + item.plan.container),
      filters: [{ name: item.plan.container.toUpperCase(), extensions: [item.plan.container] }],
    });
    return chosen.canceled || !chosen.filePath
      ? null
      : projects.startExport(id, planId, chosen.filePath, confirmed, transcript);
  });
  workspace('revealExport', async (id, exportId, kind) =>
    shell.showItemInFolder(await projects.exportLocation(id, exportId, kind)),
  );
  workspace('close', () => projects.close());
  workspace('finish-close', async () => {
    await projects.close();
    closing = true;
    mainWindow?.close();
  });
  workspace('create', async (name) => {
    if (typeof name !== 'string' || !name.trim() || name.length > 200)
      throw new Error('Give the project a name.');
    const chosen = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save the new Virtual Cut project',
      defaultPath: name.replace(/[<>:"/\\|?*]/g, '_') + '.vcut',
      filters: [{ name: 'Virtual Cut project', extensions: ['vcut'] }],
    });
    if (chosen.canceled || !chosen.filePath) return null;
    const root = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose the root folder for finished videos (Review assigns subfolders)',
      properties: ['openDirectory'],
    });
    if (root.canceled || !root.filePaths[0]) return null;
    const cache = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose a folder for disposable previews',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (cache.canceled || !cache.filePaths[0]) return null;
    return projects.open(chosen.filePath, {
      name: name.trim(),
      destination: root.filePaths[0],
      cache: path.join(
        cache.filePaths[0],
        'Virtual Cut previews',
        path.parse(chosen.filePath).name,
      ),
    });
  });
  workspace('open', async (id) => {
    let file: string | undefined;
    if (id) {
      file = (await projects.recent()).find((x) => x.id === id)?.file;
      if (!file) throw new Error('Choose the project file again.');
    } else {
      const r = await dialog.showOpenDialog(mainWindow!, {
        title: 'Open a Virtual Cut project',
        properties: ['openFile'],
        filters: [{ name: 'Virtual Cut project', extensions: ['vcut'] }],
      });
      if (r.canceled) return null;
      file = r.filePaths[0];
    }
    if (!file) return null;
    lastProjectFile = file;
    return projects.open(file);
  });
  workspace('recover', async () => {
    const previous = lastProjectFile || projects.store?.file;
    const selected = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose a project checkpoint to recover',
      defaultPath: previous ? previous + '.saves' : undefined,
      properties: ['openFile'],
      filters: [{ name: 'Virtual Cut checkpoint', extensions: ['vcut'] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const saved = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save recovered project as a new file',
      defaultPath: previous
        ? path.join(path.dirname(previous), path.parse(previous).name + '-recovered.vcut')
        : 'Recovered project.vcut',
      filters: [{ name: 'Virtual Cut project', extensions: ['vcut'] }],
    });
    if (saved.canceled || !saved.filePath) return null;
    if (existsSync(saved.filePath))
      throw new Error(
        'Recovery needs a new filename. Existing projects and saves are never overwritten.',
      );
    await recoverProjectCopy(selected.filePaths[0], saved.filePath);
    lastProjectFile = saved.filePath;
    return projects.open(saved.filePath);
  });
  workspace('import', async (id, batchId, kind, audio) => {
    projects.require(id);
    if (!['files', 'folder'].includes(kind)) throw new Error('Choose files or a folder.');
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: kind === 'folder' ? 'Import a recording folder' : 'Import completed recordings',
      properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
      filters:
        kind === 'files' ? [{ name: 'Video files', extensions: videoExtensions }] : undefined,
    });
    if (r.canceled) return null;
    projects.require(id);
    return projects.importFiles(
      id,
      batchId,
      kind === 'folder' ? await projects.gather(r.filePaths[0]) : r.filePaths,
      audio,
    );
  });
  workspace('stageDrop', (id, batchId, entries) => {
    const s = projects.require(id);
    if (!s.data.batches.some((b) => b.id === batchId)) throw new Error('Choose a batch first.');
    return droppedImports.stage(id, batchId, entries);
  });
  workspace('discardDrop', (token) => droppedImports.discard(token));
  workspace('importDrop', (id, batchId, token, audio) => {
    const s = projects.require(id);
    if (!s.data.batches.some((b) => b.id === batchId)) throw new Error('Choose a batch first.');
    return projects.importFiles(id, batchId, droppedImports.take(id, batchId, token), audio);
  });
  workspace('relink', async (id, sourceId) => {
    projects.require(id);
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: 'Locate the original recording',
      properties: ['openFile'],
      filters: [{ name: 'Video files', extensions: videoExtensions }],
    });
    return r.canceled ? null : projects.relink(id, sourceId, r.filePaths[0]);
  });
  ipcMain.handle('window:toggle-fullscreen', (event): boolean => {
    assertTrustedSender(event);
    const enabled = !mainWindow!.isFullScreen();
    mainWindow!.setFullScreen(enabled);
    if (backgroundTest) mainWindow!.hide();
    return enabled;
  });
  ipcMain.handle('media:open-video', async (event): Promise<OpenedVideo | null> => {
    assertTrustedSender(event);
    videoDialog ??= (async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Open a video',
        buttonLabel: 'Open video',
        properties: ['openFile'],
        filters: [{ name: 'Video files', extensions: videoExtensions }],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return videoAccess.select(result.filePaths[0]);
    })();
    try {
      return await videoDialog;
    } finally {
      videoDialog = null;
    }
  });
  ipcMain.handle('app:get-info', (event): AppInfo => {
    assertTrustedSender(event);
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      isPackaged: app.isPackaged,
    };
  });

  ipcMain.handle('project:select-folder', async (event): Promise<ProjectFolder | null> => {
    assertTrustedSender(event);
    const parent = mainWindow!;
    // Repeated clicks share one native dialog rather than opening a stack.
    folderDialog ??= (async () => {
      const result = await dialog.showOpenDialog(parent, {
        title: 'Choose your project video folder',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory'],
      });
      const selectedPath = result.filePaths[0];
      return result.canceled || !selectedPath
        ? null
        : { name: path.basename(selectedPath) || selectedPath, path: selectedPath };
    })();
    try {
      return await folderDialog;
    } finally {
      folderDialog = null;
    }
  });
}

async function createWindow(): Promise<void> {
  const iconFile = path.join(
    __dirname,
    '..',
    !app.isPackaged && process.env.VIRTUAL_CUT_DEV_URL ? 'public' : 'dist',
    'icon.png',
  );
  const window = new BrowserWindow({
    title: 'Virtual Cut',
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#121716',
    show: false,
    autoHideMenuBar: true,
    icon: existsSync(iconFile) ? iconFile : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
      backgroundThrottling: !backgroundTest,
    },
  });
  mainWindow = window;
  observeWindow(window, 'main', diagnostics);
  window.on('close', (event) => {
    if (!closing && projects.store) {
      event.preventDefault();
      window.webContents.send('workspace:closing');
    }
  });
  window.once('ready-to-show', () => {
    if (!backgroundTest) {
      window.maximize();
      window.show();
    }
  });
  window.on('closed', () => {
    transcriptWindow?.close();
    if (mainWindow === window) mainWindow = null;
    videoAccess.clear();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  await window.loadURL(getRendererUrl());
  // Explicitly showing the loaded window also covers Windows launches from a
  // hidden helper process. Only the helper's console should remain hidden.
  if (!backgroundTest && !window.isDestroyed() && !window.isVisible()) window.show();
}

app
  .whenReady()
  .then(async () => {
    diagnostics = new Diagnostics(app.getPath('userData'));
    diagnostics.beginSession();
    await diagnostics.pruneCrashDumps();
    diagnostics.record('crash-capture', { enabled: crashCapture, uploadToServer: false });
    diagnostics.record('session-start', {
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      packaged: app.isPackaged,
    });
    app.on('child-process-gone', (_event, details) =>
      diagnostics.record('child-gone', {
        reason: details.reason,
        exitCode: details.exitCode,
        processType: details.type,
      }),
    );
    process.on('uncaughtExceptionMonitor', (e) => {
      diagnostics.fatal(e);
    });
    nativeTheme.themeSource = 'dark';
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    if (!process.env.VIRTUAL_CUT_DEV_URL || app.isPackaged) await registerAppProtocol();
    projects = new ProjectService(
      app.getPath('userData'),
      path.join(process.resourcesPath, 'tools'),
      diagnostics,
    );
    projects.logToolVersions().catch((e: unknown) => console.error(e));
    // Change notifications replace renderer polling (VC-98): at most one every 250 ms,
    // always followed by a trailing one so the final state is never missed.
    let changeTimer: ReturnType<typeof setTimeout> | undefined,
      changePending = false;
    const announce = () => {
      changeTimer = undefined;
      if (!changePending) return;
      changePending = false;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workspace:changed');
      changeTimer = setTimeout(announce, 250);
    };
    projects.onChange = () => {
      changePending = true;
      if (!changeTimer) announce();
    };
    transcriptWindow = registerTranscriptWindow(
      projects,
      () => mainWindow,
      getRendererUrl,
      app.getPath('userData'),
      backgroundTest,
      diagnostics,
    );
    await demoMedia
      .load(path.join(app.getAppPath(), 'demo-media.local.json'))
      .catch((error: unknown) => {
        console.error('Demo media is unavailable:', error);
      });
    protocol.handle('media', (request) =>
      request.url.startsWith('media://video/demo/')
        ? demoMedia.respond(request)
        : projects.respond(request) || videoAccess.respond(request),
    );
    registerDesktopApi();
    await createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0)
        createWindow().catch((e: unknown) => diagnostics.fatal(e));
    });
  })
  .catch((error: unknown) => {
    console.error(error);
    dialog.showErrorBox(
      'Virtual Cut could not start',
      error instanceof Error ? error.message : 'Unexpected startup error.',
    );
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
let logsFlushed = false;
let shutdownStarted = false;
app.on('will-quit', () => diagnostics?.endSession());
app.on('before-quit', (event) => {
  if (logsFlushed) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  // Finish owned partial-install cleanup before Electron terminates its native process.
  Promise.allSettled([transcriptWindow?.stopSetup()])
    .then(() =>
      Promise.race([diagnostics?.flush(), new Promise((resolve) => setTimeout(resolve, 700))]),
    )
    // Quitting must not wait on, or be blocked by, a failed final log flush.
    .catch(() => {})
    .finally(() => {
      logsFlushed = true;
      app.quit();
    });
});
