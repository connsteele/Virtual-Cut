# M3 review — 0.4.8

October 3, 2026. An engineering iteration from the [Claude M3 Audit](https://app.notion.com/p/3ee7c5227a8081bf86a4ddf66c5b8f1b)
and GPT's confirming review. It removes a project-size limit that would have stopped long
projects from saving or reopening, replaces the once-per-second project poll, enforces
promise error handling, and fixes the hosted CI workflow. No new user-facing feature is
added; existing workflows should behave as before. M3 remains open.

## M325 — Open an existing project after the upgrade (VC-97)

- [ ] Open your current project in the 0.4.8 build. It upgrades once to saved format 5 and
      says so; **Save history** lists a new **Before upgrade** copy. Reopening does not upgrade again.
- [ ] In Cut, step frames with the frame buttons, type a frame number in Position, use the
      keyframe buttons and drag a marker in **H · Manipulate**. Timing should be as exact as
      before, including in an expanded Review clip.
- [ ] Optionally restore an older save from Save history; frame stepping should still work.

Inspected per-frame timestamps used to be stored inside the editable project, about 2.6 MB per
hour of 60 fps footage. Around 16 hours the 32 MiB edit limit rejected saves and the project
could no longer reopen. They now live in their own table (exact values, keyed by the source
file they were inspected from), and the project itself stays a few kilobytes. Older Virtual Cut
builds cannot open an upgraded project; use the Before upgrade copy with an older build.

## M326 — Live status without polling (VC-98)

- [ ] Start a job (import inspection, audio preparation, transcription, export or filing).
      Progress and completion should still update live in Jobs and on recording cards.
- [ ] Move a completed Library clip or a source recording in Explorer, then return to Virtual
      Cut. Its missing state should appear when the window regains focus.

The app no longer re-reads the whole project every second. It refreshes when native work
changes something, and when the window regains focus (which also rechecks files moved outside
the app).

**Copy diagnostics** now waits for the clipboard write and reports a failure instead of
announcing success early (found by the new promise lint rule).

## Engineering evidence

| Ticket | Change                                                                                                                                                                                                                                             | Evidence                                                                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VC-49  | CI workflow set the suite output in job-level `env` using `runner.temp`, which GitHub rejects, so no jobs started. Moved into a step.                                                                                                              | Commit `895cb07`. Needs a push to confirm a hosted run.                                                                                                                        |
| VC-96  | `project-capacity-checks.mjs` (native gate) builds schema 4 projects with 1, 10 and 16 hours of 60 fps indexes and checks open/migrate, save, reopen, restore of an older save, exact timestamps and snapshot cost.                                | Fails on 0.4.7: 1 h model is 2,722,975 characters; the 16 h project fails to open (`Project edit is too large`). Evidence: `G:\Claude\Virtual Cut\evidence\red`.               |
| VC-97  | Schema 5 `frame_indexes` table; migration after the verified pre-upgrade copy; open-time validation ignores legacy inline indexes; rolling-save compaction and restore carry indexes; renderer loads them on demand.                               | Commit `f37698d`. Capacity check passes: model 488 / 3,215 / 5,045 characters at 1 / 10 / 16 h; snapshot median about 0.2 / 0.8 / 1.2 ms (GPT measured 741 ms at 16 h before). |
| VC-98  | Store change notifications, throttled in main (≤ 1 per 250 ms with a trailing one); renderer refreshes on notification, focus and visibility; no polling timer.                                                                                    | Commit `1237fa0`. Full desktop suite with VC-97: build plus all 48 checks passed, `G:\Claude\Virtual Cut\test-runs\run-E3TBmS`.                                                |
| VC-102 | Type-aware `no-floating-promises` (`ignoreVoid: false`) and `no-misused-promises`. 95 violations resolved: renderer actions start through `background()`, native fire-and-forget calls get explicit catches, and the clipboard bug above is fixed. | Commit `87a3d05`. Full desktop suite on this tree: build plus all 48 checks passed, `G:\Claude\Virtual Cut\test-runs\run-sCWb3L`.                                              |

Export receipts and Review acceptance keys never included frame indexes, so existing Done and
Accepted states are unchanged by the migration.

The inventory is now 48 maintained scripts (11 fast, 17 native, 20 desktop). Coverage was not
remeasured in this iteration; the 0.4.7 percentages in [coverage](coverage.md) are historical
for the changed files. Playback impact on long projects (actual dropped frames during
playback) is still unmeasured and is the input to VC-104.

Build: `G:\Claude\Virtual Cut\builds\Virtual-Cut-0.4.8-win-x64-2026-10-04T01-00-29-628Z\Virtual Cut.exe`.
Keep the folder together. It is an unsigned, uninstrumented Windows folder build.

Against this packaged build, nine selected scripts and their five native prerequisites passed:
shell smoke, project, feedback (frame stepping), filing and Library, save policy, recovery,
both transcript interfaces and the capacity check. Report:
`G:\Claude\Virtual Cut\packaged-checks\run-qzIBWc\report.json`.
