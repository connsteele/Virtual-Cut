import { connect } from 'node:net';

// Runs as plain Node (ELECTRON_RUN_AS_NODE): started by `Virtual Cut.exe --mcp` (see
// mcp-launcher), or directly by an agent app's config with --pipe and --pair, which skips
// Electron's start-up and the blank line it writes to stdout on Windows.
// The first line on the pipe carries the pairing token; the app answers with one line
// before MCP traffic starts. Nothing here reads files or opens other connections.
const option = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const pipe = option('pipe') || process.env.VIRTUAL_CUT_AGENT_PIPE || '',
  token = option('pair') || process.env.VIRTUAL_CUT_AGENT_TOKEN || '';
function fail(message: string): never {
  process.stderr.write(`Virtual Cut: ${message}\n`);
  process.exit(1);
}
if (!token)
  fail(
    'this agent app is not paired. In Virtual Cut, open Agent, pair the app and use the command it shows.',
  );
const socket = connect(pipe);
let answered = false,
  pending = Buffer.alloc(0);
socket.on('error', (e: NodeJS.ErrnoException) =>
  fail(
    answered
      ? 'the connection to Virtual Cut closed.'
      : e.code === 'ENOENT'
        ? 'Virtual Cut is not running, or agent access is off. Open Virtual Cut, turn on agent access under Agent, then reconnect.'
        : 'could not reach Virtual Cut. Check that agent access is on under Agent.',
  ),
);
socket.on('connect', () => socket.write(JSON.stringify({ pair: token }) + '\n'));
function onHandshake(chunk: Buffer) {
  pending = Buffer.concat([pending, chunk]);
  const end = pending.indexOf(10);
  if (end < 0) {
    if (pending.length > 4096) fail('Virtual Cut sent an unexpected reply.');
    return;
  }
  let reply: { ok?: boolean; error?: string };
  try {
    reply = JSON.parse(pending.subarray(0, end).toString('utf8'));
  } catch {
    fail('Virtual Cut sent an unexpected reply.');
  }
  if (!reply.ok) fail(reply.error || 'Virtual Cut refused this agent app.');
  answered = true;
  socket.off('data', onHandshake);
  const rest = pending.subarray(end + 1);
  if (rest.length) process.stdout.write(rest);
  socket.pipe(process.stdout);
  process.stdin.pipe(socket);
}
socket.on('data', onHandshake);
socket.on('close', () => process.exit(answered ? 0 : 1));
process.stdin.on('end', () => socket.end());
