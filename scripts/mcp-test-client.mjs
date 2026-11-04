import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { electronEnvironment } from './shared.mjs';

/**
 * An MCP client for desktop checks: starts the launcher from a pairing's Claude Desktop block
 * and speaks newline-delimited JSON-RPC to it, as an agent app would.
 */
export function agent(config) {
  const { command, args, env = {} } = JSON.parse(config).mcpServers['virtual-cut'];
  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...electronEnvironment(), ...env },
  });
  let first;
  let out = '',
    stderr = '',
    id = 0;
  const waiting = new Map();
  child.stdout.on('data', (d) => {
    first ??= String(d);
    out += d;
    let end;
    while ((end = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, end).trim();
      out = out.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      waiting.get(message.id)?.(message);
    }
  });
  child.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      const timer = setTimeout(() => reject(new Error(`${method} timed out: ${stderr}`)), 20000);
      waiting.set(n, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });
  return {
    call,
    notify: (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'),
    exited,
    stderr: () => stderr,
    first: () => first,
    end: () => child.stdin.end(),
    kill: () => child.kill(),
  };
}
export async function initialize(client) {
  const init = await client.call('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'agent-access-check', version: '1' },
  });
  assert.equal(init.result.serverInfo.name, 'virtual-cut');
  client.notify('notifications/initialized');
}
export const tool = async (client, name, args = {}) => {
  const reply = await client.call('tools/call', { name, arguments: args });
  return { error: !!reply.result.isError, text: reply.result.content[0].text };
};
