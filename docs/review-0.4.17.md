# M4 review — 0.4.17

October 6, 2026. Sprint 4, the first M4 build: VC-159 (MCP launcher and packaging) and VC-160
(read-only MCP server with pairing, activity list and read tools). Two checks, on the
[Virtual Cut Review board](https://claude.ai/artifact/HdJ3dXBscsVgiwtWiVATpT). Nothing can change
a project through MCP in this build.

## M343 — Turn on agent access and pair an agent app (VC-159)

- [ ] Open a project, then Agent in the header. Agent access is off by default.
- [ ] Turn on Allow agent apps to connect: the panel says it is waiting for paired agent apps.
- [ ] Pair with <project> shows a Claude Code command and a Claude Desktop settings block,
      each with a Copy button. Run the command in a terminal (or add the block to
      `claude_desktop_config.json` and restart Claude Desktop). No second Virtual Cut window
      opens when the agent app connects, and the app shows as connected.

## M344 — Ask Claude about the open project (VC-160)

- [ ] Ask what project is open and what's on screen; the answer matches the page, recording
      and selection.
- [ ] Ask what the Cai batch's brief says, and what was said in the mic transcript between
      two times; the answers match Virtual Cut.
- [ ] Activity lists each read with the app and time. Ask Claude to change, rename or export
      something: it has no tool for that.
- [ ] Revoke ends the connection; the agent app then reports it isn't paired.

## Evidence

Commits since 0.4.16: `9bd4f67` (launcher, server, pairing, panel, decision record 0014),
`4e9b3c5` (smoke boundary check), `a1f4588` (relay started as plain Node), plus this delivery
commit, on branch `m4-agents-mcp`. Produced with `npm run deliver -- --version 0.4.17`; the first
run stopped at `smoke.mjs`, which pins the renderer API and now includes `agent`.

- Checks: `agent-tools.test.mjs` (fast) and `agent-access-ui.mjs` (desktop and packaged): off by
  default, unpaired and offline refusals, five read tools listed read-only, reads and a refusal
  in Activity, `--mcp` launcher without a second window, first stdout byte is MCP, revoke and
  switching off cut live connections.
- A packaged build answered every read tool over MCP on a copy of a cue-accuracy project with a
  real mic transcript (disposable profile).
- Fast gate: `G:\Claude\Virtual Cut\evidence\0.4.17\fast\run-r0IBw4`.
- Full desktop suite with coverage (52/52, gates met):
  `G:\Claude\Virtual Cut\evidence\0.4.17\suite\run-jGRfJL`.
- Build: `G:\Claude\Virtual Cut\builds\Virtual-Cut-0.4.17-win-x64-2026-10-06T23-14-29-454Z\Virtual Cut.exe`.
- Packaged checks (52/52): `G:\Claude\Virtual Cut\evidence\0.4.17\packaged\run-2lCJcj`.
- Transport check: `G:\Claude\Virtual Cut\evidence\0.4.17\transport`.
