import { BrowserWindow, dialog, ipcMain, screen } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProjectService } from './project-service.cjs';
import { applyTranscriptCommand } from './transcript-edits.js';
import { transcriptHandoff, transcriptSrt } from './transcript-export.js';
import type { TranscriptApi, TranscriptCommand } from './transcript-contracts.js' with {
  'resolution-mode': 'import',
};

export function registerTranscriptWindow(
  projects: ProjectService,
  main: () => BrowserWindow | null,
  rendererUrl: () => string,
  profile: string,
  hidden: boolean,
) {
  let window: BrowserWindow | null = null;
  let preferredSource = '';
  let lastPosition = 0;
  const pending = new Map<
    string,
    {
      command: TranscriptCommand;
      resolve: () => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      applied: boolean;
    }
  >();
  const boundsFile = path.join(profile, 'transcript-window.json');
  function trusted(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>, mainOnly = false) {
    if (
      (!main() || event.sender !== main()!.webContents) &&
      (mainOnly || !window || event.sender !== window.webContents)
    )
      throw new Error('Transcript request rejected.');
    if (
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url.split('#')[0] !== rendererUrl()
    )
      throw new Error('Unexpected transcript page.');
  }
  function handle<K extends keyof TranscriptApi>(
    name: K,
    fn: (...args: Parameters<TranscriptApi[K]>) => ReturnType<TranscriptApi[K]>,
    mainOnly = false,
  ) {
    ipcMain.handle(`transcript:${name}`, (event, ...args) => {
      trusted(event, mainOnly);
      return fn(...(args as Parameters<TranscriptApi[K]>));
    });
  }
  handle(
    'open',
    async (sourceId) => {
      preferredSource = sourceId || projects.store?.data.model.selectedRecordingId || '';
      if (window) {
        window.webContents.send('transcript:source-event', preferredSource);
        window.show();
        window.focus();
        return;
      }
      let bounds: { x?: number; y?: number; width: number; height: number } = {
        width: 760,
        height: 850,
      };
      try {
        const saved = JSON.parse(readFileSync(boundsFile, 'utf8'));
        if (!['x', 'y', 'width', 'height'].every((key) => Number.isFinite(saved[key])))
          throw new Error('Invalid saved bounds.');
        const display = screen
          .getAllDisplays()
          .find(
            (d) =>
              saved.x < d.workArea.x + d.workArea.width &&
              saved.x + 200 > d.workArea.x &&
              saved.y < d.workArea.y + d.workArea.height &&
              saved.y + 100 > d.workArea.y,
          );
        if (display)
          bounds = {
            x: Math.max(
              display.workArea.x,
              Math.min(saved.x, display.workArea.x + display.workArea.width - 300),
            ),
            y: Math.max(
              display.workArea.y,
              Math.min(saved.y, display.workArea.y + display.workArea.height - 150),
            ),
            width: Math.min(Math.max(500, saved.width), display.workArea.width),
            height: Math.min(Math.max(400, saved.height), display.workArea.height),
          };
      } catch {
        /* Safe default for first use or removed display. */
      }
      window = new BrowserWindow({
        ...bounds,
        minWidth: 500,
        minHeight: 400,
        title: 'Transcript · Virtual Cut',
        show: !hidden,
        backgroundColor: '#101918',
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (e) => e.preventDefault());
      window.on('close', () => {
        if (window) writeFileSync(boundsFile, JSON.stringify(window.getBounds()));
        for (const p of pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error('Transcript window closed.'));
        }
        pending.clear();
      });
      window.on('closed', () => {
        window = null;
      });
      await window.loadURL(rendererUrl() + '#transcript');
    },
    true,
  );
  handle('session', async (sourceId) => projects.transcriptSession(sourceId || preferredSource));
  handle('page', async (id, transcriptId, page, search) => {
    const s = projects.require(id);
    if (typeof search !== 'string' || search.length > 300)
      throw new Error('Invalid transcript search.');
    const matches = (s.data.model.transcriptEdits || [])
      .filter(
        (e) =>
          e.transcriptId === transcriptId &&
          e.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
      )
      .map((e) => e.segmentId);
    return s.transcripts.page(transcriptId, page, search, matches);
  });
  handle('runtime', async () => ({
    configured: projects.transcription.configured,
    settings: projects.transcription.settings,
  }));
  handle('configure', async (part, device) => {
    if (!['python', 'libraries', 'model', 'device'].includes(part))
      throw new Error('Unknown speech setting.');
    if (part === 'device') projects.transcription.configure('device', device || 'cpu');
    else {
      const result = await dialog.showOpenDialog(window || main()!, {
        title: {
          python: 'Choose Python 3.12 executable',
          libraries: 'Choose the folder containing faster_whisper',
          model: 'Choose the model folder containing model.bin',
        }[part],
        properties: [part === 'python' ? 'openFile' : 'openDirectory'],
        ...(part === 'python'
          ? { filters: [{ name: 'Python executable', extensions: ['exe'] }] }
          : {}),
      });
      if (!result.canceled && result.filePaths[0])
        projects.transcription.configure(part, result.filePaths[0]);
    }
  });
  handle('start', async (id, sourceId, batchId, options) => {
    projects.requestTranscription(id, sourceId, batchId, options);
  });
  handle('job', async (id, jobId, action) => {
    const job = projects
      .require(id)
      .jobs()
      .find((j) => j.id === jobId);
    if (!job || job.kind !== 'transcribe' || !['cancel', 'retry', 'pause'].includes(action))
      throw new Error('Choose a transcription job.');
    if (action === 'pause') await projects.pauseTranscription(id, jobId);
    else await projects.job(id, jobId, action);
  });
  handle('seek', async (id, sourceId, time) => {
    const r = projects.require(id).data.model.recordings.find((r) => r.id === sourceId);
    if (!r || !Number.isFinite(time) || time < 0 || time > r.duration)
      throw new Error('This transcript location is unavailable.');
    main()?.webContents.send('transcript:seek-event', { projectId: id, sourceId, time });
  });
  handle(
    'command',
    (command) =>
      new Promise<void>((resolve, reject) => {
        projects.require(command.projectId);
        if (pending.size) throw new Error('Wait for the previous transcript edit to finish.');
        if (!main()) throw new Error('The main editor is closed.');
        const token = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(token);
          reject(new Error('The main editor did not accept this edit. Try again.'));
        }, 20000);
        pending.set(token, { command, resolve, reject, timer, applied: false });
        main()!.webContents.send('transcript:command-event', { token, command });
      }),
  );
  handle(
    'apply',
    async (token) => {
      const item = pending.get(token);
      if (!item || item.applied) throw new Error('This transcript edit has expired.');
      const c = item.command,
        s = projects.require(c.projectId),
        transcript = s.transcripts.get(c.transcriptId);
      const segment = c.action.endsWith('cue')
        ? s.transcripts.cueSegment(c.transcriptId, c.segmentId)
        : s.transcripts.segment(c.transcriptId, c.segmentId);
      const next = applyTranscriptCommand(s.data.model, transcript, segment, c, randomUUID);
      s.save(s.data.model, next);
      item.applied = true;
      return projects.snapshot();
    },
    true,
  );
  ipcMain.on('transcript:finishCommand', (event, token: string, error?: string) => {
    try {
      trusted(event, true);
    } catch {
      return;
    }
    const item = pending.get(token);
    if (!item) return;
    pending.delete(token);
    clearTimeout(item.timer);
    if (error || !item.applied) item.reject(new Error(error || 'Transcript edit was not applied.'));
    else item.resolve();
  });
  ipcMain.on('transcript:position', (event, projectId: string, sourceId: string, time: number) => {
    try {
      trusted(event, true);
    } catch {
      return;
    }
    if (
      !window ||
      projects.store?.data.project.id !== projectId ||
      !Number.isFinite(time) ||
      Date.now() - lastPosition < 120
    )
      return;
    lastPosition = Date.now();
    window.webContents.send('transcript:position-event', { projectId, sourceId, time });
  });
  handle('export', async (id, transcriptId, format, exportId) => {
    if (!['srt', 'json'].includes(format)) throw new Error('Choose SRT or JSON.');
    const s = projects.require(id),
      transcript = s.transcripts.get(transcriptId);
    if (transcript.state !== 'complete') throw new Error('Wait for a complete transcript.');
    const source = s.data.model.recordings.find((r) => r.id === transcript.sourceId);
    const exported = exportId
      ? s
          .exports()
          .find(
            (e) =>
              e.plan.id === exportId &&
              e.plan.sourceId === transcript.sourceId &&
              e.state === 'verified',
          )
      : undefined;
    if (!source || (exportId && !exported?.verification))
      throw new Error('Choose an available source or verified export.');
    const scope = exported?.verification
      ? {
          ...exported.verification.actual,
          sourceStart: exported.input.sourceStart,
          timestampShift: exported.verification.timestampShift,
          exportId: exported.plan.id,
          output: exported.output,
          name: exported.plan.name,
        }
      : {
          start: 0,
          end: source.duration,
          sourceStart: source.sourceStart || 0,
          timestampShift: 0,
          name: source.title,
        };
    const chosen = await dialog.showSaveDialog(window || main()!, {
      title: 'Export source transcript',
      defaultPath: path.join(s.data.project.destination, `transcript-${transcript.role}.${format}`),
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (chosen.canceled || !chosen.filePath) return null;
    projects.require(id);
    if (
      path.extname(chosen.filePath).toLowerCase() !== `.${format}` ||
      /\.vcut\.json$/i.test(chosen.filePath)
    )
      throw new Error(
        'Use a separate .srt or .json transcript filename. Video companions are preserved.',
      );
    const handoff = transcriptHandoff(
      transcript,
      s.transcripts.segments(transcriptId),
      s.data.model,
      scope,
    );
    const body = format === 'json' ? JSON.stringify(handoff, null, 2) : transcriptSrt(handoff);
    await writeFile(chosen.filePath, body, 'utf8');
    return chosen.filePath;
  });
  return { close: () => window?.close() };
}
