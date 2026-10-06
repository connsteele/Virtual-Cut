import { app, clipboard, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { Socket } from 'node:net';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod';
import { AgentAccess } from './agent-access.cjs';
import type { ProjectService } from './project-service.cjs';
import type { AgentClient, AgentPairing, AgentView } from './agent-contracts.js' with {
  'resolution-mode': 'import',
};
import {
  AgentReadError,
  annotations,
  contextPacket,
  currentView,
  projectSummary,
  transcriptLines,
  type AgentReadSource,
} from './agent-tools.js';
const instructions =
  'Virtual Cut prepares game footage for YouTube. These tools read the project that is open in ' +
  'Virtual Cut right now: what is on screen, batches with their game and brief, the context ' +
  'packet, transcript lines between two times, and existing markers, clips, notes and cue ' +
  'decisions. Times are seconds in the recording. Access is read-only: nothing can be changed, ' +
  'imported, exported or filed through these tools, and they never return file paths or media.';

/**
 * Agent access (VC-159/VC-160): pairing and activity IPC for the main window, and a read-only
 * MCP server for each paired connection on the per-user pipe.
 */
export function registerAgentAccess(options: {
  userData: string;
  projects: () => ProjectService | undefined;
  mainWindow: () => BrowserWindow | null;
  trusted: (event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>) => void;
}) {
  const access = new AgentAccess(options.userData);
  access.onChange = () => {
    const window = options.mainWindow();
    if (window && !window.isDestroyed()) window.webContents.send('agent:changed');
  };
  access.serve = (socket, client) => serve(socket, client);

  function source(client: AgentClient): AgentReadSource {
    const store = options.projects()?.store;
    if (!store) throw new Refused('No project is open in Virtual Cut. Ask the user to open one.');
    if (store.data.project.id !== client.projectId)
      throw new Refused(
        `This agent app is paired with the project "${client.projectName}", which is not open. ` +
          'Ask the user to open it, or to pair this app with the open project.',
      );
    const fingerprints: Record<string, string> = {};
    for (const s of store.sources()) fingerprints[s.id] = s.fingerprint;
    return {
      project: { id: store.data.project.id, name: store.data.project.name },
      batches: store.data.batches,
      activeBatchId: store.data.activeBatchId,
      revision: store.data.revision,
      model: store.data.model,
      fingerprints,
      transcripts: store.transcripts,
      view: access.view,
    };
  }

  function serve(socket: Socket, client: AgentClient) {
    const server = new McpServer(
      { name: 'virtual-cut', version: app.getVersion() },
      { instructions },
    );
    const read = <A,>(
      name: string,
      description: string,
      input: z.ZodObject,
      run: (s: AgentReadSource, args: A) => unknown,
      summary: (args: A) => string,
    ) =>
      server.registerTool(
        name,
        { description, inputSchema: input, annotations: { readOnlyHint: true } },
        async (args: unknown) => {
          const a = args as A;
          if (!access.isPaired(client.id)) {
            socket.destroy();
            return failure('This pairing was revoked in Virtual Cut.');
          }
          try {
            const result = run(source(client), a);
            access.record(client, name, summary(a), 'read');
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 1) }] };
          } catch (e) {
            const known = e instanceof Refused || e instanceof AgentReadError;
            access.record(client, name, summary(a), 'refused');
            return failure(known ? (e as Error).message : 'Virtual Cut could not read that.');
          }
        },
      );
    const batch = z
      .string()
      .max(200)
      .optional()
      .describe('Batch id from get_project_summary; the active batch when omitted.');
    read(
      'get_current_view',
      "What is on Virtual Cut's screen: the open project, page, batch, recording, playhead and selected clip or marker.",
      z.object({}),
      (s) => currentView(s),
      () => 'Current view',
    );
    read<{ batch_id?: string }>(
      'get_project_summary',
      'The open project and its batches. With batch_id: that batch, its game and brief, recordings (with which transcripts exist) and clips.',
      z.object({ batch_id: batch }),
      (s, a) => projectSummary(s, a.batch_id),
      (a) => (a.batch_id ? `Batch summary ${a.batch_id}` : 'Project summary'),
    );
    read<{ batch_id?: string }>(
      'get_context',
      "A batch's context packet: game and vocabulary, the brief (situational context, not a narrative to fit), glossary and what is already marked, with a revision id.",
      z.object({ batch_id: batch }),
      (s, a) => contextPacket(s, a.batch_id),
      (a) => `Context packet ${a.batch_id || '(active batch)'}`,
    );
    read<{
      recording_id: string;
      role: 'mic' | 'game';
      start_seconds?: number;
      end_seconds?: number;
      cursor?: string;
    }>(
      'get_transcript',
      "Transcript lines of one recording's microphone (the creator's spoken notes) or game audio between two times, 100 lines per page with corrections applied. Pass next_cursor to continue.",
      z.object({
        recording_id: z.string().max(200),
        role: z.enum(['mic', 'game']),
        start_seconds: z.number().min(0).optional(),
        end_seconds: z.number().positive().optional(),
        cursor: z.string().max(40).optional(),
      }),
      (s, a) =>
        transcriptLines(s, {
          recordingId: a.recording_id,
          role: a.role,
          start: a.start_seconds,
          end: a.end_seconds,
          cursor: a.cursor,
        }),
      (a) =>
        `${a.role === 'mic' ? 'Mic' : 'Game'} transcript of ${a.recording_id}, ` +
        `${clock(a.start_seconds ?? 0)}–${a.end_seconds === undefined ? 'end' : clock(a.end_seconds)}` +
        (a.cursor ? ' (next page)' : ''),
    );
    read<{ batch_id?: string; recording_id?: string }>(
      'get_annotations',
      'Existing markers, clips, notes and spoken-cue decisions for a batch, or for one of its recordings.',
      z.object({
        batch_id: batch,
        recording_id: z.string().max(200).optional().describe('Limit to one recording.'),
      }),
      (s, a) => annotations(s, a.batch_id, a.recording_id),
      (a) => `Annotations ${a.recording_id || a.batch_id || '(active batch)'}`,
    );
    const transport = new StdioServerTransport(socket, socket);
    void server.connect(transport).catch(() => socket.destroy());
    return () => void server.close().catch(() => {});
  }

  ipcMain.handle('agent:state', (event) => {
    options.trusted(event);
    return access.state();
  });
  ipcMain.handle('agent:setEnabled', (event, enabled: unknown) => {
    options.trusted(event);
    return access.setEnabled(enabled === true);
  });
  ipcMain.handle('agent:pair', async (event, projectId: unknown, name: unknown) => {
    options.trusted(event);
    const store = options.projects()?.store;
    if (!store || store.data.project.id !== projectId)
      throw new Error('Open the project this agent app should read, then pair it.');
    if (typeof name !== 'string') throw new Error('Name the agent app.');
    const { client, token } = await access.pair(store.data.project, name);
    // The relay runs as plain Node from this executable; `--mcp` works too, but Electron's
    // start-up writes a blank line to stdout on Windows, which some MCP clients log as an error.
    const args = [
      path.join(__dirname, 'mcp-relay.cjs'),
      `--pipe=${access.pipe}`,
      `--pair=${token}`,
    ];
    const quote = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
    const pairing: AgentPairing = {
      client,
      token,
      claudeCode: `claude mcp add --scope user -e ELECTRON_RUN_AS_NODE=1 virtual-cut -- ${[process.execPath, ...args].map(quote).join(' ')}`,
      claudeDesktop: JSON.stringify(
        {
          mcpServers: {
            'virtual-cut': { command: process.execPath, args, env: { ELECTRON_RUN_AS_NODE: '1' } },
          },
        },
        null,
        2,
      ),
    };
    return pairing;
  });
  ipcMain.handle('agent:revoke', (event, clientId: unknown) => {
    options.trusted(event);
    return access.revoke(String(clientId));
  });
  ipcMain.handle('agent:copy', async (event, text: unknown) => {
    options.trusted(event);
    if (typeof text !== 'string' || text.length > 8000) throw new Error('Nothing to copy.');
    await clipboard.writeText(text);
  });
  ipcMain.on('agent:view', (event, value: unknown) => {
    try {
      options.trusted(event);
    } catch {
      return;
    }
    const v = value as Partial<AgentView> | null;
    if (!v || typeof v.projectId !== 'string' || typeof v.page !== 'string') return;
    const text = (x: unknown) => (typeof x === 'string' && x.length <= 200 ? x : undefined);
    access.view = {
      projectId: v.projectId,
      page: v.page.slice(0, 40),
      recordingId: text(v.recordingId),
      playhead:
        typeof v.playhead === 'number' && Number.isFinite(v.playhead) ? v.playhead : undefined,
      clipId: text(v.clipId),
      markerId: text(v.markerId),
    };
  });
  return access;
}

class Refused extends Error {}
function failure(text: string) {
  return { isError: true, content: [{ type: 'text' as const, text }] };
}
function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
