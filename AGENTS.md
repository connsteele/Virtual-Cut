# Virtual Cut development

Shared instructions for any coding agent working in this repo. Start with `README.md` (current
version and milestone), `CHANGELOG.md`, `docs/decisions/` (short decision records),
`docs/user-guide.md` (current controls) and `docs/testing.md`. Read `docs/design-decisions.md`
before changing cutting, timestamps, mic removal or transcription.

## Product

- Virtual Cut prepares game footage for YouTube: import, cut, review and file selects natively.
  DaVinci Resolve is the export target only; selects and string-outs are built here.
- Windows first, native title bar, Virtual Legacy teal `#04635F`, persistent bottom page
  navigation inspired by Resolve.
- Never invent footage, progress, transcripts or agent output. Every proposed action (spoken cue,
  suggestion) needs the user's review; nothing is applied automatically.
- Keep app behavior independent of personal drive letters and game names.

## Architecture

- Electron + React + TypeScript + Vite, with **CSS Modules** and npm. No Tailwind or component
  framework without a concrete need and a discussion. Global CSS holds only resets, theme
  variables, base typography and focus.
- Electron main owns native work. The renderer is sandboxed (context isolation, no Node
  integration) and talks through a narrow typed preload API (`electron/*-contracts.ts`). Never
  expose shell commands, unrestricted file reads or raw IPC to the renderer.
- FFmpeg tools and the Python speech worker run as separate processes started by main. Projects
  are SQLite (`.vcut`); transcripts live in their own tables.
- Exports publish exclusively (stage, then hard-link) and never replace a file. The Resolve helper
  reads `.vcut.json` receipt versions 1–4: add optional, separately versioned sections rather
  than bumping the receipt version.

## Safety and storage

- Never test against or write to original recordings; use copies. Nothing may move or modify
  originals.
- Downloads, caches, screenshots, test runs, builds and packaging intermediates follow the
  user's storage preference (on Connor's workstation: `G:\Claude\Virtual Cut`). Never commit
  node_modules, profiles, media, personal notes or build output.

## Checks and delivery

- `npm test` is the fast gate (lint, typecheck, format, unit tests). Judge a run by the first
  line of its `report.md`; a suite-level failure shows as `failed: suite`, not `FAILED`.
- `node scripts/test-suite.mjs desktop --only=a.mjs,b.mjs` runs focused desktop checks (`native`
  likewise). Set `VIRTUAL_CUT_SUITE_OUTPUT` to a disposable folder.
- Every script in `scripts/` is listed in `scripts/test-inventory.mjs`, as a check or as an
  excluded tool with a reason; otherwise the suite refuses to run.
- `scripts/coverage-gates.json` sets per-file gates. New branches in a gated file need a check
  that reaches them.
- UI changes: verify in the Electron window, including a compact window and keyboard focus.
  When a desktop check covers new UI, have it save a screenshot and look at it.
- `npm run deliver -- --version x.y.z` runs a release end to end (fast gate, desktop suite with
  coverage, Windows package, packaged checks, transport) and stops at the first failure. Each
  delivery adds a `CHANGELOG.md` entry, the README line and `docs/review-<version>.md`.

## Working agreement

- One item, or one small coherent cluster, at a time. Propose before starting; reviews are
  read-only.
- Work runs in short sprints (1–3 days, one build). Plans, checks and decisions go on the review
  board; tickets live on the Notion development board. Decisions are applied only when Connor
  says "apply".
- Whenever Connor has to check something, a build containing the change must exist and be
  linked first. Never describe unbuilt behavior as ready to check.
- Push or merge only what Connor has approved.
- Prettier formats everything, Markdown included. On Windows, pass commit messages from a file
  (`git commit -F`); PowerShell can split quoted messages into pathspecs.
