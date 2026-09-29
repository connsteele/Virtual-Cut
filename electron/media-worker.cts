/** A short-lived guardian. If the Electron parent crashes/disconnects, the
 * tool is stopped too. No media-tool command is accepted from the renderer. */
import { spawn } from 'node:child_process';
const request = JSON.parse(process.argv[2]) as { tool: string; args: string[] };
const child = spawn(request.tool, request.args, {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const stop = () => child.kill();
process.on('disconnect', stop);
process.on('message', stop);
process.on('SIGTERM', stop);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on('error', (e) => {
  process.stderr.write(e.message);
  process.exitCode = 1;
  if (process.connected) process.disconnect?.();
});
child.on('close', (code) => {
  process.exitCode = code ?? 1;
  if (process.connected) process.disconnect?.();
});
