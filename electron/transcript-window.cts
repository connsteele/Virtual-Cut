import { BrowserWindow, dialog, ipcMain, screen, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Diagnostics, failureFields } from './diagnostics.cjs';
import { observeWindow } from './window-diagnostics.cjs';
import { SpeechSetup } from './speech-setup.cjs';
import type { ProjectService } from './project-service.cjs';
import { applyTranscriptCommand } from './transcript-edits.js';
import { transcriptHandoff, transcriptSrt, transcriptSaveSuggestion } from './transcript-export.js';
import type { TranscriptApi, TranscriptCommand } from './transcript-contracts.js' with {
  'resolution-mode': 'import',
};

export function registerTranscriptWindow(
  projects: ProjectService,
  main: () => BrowserWindow | null,
  rendererUrl: () => string,
  profile: string,
  hidden: boolean,
  diagnostics: Diagnostics,
) {
  const speechSetup = new SpeechSetup(profile, projects.transcription, (operation, error) =>
    diagnostics.record(
      error ? 'operation-failed' : operation === 'install' ? 'operation-start' : 'operation-end',
      { kind: 'speechSetup', operation, ...(error ? failureFields(error) : {}) },
    ),
  );
  let window: BrowserWindow | null = null;
  let preferredSource = '';
  let lastPosition = 0;
  let pendingPosition: { projectId: string; sourceId: string; time: number } | undefined;
  let positionTimer: ReturnType<typeof setTimeout> | undefined;
  let viewStore: ProjectService['store'] = null;
  let viewSessionId = randomUUID();
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
    ipcMain.handle(`transcript:${name}`, async (event, ...args) => {
      trusted(event, mainOnly);
      // Capture user intent, not contents or high-frequency position/poll traffic.
      const fields = {
        window: event.sender === main()?.webContents ? 'main' : 'transcript',
        operation: name,
      };
      if (
        !['session', 'page', 'pageAt', 'runtime'].includes(name) &&
        !(name === 'speechSetup' && args[0] === 'status')
      )
        diagnostics.record('transcript-action', fields);
      try {
        return await fn(...(args as Parameters<TranscriptApi[K]>));
      } catch (error) {
        diagnostics.record('transcript-action-failed', { ...fields, ...failureFields(error) });
        throw error;
      }
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
        title: 'Transcription · Virtual Cut',
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
      observeWindow(window, 'transcript', diagnostics);
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
  handle('session', async (sourceId) => {
    if (projects.store !== viewStore) {
      viewStore = projects.store;
      viewSessionId = randomUUID();
    }
    const session = projects.transcriptSession(sourceId || preferredSource);
    return session ? { ...session, viewSessionId } : null;
  });
  handle('pageAt', async (id, transcriptId, time) =>
    projects.require(id).transcripts.pageAt(transcriptId, time),
  );
  handle('transport', async (id, sourceId, key) => {
    if (
      !['j', 'k', 'l'].includes(key) ||
      !projects.require(id).data.model.recordings.some((r) => r.id === sourceId)
    )
      throw new Error('This transcript recording is unavailable.');
    main()?.webContents.send('transcript:transport-event', { projectId: id, sourceId, key });
  });
  handle('page', async (id, transcriptId, page, search, filter = 'all') => {
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
    return s.transcripts.page(transcriptId, page, search, matches, s.data.model, filter);
  });
  handle('runtime', async (refresh) => {
    if (refresh != null && typeof refresh !== 'boolean') throw new Error('Invalid GPU check.');
    return {
      configured: projects.transcription.configured,
      removed: projects.transcription.removed,
      settings: projects.transcription.settings,
      gpu: await projects.transcription.inspectGpu(refresh),
    };
  });
  handle('speechSetup', async (action, includeGpu) => {
    if (
      ![
        'plan',
        'start',
        'status',
        'cancel',
        'activate',
        'restore',
        'reveal-current',
        'reveal-other',
        'remove-other',
      ].includes(action) ||
      (includeGpu != null && typeof includeGpu !== 'boolean')
    )
      throw new Error('Unknown speech setup action.');
    if (
      ['plan', 'start', 'activate', 'restore', 'remove-other'].includes(action) &&
      projects.store
        ?.jobs()
        .some((j) => j.kind === 'transcribe' && ['queued', 'running'].includes(j.state))
    )
      throw new Error('Pause or finish transcription before changing its local runtime.');
    if (action === 'status') return speechSetup.status();
    if (action === 'reveal-current' || action === 'reveal-other') {
      // Only the two known runtime folders can be opened, never a renderer-supplied path.
      const state = await speechSetup.status();
      const location = action === 'reveal-current' ? state.current : state.other;
      if (!location || (await shell.openPath(location.folder)))
        throw new Error('That setup folder is not available.');
      return state;
    }
    if (action === 'cancel') return speechSetup.cancel();
    if (action === 'activate') return speechSetup.activate();
    if (action === 'restore') return speechSetup.restore();
    if (action === 'remove-other') return speechSetup.removeOther();
    if (action === 'start') return speechSetup.start();
    const start = await speechSetup.suggestedFolder();
    // The suggested per-user folder may not exist yet; the picker opens inside it.
    await mkdir(start, { recursive: true }).catch(() => {});
    const result = await dialog.showOpenDialog(window || main()!, {
      title: 'Choose storage for local speech software and model',
      defaultPath: start,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled || !result.filePaths[0]
      ? speechSetup.status()
      : speechSetup.plan(result.filePaths[0], includeGpu ?? true);
  });
  handle('setupHelp', async (topic) => {
    const links: Record<string, string> = {
      engine: 'https://github.com/SYSTRAN/faster-whisper#installation',
      gpu: 'https://github.com/SYSTRAN/faster-whisper#gpu',
      python: 'https://www.python.org/downloads/windows/',
      model: 'https://huggingface.co/Systran/faster-whisper-large-v3',
    };
    if (typeof topic !== 'string' || !Object.hasOwn(links, topic))
      throw new Error('Unknown setup guide.');
    await shell.openExternal(links[topic]);
  });
  handle('configure', async (part, device) => {
    if (
      projects.store
        ?.jobs()
        .some((j) => j.kind === 'transcribe' && ['queued', 'running'].includes(j.state))
    )
      throw new Error('Pause or finish transcription before changing its local runtime.');
    if (!['python', 'libraries', 'model', 'gpuLibraries', 'device'].includes(part))
      throw new Error('Unknown speech setting.');
    if (part === 'device') projects.transcription.configure('device', device || 'cpu');
    else {
      await speechSetup.beforeOwnInstallation();
      const result = await dialog.showOpenDialog(window || main()!, {
        title: {
          python: 'Choose Python 3.12 executable',
          libraries: 'Choose the folder containing faster_whisper',
          model: 'Choose the model folder containing model.bin',
          gpuLibraries: 'Choose the NVIDIA runtime folder',
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
        ? s.transcripts.cueSegment(c.transcriptId, c.segmentId, s.data.model)
        : s.transcripts.segment(c.transcriptId, c.segmentId);
      const partner =
        c.partnerSegmentId == null
          ? undefined
          : s.transcripts.cueSegment(c.transcriptId, c.partnerSegmentId, s.data.model);
      if (
        c.action === 'accept-cue' &&
        partner &&
        (segment.cuePartner?.id !== partner.id || partner.cuePartner?.id !== segment.id)
      )
        throw new Error(
          'These clip boundaries are ambiguous. Correct the cue wording or create the clip in Cut.',
        );
      const next = applyTranscriptCommand(
        s.data.model,
        transcript,
        segment,
        c,
        randomUUID,
        partner,
      );
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
    if (!window || projects.store?.data.project.id !== projectId || !Number.isFinite(time)) return;
    // At most one update per 120 ms, but the latest position is always delivered, so a
    // pause or seek right after playback never leaves the transcript on a stale page.
    pendingPosition = { projectId, sourceId, time };
    if (positionTimer) return;
    const wait = Math.max(0, lastPosition + 120 - Date.now());
    positionTimer = setTimeout(() => {
      positionTimer = undefined;
      if (
        !pendingPosition ||
        !window ||
        projects.store?.data.project.id !== pendingPosition.projectId
      )
        return;
      lastPosition = Date.now();
      window.webContents.send('transcript:position-event', pendingPosition);
      pendingPosition = undefined;
    }, wait);
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
    const suggestion = transcriptSaveSuggestion(scope, transcript.role, format);
    const chosen = await dialog.showSaveDialog(window || main()!, {
      title: suggestion.title,
      defaultPath: path.join(s.data.project.destination, suggestion.filename),
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
  return {
    stopSetup: () => speechSetup.cancel(),
    close: () => {
      speechSetup.cancel().catch(() => {});
      window?.close();
    },
  };
}
