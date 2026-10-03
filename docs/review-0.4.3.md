# M3 current review — 0.4.3

October 3, 2026. Branch `m3-audio-intelligence`. M3 remains in review.

Build: `G:\GPT\Work\virtual-cut\review-0.4.3\builds\Virtual-Cut-0.4.3-win-x64-2026-10-03T06-59-45-661Z\Virtual Cut.exe`.

## Current review — 0.4.3

**Start here:** This update adds diagnostics and carries the 0.4.2 word-editor change. It does not fix the four transcript findings listed below, and does not claim the unexpected exit is solved. Your earlier checked results and callouts stay intact. The 0.4.1 recipes are retained as reference; you do not need to repeat the successful functional checks simply because their manual boxes are still empty.

### M312 — Your remaining interaction and listening review

- [ ] Try the word correction flow naturally: double-click a word, type a draft, then click another word. The old editor closes without saving the draft. A single click on the same word keeps its draft; double-clicking a different word opens that word's editor. Judge whether the selection, focus and editing behavior feels right.
- [ ] Judge the floating window, Follow playback, search/cue filters, toolbar separators and game/mic progress labels in your usual window sizes. Objective seeking/page-follow/typing behavior passed the agent review; this is your usability acceptance.
- [ ] Listen to representative game and microphone phrases and judge the word-seek anchors, proper nouns and cue usefulness. Note source, track and approximate time for misses. The paired-cue test used deliberately corrected text; it does not prove recognition of newly spoken Clip start/end. Known missing Cut/Note/Mark cases remain documented.

### M313 — Diagnostics and ordinary reopening

- [ ] Open Diagnostics: confirm the text report and Open logs are accessible. Continue normal transcript use. If the app disappears again, reopen it, save the diagnostic report and note the approximate time/action. Do not deliberately crash your working project; forced failures have engineering tests.
      The report now records both-window failures, redacted transcript operations and unfinished prior sessions. Native crash dumps stay locally in the crashes subfolder; they may contain memory data and are excluded from copied/saved text reports. No upload occurs. A forced termination or power loss can leave an unfinished session without a native dump. This is diagnostic evidence, not an automatic explanation of the cause.

### What the agent already covered against 0.4.1

- **M309 / M302:** import-file consent/settings inspection, real CUDA game/mic completion, separate job status and matching-result reuse. Folder and multi-file drag intake were not exercised in this desktop pass.
- **M310 / M303–M304:** word seek/correction/Escape, J/K/L typing guards, forward/reverse page following, later-page search, cue filters, manual-scroll suspension and Notes Go to staying open.
- **M311 / M305:** marker/note acceptance, explicit overlapping-clip Split targeting, Undo, rejection, unmatched-start blocking and corrected paired-clip acceptance with Undo/Redo. Four proposal/wording issues are ticketed below.
- **M306:** pause/resume passed. The attempted cancellation was too late; no desktop cancellation pass is claimed. Connor's existing first-pass job-lifecycle checks remain recorded separately.
- **M307:** saved originals/corrections/decisions/notes/clip/output survived full normal restart. Session Undo reset as designed.
- **M308:** source JSON/SRT and completed-clip offsets passed; companion hash stayed unchanged. This does not establish live Resolve subtitle import or every crossing-boundary/overlap case.

### Remaining objective checks, without repeating passed work

Actual folder/multi-file drop consent and active-job cancellation/retry still need a focused desktop pass when convenient. Wider long/noisy audio, clean-machine provisioning and live Resolve subtitle import have no new manual pass. Do not uninstall the working runtime to test setup failure. Speaker detection is unimplemented and last priority (VC-81); window search/scroll restoration remains VC-80. Context-aware agent correction remains M4.

### Findings queued for the next iteration

- [VC-82 — Paired clip title from either boundary](https://app.notion.com/p/3ee7c5227a8081df90d2de5bbaca5545). Workaround: enter the title before accepting an end-initiated pair.
- [VC-83 — Review context span separately from a concise title](https://app.notion.com/p/3ee7c5227a8081db9136dd432ccc4989). Do not trim continuation merely because speech pauses; preserve original context.
- [VC-84 — Deliberate Mark imperatives and false-positive guards](https://app.notion.com/p/3ee7c5227a80813fbbf5f19919f281a7). Reviewable candidates only.
- [VC-85 — Source versus completed-clip export wording](https://app.notion.com/p/3ee7c5227a80816baca2d8cee913beac). File timing passed; the dialog label/default name still needs correction.
- [VC-86 — Unexpected exit: capture and investigation](https://app.notion.com/p/3ee7c5227a80816a91b8f06b5b5d45c0). Capture is added in 0.4.3; the natural failure remains unexplained. The concurrent Codex update/console-host hang is correlation, not a confirmed cause.

## Logging implementation and limits

Both main and floating transcript windows record open/close, unresponsive/responsive,
load/preload errors, console error locations and renderer exit reasons. Transcript
requests log operation names and sanitized failure locations, never transcript text,
arguments or personal paths. Position updates and successful polling do not log.
Fatal main-process JavaScript errors use synchronous persistence; regular events retain
the existing bounded asynchronous queue. A per-process startup marker is removed on
actual quit. A later launch reports a dead process's leftover marker as unfinished,
without claiming to distinguish a crash from force-close or shutdown. First-run 0.4.3
cannot reconstruct a marker for the earlier 0.4.2 incident.

Electron Crashpad starts before either renderer, with upload disabled and no server.
Dumps live beneath the normal profile's diagnostics/crashes folder, separately from
redacted reports. On startup only, old recognized dump files are trimmed to five files,
128 MiB and seven days. Dumps less than one minute old are retained until a later launch;
unknown files and links are not removed. Text-log retention remains five 1 MiB files.
There is no continuous storage scan, process polling or model/GPU transcription job.

The fatal-write file is separate from any in-flight asynchronous writes. No arbitrary
renderer-to-filesystem bridge was introduced. A compiled stack location may be logged,
but error messages and user-controlled text are excluded. Native dumps can contain
process memory and need deliberate review before sharing.

## Evidence

Detailed prior desktop results: [0.4.2 agent review](review-0.4.2.md).
Historical full-suite coverage: 0.4.1, 84.88% lines / 78.49% functions / 78.16% branches.
Those percentages were not remeasured for 0.4.3.

- Build/type checks, lint and changed-file formatting passed.
- The delivered package passed `crash-diagnostics-checks.mjs`: a real forced transcript
  renderer crash produced a local dump and a window-specific event; normal quit cleared
  its marker; killing the isolated app process tree produced an unfinished-session event
  on restart. A separate fatal JavaScript process persisted its error classification.
  Text redaction, native-dump retention and disabled uploads passed.
- Development and final packaged `test:smoke` passed startup, production assets, bridge
  isolation, navigation/layouts, preferences, native folder handling and compact sizing.
- Focused transcript storage and floating-window checks passed seeking, corrections,
  Undo, phrase timing, reopen and IPC isolation. Native review/diagnostics and its UI
  checks passed redaction, Copy/Save/Open logs and compact layout. Those ran before the
  final text-clarity and console-location additions; the delivered package's crash and
  shell checks were rerun afterward. The inspected Diagnostics screenshot confirms
  content and actions fit the test window, without claiming human visual acceptance.
- All tests used disposable profiles and synthetic data in hidden windows. No GPU
  recognition or computer-use takeover was performed during Connor's OBS session.
- The first diagnostics test read the old session ID before the startup log flush.
  It was corrected to wait for the new ID; the recorded unfinished event itself was
  already correct. Failed evidence remains beside the passing runs.

Evidence roots:

- `G:\GPT\Work\virtual-cut\review-0.4.3\packaged-checks\crash-diagnostics-7NkGJM\report.json`
- `G:\GPT\Work\virtual-cut\review-0.4.3\packaged-smoke`
- `G:\GPT\Work\virtual-cut\review-0.4.3\focused\run-OkU30h\report.json`

This is a focused verification pass, not a fresh full-suite/coverage run. The natural
0.4.2 exit has not been reproduced or explained. The new capture starts with 0.4.3 and
cannot retrospectively recover a native dump for that earlier incident.
