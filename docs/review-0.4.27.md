# M4 review — 0.4.27

November 6, 2026. Sprint 13, a short sprint before Connor's first real batch: the two things that
batch would trip on are fixed, and a third, asked for mid-sprint, removes the clip-by-clip
transcript import in Resolve. A first commit on the sprint branch made the suite report show
skipped parts of passing checks. Two lanes ran in parallel; each ticket was reviewed and accepted
in its own thread, and this delivery puts them together.

## Suite report shows skipped parts (sprint commit)

Planned at the Sprint 11 retro and missed in Sprint 12.

- A check that skips part of itself because a setting is missing calls `skippedStep(step, reason)`
  from `scripts/shared.mjs`. It still passes, and its line in the console and in `report.md` says
  what didn't run, for example `passed: smoke.mjs (skipped: video playback,
VIRTUAL_CUT_TEST_VIDEO not set)`; `report.json` lists them as `skippedSteps`. The report's first
  line is unchanged.
- Marked: the screen text setup checks (engine check, install), the screen text card (install),
  the real export check, the speech engine's real install, the installed GPU engine and smoke's
  video playback.
- Two fixes to `screen-text-setup-ui.mjs` found while the lanes ran their suites: it now waits for
  the transcript window's address before resizing it (`6fcd0f2`), and a failed install records the
  setup's state and message (`d31f1c5`). That message showed the install failing with "The
  filename or extension is too long" when the suite's output folder sat deep on disk; the lane
  reran from a shorter folder. A Triage ticket covers the real-user case.

## Double-click edits the word you clicked, with Follow on (VC-197)

Accepted 2026-11-05 (lane A thread: "I tested it and it seems okay").

- A click on a word seeks to it. With Follow playback on, a word within 100 px of the window's
  edge was scrolled to the middle between the two clicks of a double-click, so the editor opened
  on another word. CI hit it twice on 0.4.26.
- A seek from a click in the transcript now leaves the list still while the position stays on the
  clicked word. Follow carries on once playback moves off it, right away after a seek from
  anywhere else (timeline, keys), and when Follow is turned back on. Positions arriving within
  500 ms of the click that aren't on the word count as sent before the seek landed.
- Checks: new desktop `follow-dblclick-ui.mjs` scrolls a word into Follow's margin (normal and
  compact window), double-clicks it with Follow on and expects the editor on that word with the
  list unmoved; it fails on 0.4.26's code. `heard-as-ui.mjs` leaves Follow on again.
- Evidence: `W:\AI\Claude\Virtual Cut\evidence\0.4.27\vc-197` (before and after).

## A timecode SRT for Resolve's transcript import (VC-158)

Accepted 2026-11-05 (lane B thread, on the board; wording accepted on the prototype).

- When SRT subtitles are chosen and the finished video carries a start timecode, export and filing
  also write `<video>.timecode.srt` (and `.mic.timecode.srt`), the same lines shifted to that
  timecode. The plain `.srt` stays for players. Copies publish like the plain SRT and never
  replace a file.
- The timecode is read by FFprobe from the finished video and stored on the verification receipt.
  The companion gets an optional `subtitleTimecode` section; the receipt stays version 4.
- The result line names the copies and their start, or says "No timecode copies: the video has no
  start timecode." OBS recordings carry none, and Connor's Resolve check showed their plain `.srt`
  already lines up (each cue within one frame); the test export at 01:00:00:00 lined up from its
  `.timecode.srt`.
- Checks: sidecar unit test in `transcript-domain.test.mjs`; a timecode export in
  `export-native-checks.mjs` verified against ffprobe; `export-ui-checks.mjs` with screenshots of
  both result lines.
- Evidence: `W:\AI\Claude\Virtual Cut\evidence\0.4.27\vc-158`.

## The Resolve helper sets transcripts (added mid-sprint)

Accepted 2026-11-06 (lane B thread: "great this seems good now"). Connor asked for it on
2026-11-05 after VC-158's Resolve check, so the batch's clips don't need importing one by one.

- The Virtual Cut metadata helper's Check and Apply now also set each matching clip's Resolve
  transcript, on Resolve Studio 21.1.2 or later (checked on 21.2.0.5). Decision 0023 amends 0009,
  which had kept transcript import manual.
- Only clips with no transcript get one; any existing transcript is kept, including one that
  appears between Check and Apply. Game dialogue only, from the companion's transcript history
  when the export kept it, else the `.srt` beside the video. Microphone notes never go in.
- Times are placed from the clip's start in Resolve. Drop-frame timecode and fractional rates are
  reported, not guessed. Each clip's plan line says set, kept or none with the reason, and Apply
  names the clips that got one. A transcript problem never undoes a clip's markers.
- Apply is now "Apply markers and transcripts"; the Handoff panel and filing docs say the same.
  After Connor's check the window got room for its wrapped labels, and words carry Resolve's
  trailing spaces so joined lines read correctly.
- Checks: `scripts/resolve-helper.test.py` (mocked Resolve), run by `resolve-helper-checks.mjs`.
- Evidence: `W:\AI\Claude\Virtual Cut\evidence\0.4.27\vc-hlp`.

## Delivery

Fast gate (13 s), desktop suite with coverage (303 s), Windows package, packaged checks (221 s)
and the transport check (38 s) passed.

Evidence in `W:\AI\Claude\Virtual Cut\evidence\0.4.27`, with each lane's runs in `vc-197`,
`vc-158` and `vc-hlp`, and the checks after the merges in `merge-a` and `merge-ab`.
