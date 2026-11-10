import { app, clipboard, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { Socket } from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod';
import { AgentAccess, PicturesOff } from './agent-access.cjs';
import type { ProjectService } from './project-service.cjs';
import type { AgentClient, AgentPairing, AgentView } from './agent-contracts.js' with {
  'resolution-mode': 'import',
};
import {
  AgentReadError,
  annotations,
  batchRecordAnswer,
  currentTranscripts,
  readableName,
  contextPacket,
  currentView,
  projectSummary,
  screenAreas,
  screenTextLines,
  transcriptLines,
  visualEventLines,
  visualKinds,
  type AgentReadSource,
} from './agent-tools.js';
import {
  decisionsInput,
  prepareSubmission,
  prepareWithdrawal,
  proposalDecisions,
  submissionAnswer,
  submitInput,
  withdrawalAnswer,
  withdrawInput,
  type DecisionsInput,
  type SubmitInput,
  type WithdrawInput,
} from './agent-proposals.js';
import {
  amendAnswer,
  amendInput,
  changesAnswer,
  changesInput,
  prepareAmend,
  prepareChanges,
  type AmendInput,
  type ChangesInput,
} from './agent-changes.js';
import { proposalLimit } from './proposal-store.cjs';
import { intentGuideAnswer } from './intent-guide.js';
import { agentNotes, releaseOf, unreadNotice } from './release-notes.js';
import { look, lookRecording, type LookInput } from './look.cjs';
import { LookError, clock as lookClock } from './look-plan.js';
import { readFileSync, statSync } from 'node:fs';
const instructions =
  'Virtual Cut prepares game footage for YouTube. These tools read the project that is open in ' +
  'Virtual Cut right now: what is on screen, batches with their game and brief, the context ' +
  'packet, transcript lines between two times, where the picture goes black, freezes, cuts or ' +
  'fades between two times, the text the screen showed between two times, and existing ' +
  'markers, clips, notes and cue decisions. Times are ' +
  'seconds in the recording. You can also propose markers, notes, splits ' +
  'and clip ranges with submit_proposals: they wait on cue cards in the transcript window, ' +
  'nothing changes until the user accepts one, and get_proposal_decisions reads the outcome. ' +
  'withdraw_proposals takes back your own proposals the user has not decided yet, and ' +
  'amend_proposal revises one in place. propose_changes proposes edits to markers and clips ' +
  'already in the project (name, position, trim, color, clip color, note) as cards showing ' +
  'before and after. ' +
  "get_batch_record keeps a batch's first pass beside what the user exported, for learning " +
  'from the misses. ' +
  'Before proposing, read get_intent_guide: it says what their free mic speech means, what to ' +
  'propose when there is none, and how to turn it into proposals, with their own examples. ' +
  'Nothing can be changed directly, imported, exported or filed through these tools, and they ' +
  'never return file paths or media files. look shows pictures of moments in a recording, ' +
  'rendered by Virtual Cut, while the user has Allow pictures on. get_whats_new gives the ' +
  'release notes of each Virtual Cut version since this app last read them.';

/** The server instructions for one connection: unread notes first (VC-242). */
function connectionInstructions(current: string, from: string | undefined) {
  const unread = unreadNotice(current, from);
  return unread ? `${unread} ${instructions}` : instructions;
}

/**
 * Agent access (VC-159/VC-160): pairing and activity IPC for the main window, and a read-only
 * MCP server for each paired connection on the per-user pipe.
 */
export function registerAgentAccess(options: {
  userData: string;
  projects: () => ProjectService | undefined;
  mainWindow: () => BrowserWindow | null;
  trusted: (event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>) => void;
  log?: (event: string, details?: Record<string, unknown>) => void;
}) {
  const access = new AgentAccess(options.userData);
  access.log = options.log;
  access.onChange = () => {
    const window = options.mainWindow();
    if (window && !window.isDestroyed()) window.webContents.send('agent:changed');
  };
  access.serve = (socket, client) => serve(socket, client);
  access.version = releaseOf(app.getVersion());

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
      proposals: store.proposals,
      batchRecord: (batchId) =>
        options.projects()?.batchRecords.read(store.data.project.id, batchId),
      view: access.view,
      pictureEvents: (recordingId) => store.pictureEvents(recordingId, false),
      jobs: () => store.jobs(),
      screenText: (recordingId) => store.screenText(recordingId),
      screenTextEngine: () => options.projects()?.screenText.problem || '',
      taggedNotes: (recordingId) => {
        const file = store.sources().find((s) => s.id === recordingId)?.file;
        if (!file) return undefined;
        const notes = file.slice(0, file.length - path.extname(file).length) + '.txt';
        try {
          return statSync(notes).size <= 256 * 1024 ? readFileSync(notes, 'utf8') : undefined;
        } catch {
          return undefined;
        }
      },
    };
  }

  function serve(socket: Socket, client: AgentClient) {
    const server = new McpServer(
      { name: 'virtual-cut', version: app.getVersion() },
      { instructions: connectionInstructions(app.getVersion(), access.notesFrom(client.id)) },
    );
    const read = <A,>(
      name: string,
      description: string,
      input: z.ZodObject,
      run: (s: AgentReadSource, args: A) => unknown,
      summary: (args: A, name: (id: string) => string) => string,
      /** What a call that changes the review queue records in Activity. */
      writes?: 'proposed' | 'withdrew' | 'amended',
    ) =>
      server.registerTool(
        name,
        {
          description,
          inputSchema: input,
          // Proposals add review candidates and withdrawing takes back the agent's own: nothing
          // in the project is replaced, deleted or applied.
          annotations: writes
            ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
            : { readOnlyHint: true },
        },
        async (args: unknown) => {
          const a = args as A;
          if (!access.isPaired(client.id)) {
            socket.destroy();
            return failure('This pairing was revoked in Virtual Cut.');
          }
          let project: AgentReadSource | undefined;
          const label = (id: string) => readableName(project, id);
          try {
            project = source(client);
            const result = run(project, a);
            access.record(client, name, summary(a, label), writes ?? 'read');
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 1) }] };
          } catch (e) {
            const known =
              e instanceof Refused || e instanceof AgentReadError || e instanceof PicturesOff;
            access.record(client, name, summary(a, label), 'refused');
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
      (a, n) => (a.batch_id ? `Batch summary: ${n(a.batch_id)}` : 'Project summary'),
    );
    read<{ batch_id?: string }>(
      'get_context',
      "A batch's context packet: game and vocabulary, the brief (situational context, not a narrative to fit), glossary and what is already marked, with a revision id.",
      z.object({ batch_id: batch }),
      (s, a) => contextPacket(s, a.batch_id),
      (a, n) => `Context packet: ${a.batch_id ? n(a.batch_id) : 'active batch'}`,
    );
    read<{
      recording_id: string;
      role: 'mic' | 'game';
      start_seconds?: number;
      end_seconds?: number;
      cursor?: string;
    }>(
      'get_transcript',
      "Transcript lines of one recording's microphone (the creator's spoken notes) or game audio between two times, 100 lines per page with corrections applied. When more lines remain, the answer has next_cursor: pass that value as cursor to continue.",
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
      (a, n) =>
        `${a.role === 'mic' ? 'Mic' : 'Game'} transcript of ${n(a.recording_id)}, ` +
        `${clock(a.start_seconds ?? 0)}–${a.end_seconds === undefined ? 'end' : clock(a.end_seconds)}` +
        (a.cursor ? ' (next page)' : ''),
    );
    read<{
      recording_id: string;
      start_seconds?: number;
      end_seconds?: number;
      kinds?: (typeof visualKinds)[number][];
      cursor?: string;
    }>(
      'get_visual_events',
      "Where one recording's picture goes black, freezes, cuts hard or fades between two times, " +
        'as text lines with times in recording seconds: scene changes, menus, loading and ' +
        'chapter screens. Read from the picture once per recording file by Virtual Cut, so no ' +
        'video tools are needed. 200 lines per page; when more remain, pass next_cursor as ' +
        'cursor. If the picture has not been read yet, state says so: that means unknown, not none.',
      z.object({
        recording_id: z.string().max(200),
        start_seconds: z.number().min(0).optional(),
        end_seconds: z.number().positive().optional(),
        kinds: z
          .array(z.enum(visualKinds))
          .max(4)
          .optional()
          .describe('Only these kinds: black, still, cut, fade. All when omitted.'),
        cursor: z.string().max(40).optional(),
      }),
      (s, a) =>
        visualEventLines(s, {
          recordingId: a.recording_id,
          start: a.start_seconds,
          end: a.end_seconds,
          kinds: a.kinds,
          cursor: a.cursor,
        }),
      (a, n) =>
        `Picture events of ${n(a.recording_id)}, ` +
        `${clock(a.start_seconds ?? 0)}–${a.end_seconds === undefined ? 'end' : clock(a.end_seconds)}` +
        (a.kinds?.length ? ` (${a.kinds.join(', ')})` : '') +
        (a.cursor ? ' (next page)' : ''),
    );
    read<{
      recording_id: string;
      start_seconds?: number;
      end_seconds?: number;
      areas?: (typeof screenAreas)[number][];
      min_seconds?: number;
      numbers?: boolean;
      min_confidence?: number;
      detail?: boolean;
      cursor?: string;
    }>(
      'get_screen_text',
      "Every piece of text one recording's screen showed between two times (dialogue, names, " +
        'menus, tooltips, notices, numbers), as short text lines: when it was on screen and ' +
        'where, with text that appeared together in one area on one line. Read by Virtual Cut ' +
        'once per recording file, one frame a second, so no video tools are needed. Nothing is ' +
        "labelled: judge what a line is from where and how long it stayed up, and the game's " +
        'layout. Busy games show a lot of text: read time windows around what you need, and use ' +
        'min_seconds to skip text that flashed by. detail adds boxes and confidence. 200 lines ' +
        'per page with counts per screen area; when more remain, pass next_cursor as cursor. If ' +
        'the screen text has not been read yet, state says so: that means unknown, not none.',
      z.object({
        recording_id: z.string().max(200),
        start_seconds: z.number().min(0).optional(),
        end_seconds: z.number().positive().optional(),
        areas: z
          .array(z.enum(screenAreas))
          .max(9)
          .optional()
          .describe('Only text whose centre is in these thirds of the frame. All when omitted.'),
        min_seconds: z
          .number()
          .min(0)
          .optional()
          .describe('Only text that stayed on screen at least this many seconds.'),
        numbers: z
          .boolean()
          .optional()
          .describe('false leaves out lines that are only numbers (damage, counters, timers).'),
        min_confidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            'Only text the engine read at least this sure of, 0 to 1 (0.85 skips most HUD icons and half-visible text).',
          ),
        detail: z
          .boolean()
          .optional()
          .describe(
            'true lists every piece on its own line with its box, keyframes and confidence.',
          ),
        cursor: z.string().max(40).optional(),
      }),
      (s, a) =>
        screenTextLines(s, {
          recordingId: a.recording_id,
          start: a.start_seconds,
          end: a.end_seconds,
          areas: a.areas,
          minSeconds: a.min_seconds,
          numbers: a.numbers,
          minConfidence: a.min_confidence,
          detail: a.detail,
          cursor: a.cursor,
        }),
      (a, n) =>
        `Screen text of ${n(a.recording_id)}, ` +
        `${clock(a.start_seconds ?? 0)}–${a.end_seconds === undefined ? 'end' : clock(a.end_seconds)}` +
        (a.areas?.length ? ` (${a.areas.join(', ')})` : '') +
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
      (a, n) =>
        `Annotations: ${a.recording_id ? n(a.recording_id) : a.batch_id ? n(a.batch_id) : 'active batch'}`,
    );
    read<{ recording_id?: string; max_examples?: number }>(
      'get_intent_guide',
      "How to read the creator's free mic speech and turn it into proposals: the intents " +
        '(marker, general, notion, edit), spoken commands, rules (including recordings with no ' +
        'mic and recurring moments), per-game sections and the steps of an intent pass, with ' +
        'their own labelled examples, earlier decisions and habits. Read it before proposing. ' +
        'Give recording_id to leave that recording out of the examples.',
      z.object({
        recording_id: z.string().max(200).optional().describe('The recording you will work on.'),
        max_examples: z.number().int().min(0).max(200).optional().describe('Default 40.'),
      }),
      (s, a) => intentGuideAnswer(s, { ...a, pictures: access.picturesAllowed(client.id) }),
      (a, n) => `Intent guide${a.recording_id ? ` for ${n(a.recording_id)}` : ''}`,
    );
    read<SubmitInput>(
      'submit_proposals',
      'Propose markers, timed notes, splits or clip ranges for one recording, each with a reason, ' +
        "an optional intent tag and the transcript lines it rests on. They appear on cue cards in the user's " +
        'transcript window and change nothing until accepted. The whole call is refused, naming the ' +
        'field, if any proposal is invalid, repeats a pending one or cites a stale transcript.',
      submitInput,
      (s, a) => {
        const store = options.projects()!.store!;
        const proposals = prepareSubmission(
          s,
          a,
          { clientId: client.id, name: client.name },
          { submission: randomUUID(), proposal: randomUUID },
          undefined,
          store.proposals.count(a.recording_id),
          proposalLimit,
        );
        store.proposals.add(proposals);
        const read = currentTranscripts(s, a.recording_id);
        options.projects()!.batchRecords.submitted(store, proposals, {
          runIntent: a.run_intent,
          transcripts: (['mic', 'game'] as const).flatMap((role) =>
            read[role]
              ? [
                  {
                    role,
                    transcriptId: read[role].id,
                    corrections: (s.model.transcriptEdits || []).filter(
                      (e) => e.transcriptId === read[role]!.id,
                    ).length,
                  },
                ]
              : [],
          ),
        });
        return submissionAnswer(s, proposals);
      },
      (a, n) => `Proposed ${a.proposals?.length ?? 0} for ${n(a.recording_id)}`,
      'proposed',
    );
    read<WithdrawInput>(
      'withdraw_proposals',
      'Take back your own proposals that are still waiting for the user, such as a first pass ' +
        'the creator corrected before you submit the second. They leave the cue cards and stay ' +
        'in the batch record as withdrawn by you, apart from what the user rejected. Proposals ' +
        "the user already accepted or rejected, and other apps' proposals, cannot be withdrawn: " +
        'the whole call is refused, naming the first such id. Find pending ids with ' +
        "get_proposal_decisions status 'pending'.",
      withdrawInput,
      (s, a) => {
        const projects = options.projects()!;
        const { proposals, withdrawal } = prepareWithdrawal(s, a, client.id);
        projects.store!.proposals.withdraw(
          proposals.map((p) => p.id),
          withdrawal,
        );
        projects.batchRecords.withdrew(projects.store!, proposals, withdrawal.reason);
        return withdrawalAnswer(s, proposals, withdrawal);
      },
      (a, n) => {
        const ids = Array.isArray(a.proposal_ids) ? a.proposal_ids : [];
        const store = options.projects()?.store;
        const recordings = [...new Set(ids.map((id) => store?.proposals.sourceOf(String(id))))];
        const where =
          recordings.length === 1 && recordings[0]
            ? ` for ${n(recordings[0])}`
            : recordings.length > 1
              ? ` across ${recordings.length} recordings`
              : '';
        return `Withdrew ${ids.length}${where}`;
      },
      'withdrew',
    );
    // VC-204: changes to markers and clips already in the project, as cards with before and after.
    read<ChangesInput>(
      'propose_changes',
      'Propose changes to markers or clips already in the project (ids from get_annotations): ' +
        'name, position or range, marker color, Resolve clip color (clips), note, or a trim of a ' +
        "clip's start or end. Each lands as a card showing before and after, and nothing changes " +
        'until the user accepts it; accepting edits the marker or clip like the user would, so ' +
        'Undo works. Only fields that differ are proposed. One pending change per marker or clip: ' +
        'to tweak it, use amend_proposal. The whole call is refused, naming the field, if any ' +
        'change is invalid.',
      changesInput,
      (s, a) => {
        const store = options.projects()!.store!;
        const proposals = prepareChanges(
          s,
          a,
          { clientId: client.id, name: client.name },
          { submission: randomUUID(), proposal: randomUUID },
          undefined,
          store.proposals.count(a.recording_id),
          proposalLimit,
        );
        store.proposals.add(proposals);
        const read = currentTranscripts(s, a.recording_id);
        options.projects()!.batchRecords.submitted(store, proposals, {
          runIntent: a.run_intent,
          transcripts: (['mic', 'game'] as const).flatMap((role) =>
            read[role]
              ? [
                  {
                    role,
                    transcriptId: read[role].id,
                    corrections: (s.model.transcriptEdits || []).filter(
                      (e) => e.transcriptId === read[role]!.id,
                    ).length,
                  },
                ]
              : [],
          ),
        });
        return changesAnswer(s, proposals);
      },
      (a, n) => `Proposed ${a.changes?.length ?? 0} changes for ${n(a.recording_id)}`,
      'proposed',
    );
    read<AmendInput>(
      'amend_proposal',
      'Revise one of your own proposals still waiting for the user, in place: its title, note, ' +
        'position, end, marker color, clip color or split clip names (for a change card, the ' +
        'values it proposes). The card shows it was amended and keeps every earlier version, so ' +
        'use this instead of withdrawing and proposing again. Give a short reason. Proposals the ' +
        "user already decided, withdrawn ones and other apps' proposals cannot be amended.",
      amendInput,
      (s, a) => {
        const store = options.projects()!.store!;
        const amended = prepareAmend(s, a, client.id);
        store.proposals.amend(amended);
        return amendAnswer(s, amended);
      },
      (a, n) => {
        const recording = options.projects()?.store?.proposals.sourceOf(String(a.proposal_id));
        return `Amended a proposal${recording ? ` for ${n(recording)}` : ''}`;
      },
      'amended',
    );
    read<DecisionsInput>(
      'get_proposal_decisions',
      "The user's decisions on proposals: pending, accepted (with the position, end, title and note " +
        'chosen, how far it moved, and kindChange when a clip range was kept as a range marker or ' +
        'a range marker as a clip) ' +
        'or rejected. why holds the reason when the user gave one: a reject reason (wrong-moment, ' +
        'not-needed, wrong-intent, or other with a note) or a note about an accept. ' +
        'afterAccepting lists what the user changed later to what accepting made (moved, ' +
        'retitled, given or cleared an end, removed). A marker accepted from a proposal has its ' +
        'color in chosen, with recolored when it differs from the color you proposed (Blue if none). ' +
        'withdrawn lists what you took back with withdraw_proposals, apart from rejections. ' +
        'Filter by recording, proposal ids or status.',
      decisionsInput,
      (s, a) => proposalDecisions(s, a),
      (a, n) => `Proposal decisions${a.recording_id ? `: ${n(a.recording_id)}` : ''}`,
    );
    read<{ batch_id?: string }>(
      'get_batch_record',
      "A batch's record for learning from it: the agent's first pass (proposals as they landed, " +
        'and what each recording held then) beside the state at its latest export: clips, ' +
        'markers and notes, each linked to the proposal it came from or marked as the ' +
        "user's own, how each accepted proposal differs from what was proposed, changes made " +
        'after accepting, removed items and spans, and pointers to ' +
        'what the agent read (transcripts, intent guide version, model, run intent).',
      z.object({ batch_id: batch }),
      (s, a) => batchRecordAnswer(s, a.batch_id),
      (a, n) => `Batch record: ${a.batch_id ? n(a.batch_id) : 'active batch'}`,
    );
    // What's new (VC-242) needs no open project: it reads the notes built into this version.
    server.registerTool(
      'get_whats_new',
      {
        description:
          "Virtual Cut's release notes for every version since this app last read them " +
          '(Virtual Cut remembers that per paired app), or since `since`, newest first. For ' +
          'agents: new and changed tools and fields, what to do differently now, known gaps and ' +
          'the intent guide version; also what changed for the user, and whether the notes are ' +
          'final or a draft. Call it when the server instructions say Virtual Cut was updated.',
        inputSchema: z.object({
          since: z
            .string()
            .max(40)
            .regex(/^\d+\.\d+\.\d+/, 'Use a version like 0.4.28.')
            .optional()
            .describe('A version like 0.4.28: list what changed after it instead.'),
        }),
        annotations: { readOnlyHint: true },
      },
      async (args: unknown) => {
        const { since } = args as { since?: string };
        if (!access.isPaired(client.id)) {
          socket.destroy();
          return failure('This pairing was revoked in Virtual Cut.');
        }
        const stored = access.state().clients.find((c) => c.id === client.id);
        const from = since ?? access.notesFrom(client.id);
        const basis = since
          ? 'since'
          : stored?.notesRead
            ? 'last read'
            : stored?.pairedVersion
              ? 'paired'
              : 'all';
        const answer = agentNotes(app.getVersion(), from, basis);
        access.notesWereRead(client.id, releaseOf(app.getVersion()));
        access.record(
          client,
          'get_whats_new',
          since ? `What's new since ${since}` : "What's new",
          'read',
        );
        return { content: [{ type: 'text' as const, text: JSON.stringify(answer, null, 1) }] };
      },
    );
    // VC-172: pictures on request, only while Allow pictures is on (one switch for every app).
    server.registerTool(
      'look',
      {
        description: lookDescription,
        inputSchema: lookInput,
        annotations: { readOnlyHint: true },
      },
      async (args: unknown) => {
        const a = args as LookInput;
        if (!access.isPaired(client.id)) {
          socket.destroy();
          return failure('This pairing was revoked in Virtual Cut.');
        }
        // Activity names the recording even when the call is refused, from the paired project only.
        const store = options.projects()?.store;
        const summary = () =>
          lookSummary(a, (id) =>
            store?.data.project.id === client.projectId
              ? store.data.model.recordings.find((r) => r.id === id)?.title || id
              : id,
          );
        try {
          // The one check every picture call goes through, before anything is read.
          access.checkPictures(client.id);
          source(client);
          const service = options.projects()!;
          const result = await look(
            service.tool('ffmpeg'),
            lookRecording(service.store!, a.recording_id),
            a,
          );
          access.record(client, 'look', summary(), 'read', {
            images: result.images,
            imageTokens: result.imageTokens,
          });
          options.log?.('agent-look', {
            clientId: client.id,
            images: result.images,
            imageTokens: result.imageTokens,
            elapsedMs: result.elapsedMs,
          });
          return { content: result.content };
        } catch (e) {
          const known =
            e instanceof Refused ||
            e instanceof AgentReadError ||
            e instanceof PicturesOff ||
            e instanceof LookError;
          access.record(client, 'look', summary(), 'refused');
          return failure(
            known ? (e as Error).message : 'Virtual Cut could not make those pictures.',
          );
        }
      },
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
      `--pipe=${path.basename(access.pipe)}`,
      `--pair=${token}`,
    ];
    const quote = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
    const pairing: AgentPairing = {
      client,
      token,
      claudeCode: `claude mcp add --scope user virtual-cut -e ELECTRON_RUN_AS_NODE=1 -- ${[process.execPath, ...args].map(quote).join(' ')}`,
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
  // Only the user changes Allow pictures, in the Agent panel (VC-195): no tool can.
  ipcMain.handle('agent:setPictures', (event, allowed: unknown) => {
    options.trusted(event);
    return access.setPictures(allowed === true);
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

const lookDescription =
  'Pictures of moments in one recording, rendered by Virtual Cut, for when seeing the picture ' +
  'would make your work better. Only while the user has Allow pictures on; otherwise it ' +
  'says pictures are off. Check several moments in one call (up to 8), each one of: strip ' +
  '(start_seconds to end_seconds as up to 16 small 252x140 tiles, each with its time burned ' +
  'in), frames (times, at size 720p by default, about 1,200 image tokens each and up to 6 a ' +
  'call, or 1080p for detail, about 2,700 tokens and up to 2), or crop (at_seconds and a box ' +
  'shown at full source detail: a get_screen_text box from detail with box_units ' +
  '"screen_text", padded a little, or x0,y0,x1,y1 as fractions 0-1 of the frame with box_units ' +
  '"fraction"). Per call at most 16 pictures and about 8,000 image tokens; a bigger request is ' +
  'fitted (fewer tiles, smaller sizes) and says so. Every picture comes after a line with its ' +
  'time. Find where to look with picture events, screen text and transcripts; start with a ' +
  'strip, then frames or crops where you need detail.';
const lookInput = z.object({
  recording_id: z.string().max(200),
  moments: z
    .array(
      z.object({
        kind: z.enum(['strip', 'frames', 'crop']),
        start_seconds: z.number().min(0).optional().describe('strip: from. Default 0.'),
        end_seconds: z.number().positive().optional().describe('strip: to. Default the end.'),
        tiles: z.number().int().min(2).max(16).optional().describe('strip: tiles. Default 16.'),
        times: z.array(z.number().min(0)).min(1).max(16).optional().describe('frames: seconds.'),
        size: z.enum(['720p', '1080p']).optional().describe('frames: default 720p.'),
        at_seconds: z.number().min(0).optional().describe('crop: when.'),
        box: z.array(z.number()).length(4).optional().describe('crop: x0, y0, x1, y1.'),
        box_units: z
          .enum(['screen_text', 'fraction'])
          .optional()
          .describe('crop: pixels of a get_screen_text box, or fractions 0-1 of the frame.'),
      }),
    )
    .min(1)
    .max(8),
});
/** The Activity line of a look call: the recording and what was asked, never the pictures. */
export function lookSummary(a: LookInput, name: (id: string) => string) {
  const parts = (Array.isArray(a?.moments) ? a.moments : []).map((m) =>
    m.kind === 'strip'
      ? `strip ${lookClock(m.start_seconds ?? 0)}–${m.end_seconds === undefined ? 'end' : lookClock(m.end_seconds)}`
      : m.kind === 'frames'
        ? `${m.times?.length ?? 0} frame${m.times?.length === 1 ? '' : 's'} ${m.size ?? '720p'} ` +
          (m.times || []).slice(0, 4).map(lookClock).join(', ') +
          ((m.times?.length ?? 0) > 4 ? '…' : '')
        : `crop at ${lookClock(m.at_seconds ?? 0)}`,
  );
  return `Look at ${name(String(a?.recording_id ?? ''))}: ${parts.join('; ')}`;
}

class Refused extends Error {}
function failure(text: string) {
  return { isError: true, content: [{ type: 'text' as const, text }] };
}
function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
