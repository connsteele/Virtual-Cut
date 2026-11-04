# M4 review — 0.4.24

November 4, 2026. Sprint 10, the first half of the footage-evidence core before real batches:
media jobs in their own lane beside transcription, one background picture pass per recording,
and an MCP read tool for the picture events it finds. Two test-infrastructure tickets came first:
desktop checks four at a time, and local settings in `.env` so no script falls back to `G:\GPT`.
Each ticket was reviewed and accepted in its own thread; this delivery puts the five together.

## Faster desktop checks (VC-189)

Accepted 2026-11-04. No visible change in the app.

- The suite runs up to four checks at once (`--jobs=N`, default 4; CI uses 2). Checks that
  measure real decoding and timers run alone, and checks that share a fixture project run in
  order. Each check gets its own TEMP folder; the first failure stops the checks beside it.
- `review-fixes-checks` moves the page clock instead of waiting out the 10-minute autosave and
  polls instead of sleeping 2.4 s.
- Each check stops after three minutes unless the inventory names a longer limit. On a timeout a
  desktop check saves a screenshot of every open window, and the report lists them with the
  check's last 40 log lines. The October 18 `range-markers-ui` CI hang is recorded as a known
  flake in `docs/testing.md` (not reproduced in eight runs).
- Full desktop suite with coverage: 256 s, against 542 s for the 0.4.23 delivery.

## Local settings in `.env` (VC-190)

Accepted 2026-11-04 (board M381). No visible change in the app; the app never reads `.env`.

- Scripts load a repo-root `.env` through `scripts/shared.mjs` (`process.loadEnvFile`, no new
  dependency); a value set for one run still wins. `.env.example` lists every setting with one
  line each. README has a Local settings section.
- No script names a drive any more. With nothing set, scripts write under the OS temp folder, and
  those that need real files (footage, cue recordings, the transport fixture) stop and name the
  setting. `script-paths.test.mjs` in the fast gate fails if a drive-letter path comes back.
- The transport fixture was rebuilt under the workspace from a disposable copy and is found
  through `VIRTUAL_CUT_TRANSPORT_FIXTURE`, so the delivery's transport check runs again.
- Also fixes a `feedback-native-checks` race: it now waits for queued audio previews before
  counting the cleanup cache.

## Job lanes (VC-145)

Accepted 2026-11-04. Decision [0019](decisions/0019-job-lanes.md).

- Transcription runs in the speech lane; inspection, audio preparation, export and filing,
  filmstrips and the picture pass run in the media lane. Each lane runs one job at a time.
- Work you start goes ahead of work the app queued by itself, in each lane.
- A recording being transcribed doesn't get its inspection or audio preparation at the same
  time, and a transcription waits for its recording's audio preparation. Exports run beside a
  transcription of the same recording.
- Cancel, pause, close, restore, removal, restart recovery and job history behave as before, per
  lane. The Jobs dialog and user guide describe the lanes.
- Measured on disposable copies with the real speech engine: imports started 25–43 ms after the
  call and exports 0.01–0.42 s, while a transcription ran. On the GPU, exports made no measurable
  difference to the transcription; on the CPU, recognition ran about 1.36 times slower while an
  export ran (1.09 times for the whole job). Two runs of each.

## Picture pass (VC-180)

Accepted on 0.4.24-25 (board M386). Decision [0020](decisions/0020-picture-events.md).

- After its transcript, each recording gets one background pass in the media lane. It stores
  per-frame brightness and cut score, plus black, still, strong-cut and fade events, once per
  recording and source fingerprint, outside the editable model and Undo.
- It pauses while a transcription runs or a preview plays, uses the GPU decoder alone while you
  work, and adds up to three CPU workers when the PC has been idle for 5 minutes. With no NVIDIA
  decoder it reads on the CPU, only when idle.
- A scan icon beside Explorer and Remove starts it by hand ("Analyse picture now"), and Jobs
  starts it for a whole batch. The thumbnail shows a badge and a thin progress bar while it reads,
  "Paused" or "Waiting" when it holds, and a tick when ready, with the time taken and GPU or CPU
  on hover. Jobs shows the lane and what the pass uses right now.
- The Split snap reads stored black screens instead of decoding its window, with the same
  answers.
- Same events on every decoder path and chunk size on a synthetic copy. Timed on a copy of Cai
  Chapter 4 Battle (34:25, 4K60 AV1), idle, GPU + CPU: 130 s, 15.8 times real time (the spike
  measured 124 s). A fade must now be clear of any cut scoring 8 or more (`77529ec`), which took
  the Battle copy from 82 fades to 17.
- Recordings imported before 0.4.24 get their events from "Analyse picture now".

## Picture events through MCP (VC-171)

Accepted on 0.4.24-27 (board M387).

- `get_visual_events(recording_id, start_seconds, end_seconds, kinds?)` returns the black, still,
  cut and fade ranges VC-180 stored for a time window, as text in recording seconds. A recording
  whose pass hasn't finished answers with where its pass stands, never with an empty list.
- Read-only, listed in Activity like the other read tools; no images, paths or media.
- Agent check: a Sonnet agent asked "Where are the scene changes between 4:00 and 6:00?" on the
  Battle copy answered from four Virtual Cut calls (one black screen, 4:38.5–4:41.0), without
  FFmpeg or file access. The whole recording's events are about 2k tokens.

## Evidence

Branch `sprint-10` from `m4-agents-mcp` (`89ff135`). `36b961f` moves the user guide's Agent apps
section into [Agent apps](agent-apps.md), one paragraph per topic (Sprint 9 retro). One ticket
branch each, merged with `--no-ff` after Connor accepted it: VC-189 (`e9447e6`), VC-145
(`b0741b4`), VC-190 (`6a77abb`), VC-180 (`3d7bbc6`), VC-171 (`fecb961`). After every merge the
fast gate and the checks of all merged tickets passed (`test-runs\sprint-10\merge-*`).
`963255d` restores the project-service functions gate (93.96% after the VC-145 merge, gate 94%):
no check cancelled a filing while a media job was running, so the filing check now does. After
the VC-180 merge the full desktop suite with coverage passed, 68 checks, every gate met. Produced
with `node scripts/deliver.mjs --version 0.4.24`.

- Lanes: `job-lanes.test.mjs`, `job-lanes-native.mjs`; `job-lanes-ui.mjs` and
  `job-lanes-study.mjs` are on-demand tools needing the speech engine and disposable copies.
- Picture pass: `visual-events.test.mjs`, `visual-pass-native.mjs` (every path, pauses, cancel,
  retry, close, moved file), `visual-pass-ui.mjs` (manual start and status lines, screenshots).
  The suite sets `VIRTUAL_CUT_PICTURE_PASS=manual`.
- MCP tool: `agent-tools.test.mjs`, `agent-access-ui.mjs`, `visual-pass-ui.mjs` (pairs an agent
  through `scripts/mcp-test-client.mjs`).
- Settings: `script-paths.test.mjs`. VC-190's clean run with no TEMP, TMP or suite output set
  passed all 65 checks and stopped only at the project-service gate fixed in `963255d`.
- Known: a full packaged run on a labelled test build fails `filmstrip-ui-checks`' version check,
  which compares against `package.json`. Deliveries are unaffected.
- Ticket evidence: `W:\AI\Claude\Virtual Cut\evidence\0.4.24\vc-189`, `\vc-190`, `\vc-145`,
  `\vc-180` and `\vc-171` (findings in each `findings.md` where present).
- Delivery: fast gate (19 s), desktop suite with coverage (276 s, against 542 s for 0.4.23),
  Windows package, packaged checks (200 s) and the transport check (38 s, on the rebuilt
  workspace fixture) all passed. Runs: `evidence\0.4.24\fast`, `\suite`, `\packaged` and
  `\transport`.
