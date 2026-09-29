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
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppInfo, OpenedVideo, ProjectFolder } from './contracts.js' with {
  'resolution-mode': 'import',
};
import { VideoAccess, videoExtensions } from './media.cjs';
import { DemoMedia } from './demo-media.cjs';
import { ProjectService } from './project-service.cjs';
import type { ProjectApi } from './project-contracts.js' with { 'resolution-mode': 'import' };

const APP_URL = 'app://virtual-cut/';
const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: media://video; font-src 'self' data:; connect-src 'self'; media-src 'self' media://video; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'";
let mainWindow: BrowserWindow | null = null;
let folderDialog: Promise<ProjectFolder | null> | null = null;
let videoDialog: Promise<OpenedVideo | null> | null = null;
const videoAccess = new VideoAccess();
const demoMedia = new DemoMedia();
let projects: ProjectService;
let closing = false;

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

function assertTrustedSender(event: IpcMainInvokeEvent): void {
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
  type Calls = Omit<ProjectApi, 'onCloseRequested' | 'finishClose' | 'selectBatch'> & {
    'finish-close': ProjectApi['finishClose'];
    'select-batch': ProjectApi['selectBatch'];
  };
  let request: Promise<unknown> = Promise.resolve();
  const workspace = <K extends keyof Calls>(
    name: K,
    fn: (...args: Parameters<Calls[K]>) => unknown,
  ) => {
    ipcMain.handle('workspace:' + name, (event, ...args: unknown[]) => {
      assertTrustedSender(event);
      const next = request.then(() => fn(...(args as Parameters<Calls[K]>)));
      request = next.catch(() => {});
      return next;
    });
  };
  workspace('recent', () => projects.recent());
  workspace('current', () => (projects.store ? projects.snapshot() : null));
  workspace('save', (id, before, after) => projects.save(id, before, after));
  workspace('checkpoint', (id) => projects.checkpoint(id));
  workspace('restore', (id, saveId) => projects.restore(id, saveId));
  workspace('history', (id, direction) => projects.history(id, direction));
  workspace('batch', (id, name) => projects.batch(id, name));
  workspace('select-batch', (id, batchId) => projects.selectBatch(id, batchId));
  workspace('audio', (id, sourceId) => projects.prepareAudio(id, sourceId));
  workspace('job', (id, jobId, action) => projects.job(id, jobId, action));
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
      title: 'Choose the destination footage folder',
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
    return file ? projects.open(file) : null;
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
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
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
