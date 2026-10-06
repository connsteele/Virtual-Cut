import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Agent apps start `Virtual Cut.exe --mcp` and talk MCP over its stdio (VC-159).
 * The launcher never opens a window or a second app: it relays bytes between stdio
 * and the running Virtual Cut's per-user named pipe, which serves MCP (VC-160).
 */
export function agentPipeName(userData: string) {
  // userData is per Windows user (and per test profile), so the pipe is too.
  const id = createHash('sha256').update(path.resolve(userData).toLowerCase()).digest('hex');
  return `\\\\.\\pipe\\virtual-cut-agents-${id.slice(0, 24)}`;
}

/**
 * Electron's main process does not read piped stdin on Windows, so the relay runs as
 * plain Node from the same executable and inherits the agent app's stdio handles.
 */
export function runLauncher(userData: string, token: string, done: (code: number) => void) {
  const child = spawn(process.execPath, [path.join(__dirname, 'mcp-relay.cjs')], {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      VIRTUAL_CUT_AGENT_PIPE: agentPipeName(userData),
      VIRTUAL_CUT_AGENT_TOKEN: token,
    },
  });
  child.on('error', () => {
    process.stderr.write('Virtual Cut could not start its agent connection.\n');
    done(1);
  });
  child.on('exit', (code) => done(code ?? 1));
}
