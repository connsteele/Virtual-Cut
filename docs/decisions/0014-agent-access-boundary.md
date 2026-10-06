# 0014. Agents read Virtual Cut through a local, paired, read-only MCP server

- Status: Proposed
- Sources: VC-156 (design and copilot/agent-mode rules), VC-159, VC-160, MCP research thread (October 6, 2026), Sprint 4 scope on the Virtual Cut Review board (S4-SCOPE)

## Context

Agent work (intent proposals, transcript corrections, scoring) needs an agent to read real project context. Connor already uses agent apps such as Claude Code and Claude Desktop, which call tools in other programs through MCP (Model Context Protocol). The built-in provider connection (VC-21) is parked. Footage, file paths and project files are private, and nothing in a transcript may widen what an agent can do.

## Decision

- **Transport:** an agent app starts `Virtual Cut.exe --mcp`. That launcher never opens a window, project or second app: it relays stdio to the running Virtual Cut over a per-user named pipe (`\\.\pipe\virtual-cut-agents-<hash of the profile folder>`). There is no TCP port. With Virtual Cut closed or access off, the launcher exits with a message on stderr.
- **Server:** the MCP server runs in Electron main beside the IPC handlers, using the official TypeScript SDK (`@modelcontextprotocol/server`, 2026-07-28 spec). The renderer's existing API is unchanged; the Agent panel adds pairing calls and reports the on-screen view (page, recording, playhead, selection).
- **Off by default.** The Agent panel's switch opens the pipe; turning it off closes the pipe and every connection.
- **Pairing:** each agent app is paired once per project in the Agent panel. Pairing creates a random code shown once inside the launch command; only its SHA-256 hash is stored, in `agent-access.json` in the user profile. A pairing reads only while its project is open, and Revoke cuts live connections at once.
- **Read tools only (this stage):** `get_current_view`, `get_project_summary`, `get_context`, `get_transcript` (100 lines per page) and `get_annotations`. All are annotated read-only.
- **Never through MCP:** changing, deleting, importing, exporting or filing anything; file paths, media URLs or media bytes; SQL; Resolve or Notion. Notes' links and recording source paths are left out of every answer.
- **Activity:** every tool call, read or refused, is listed in the Agent panel with the app, the time and a one-line summary (the last 300 are kept). Content is summarized, never copied into the list or the diagnostics log.

## Alternatives considered

- **Local HTTP server:** any local process or web page could reach a port, and it needs its own authentication; a per-user pipe does not.
- **MCP server inside the launcher reading the project file:** a second process would read the SQLite project while the app writes it, and could not see the live session or the screen.
- **The older 1.x SDK:** heavier, with more dependencies; 2.x needs only Zod.

## Consequences

- Packaged builds now carry Electron main's runtime dependencies (`node_modules` for the SDK and Zod) inside `resources/app`.
- Proposals (VC-161/162) add tools that submit for review; they must keep this boundary. Full agent mode (VC-32) is granted in Virtual Cut's UI per run, never by an agent or by transcript text.
- A test-only development endpoint, if ever added, is separate and never shipped.
