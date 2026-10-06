import { createServer, type Server, type Socket } from 'node:net';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { agentPipeName } from './mcp-launcher.cjs';
import type {
  AgentAccessState,
  AgentActivity,
  AgentClient,
  AgentView,
} from './agent-contracts.js' with { 'resolution-mode': 'import' };

interface StoredClient extends AgentClient {
  tokenHash: string;
}
interface Stored {
  enabled: boolean;
  clients: StoredClient[];
  activity: AgentActivity[];
}
const activityLimit = 300;
const hash = (token: string) => createHash('sha256').update(token).digest();
const visible = (c: StoredClient): AgentClient => ({
  id: c.id,
  name: c.name,
  projectId: c.projectId,
  projectName: c.projectName,
  paired: c.paired,
  lastUsed: c.lastUsed,
});

/** Serves one paired connection; returns a function that stops it. */
export type AgentServe = (socket: Socket, client: AgentClient) => () => void;

/**
 * Agent access (VC-160): off by default, one pairing per agent app and project, and a
 * record of every read. Pairing tokens are stored only as hashes in the user profile.
 */
export class AgentAccess {
  private data: Stored = { enabled: false, clients: [], activity: [] };
  private server?: Server;
  private listening = false;
  private message?: string;
  private connections = new Map<Socket, { clientId: string; stop?: () => void }>();
  private writing: Promise<void> = Promise.resolve();
  view?: AgentView;
  onChange?: () => void;
  serve?: AgentServe;
  readonly pipe: string;
  private file: string;
  constructor(userData: string) {
    this.file = path.join(userData, 'agent-access.json');
    this.pipe = agentPipeName(userData);
    try {
      const value = JSON.parse(readFileSync(this.file, 'utf8')) as Stored;
      if (value && Array.isArray(value.clients) && Array.isArray(value.activity))
        this.data = {
          enabled: value.enabled === true,
          clients: value.clients,
          activity: value.activity.slice(-activityLimit),
        };
    } catch {
      /* No saved access: everything stays off. */
    }
  }
  state(): AgentAccessState {
    const live = new Set([...this.connections.values()].map((c) => c.clientId));
    return {
      enabled: this.data.enabled,
      listening: this.listening,
      message: this.message,
      clients: this.data.clients.map((c) => ({ ...visible(c), connected: live.has(c.id) })),
      activity: [...this.data.activity].reverse(),
    };
  }
  async start() {
    if (this.data.enabled) await this.listen();
  }
  async setEnabled(enabled: boolean) {
    this.data.enabled = enabled;
    await this.persist();
    if (enabled) await this.listen();
    else await this.stop();
    this.changed();
    return this.state();
  }
  async pair(project: { id: string; name: string }, name: string) {
    const label = name.trim().slice(0, 80);
    if (!label) throw new Error('Name the agent app, for example Claude Code.');
    const token = randomBytes(24).toString('base64url');
    const client: StoredClient = {
      id: randomUUID(),
      name: label,
      projectId: project.id,
      projectName: project.name,
      paired: new Date().toISOString(),
      tokenHash: hash(token).toString('hex'),
    };
    this.data.clients.push(client);
    await this.persist();
    this.changed();
    return { client: visible(client), token };
  }
  async revoke(clientId: string) {
    this.data.clients = this.data.clients.filter((c) => c.id !== clientId);
    for (const [socket, c] of this.connections) if (c.clientId === clientId) this.drop(socket);
    await this.persist();
    this.changed();
    return this.state();
  }
  /** Records a read or a refusal; content is summarized, never copied. */
  record(client: AgentClient, tool: string, summary: string, outcome: AgentActivity['outcome']) {
    this.data.activity.push({
      at: new Date().toISOString(),
      clientId: client.id,
      clientName: client.name,
      tool,
      summary: summary.slice(0, 300),
      outcome,
    });
    if (this.data.activity.length > activityLimit)
      this.data.activity.splice(0, this.data.activity.length - activityLimit);
    const stored = this.data.clients.find((c) => c.id === client.id);
    if (stored) stored.lastUsed = new Date().toISOString();
    void this.persist().catch(() => {});
    this.changed();
  }
  isPaired(clientId: string) {
    return this.data.clients.some((c) => c.id === clientId);
  }
  async stop() {
    for (const socket of [...this.connections.keys()]) this.drop(socket);
    const server = this.server;
    this.server = undefined;
    this.listening = false;
    this.message = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  private async listen() {
    if (this.server) return;
    const server = createServer((socket) => this.accept(socket));
    this.server = server;
    await new Promise<void>((resolve) => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        this.server = undefined;
        this.listening = false;
        this.message =
          e.code === 'EADDRINUSE'
            ? 'Another Virtual Cut window already offers agent access.'
            : 'Agent access could not start.';
        resolve();
      });
      server.listen(this.pipe, () => {
        this.listening = true;
        this.message = undefined;
        resolve();
      });
    });
  }
  private accept(socket: Socket) {
    this.connections.set(socket, { clientId: '' });
    socket.on('close', () => {
      this.connections.get(socket)?.stop?.();
      this.connections.delete(socket);
      this.changed();
    });
    socket.on('error', () => socket.destroy());
    socket.setTimeout(10000, () => {
      if (!this.connections.get(socket)?.clientId) socket.destroy();
    });
    let pending = Buffer.alloc(0);
    const refuse = (error: string) => socket.end(JSON.stringify({ ok: false, error }) + '\n');
    const onData = (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      const end = pending.indexOf(10);
      if (end < 0) {
        if (pending.length > 4096) socket.destroy();
        return;
      }
      socket.off('data', onData);
      // Hold anything after the handshake until the MCP transport is listening.
      socket.pause();
      let token = '';
      try {
        token = String(JSON.parse(pending.subarray(0, end).toString('utf8')).pair || '');
      } catch {
        /* Refused below. */
      }
      const presented = hash(token);
      const client = this.data.clients.find((c) =>
        timingSafeEqual(Buffer.from(c.tokenHash, 'hex'), presented),
      );
      if (!client)
        return refuse(
          'This agent app is not paired, or its pairing was revoked. Pair it again under Agent in Virtual Cut.',
        );
      if (!this.serve) return refuse('Agent access is not available in this build.');
      const rest = pending.subarray(end + 1);
      socket.setTimeout(0);
      socket.write(JSON.stringify({ ok: true }) + '\n');
      const entry = this.connections.get(socket)!;
      entry.clientId = client.id;
      if (rest.length) socket.unshift(rest);
      entry.stop = this.serve(socket, visible(client));
      socket.resume();
      this.changed();
    };
    socket.on('data', onData);
  }
  private drop(socket: Socket) {
    this.connections.get(socket)?.stop?.();
    this.connections.delete(socket);
    socket.destroy();
  }
  private changed() {
    this.onChange?.();
  }
  private persist() {
    const body = JSON.stringify(this.data);
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        const temporary = this.file + '.' + process.pid + '.tmp';
        await writeFile(temporary, body, 'utf8');
        await rename(temporary, this.file);
      });
    return this.writing;
  }
}
