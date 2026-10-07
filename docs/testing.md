# Regression gates

`scripts/test-inventory.mjs` is the maintained inventory. Version 0.4.8 has eleven fast, seventeen native and twenty desktop scripts (48 total); `project-capacity-checks.mjs` guards long-project save/reopen and snapshot cost. `npm run lint` includes type-aware promise checks. New test/check files must be classified or the runner fails. Historical sample walkthroughs and measurements needing copied real footage remain explicitly listed outside automatic gates.

The [M2 closeout](m2-closeout.md) records final acceptance and follow-ups. Current measured results and module gates are in [coverage](coverage.md); version-specific sections below preserve historical evidence. Closeout expands the existing deletion test with ownership/schema rejection, pending writes, lock contention, unavailable peers, linked ancestors and referenced-project protection. Storage tests report unavailable or linked locations honestly. These use disposable files and do not alter app behavior.

| Command                                                       | Gate                                                                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                    | Build/type checks, lint, Prettier format check, eleven fast synthetic test files                                                                                 |
| `npm run test:native`                                         | Build and seventeen native media/persistence/export/filmstrip/review/transcript/setup scripts, using Electron's SQLite runtime                                   |
| `npm run test:desktop`                                        | Fast, native prerequisites and twenty actual Electron interaction scripts, including shell security, playback, trim, autosave, filmstrip, export and transcripts |
| `npm run test:packaged`                                       | Same maintained checks; UI launches `VIRTUAL_CUT_TEST_EXECUTABLE` and media prerequisites use its bundled tools                                                  |
| `npm run test:suite -- desktop --only=review-planning-ui.mjs` | A focused check plus its fresh native fixture prerequisite                                                                                                       |

The Windows GitHub workflow runs build/lint/fast checks followed by measured native/desktop coverage with synthetic media. Packaged and human hardware/Resolve checks are separate. The workflow uses the official [checkout](https://github.com/actions/checkout), [Node setup](https://github.com/actions/setup-node), and [artifact upload](https://github.com/actions/upload-artifact) actions. A first hosted run is still required after publishing the branch.

## Speed

The full desktop gate took about 28 minutes until October 2026, and now takes about 6.
Desktop checks run with `--background-test`, so their windows are never shown. A window that
is never shown draws no frames, and Chromium then acknowledged each automated mouse event only
after a one-second fallback: an 8-step drag took 8 s and a click 2 s. In that mode the app
subscribes to frames once each page loads (`electron/main.cts`), so the windows stay hidden but
draw like visible ones. This costs at most about 18% of one core during a full-window redraw on
every frame; normal launches are unaffected.

Desktop checks import `expect` from `scripts/desktop-expect.mjs`. It is Playwright's `expect`,
except that `expect.poll` retries every 100 ms instead of backing off to once per second, so a
condition that turns true at 1.05 s is no longer seen only at 1.85 s. Assertions and timeouts are
unchanged.

Media tools (FFmpeg/FFprobe) run directly on Windows instead of through a guardian Electron
process, saving about 40 ms and 40 MB per call. They rely on Windows stopping them when Virtual
Cut exits or crashes, because Node places each child in a kill-on-close job.
`export-native-checks.mjs` guards that assumption: it force-kills a process that started a long
FFmpeg through the app's launcher and requires FFmpeg to stop.

Fixed waits remain only where the wait is the assertion: proving that nothing saves during
continuous seeking, a held scrub, playback or reverse scanning takes longer than the two-second
settle delay. To find where a check spends its time, run it with `DEBUG=pw:api`, which logs
every Playwright action with a timestamp.

## Prerequisites and evidence

The 0.4.7 setup checks cover download hash/size rejection, no-download folder planning,
partial cancellation, archive traversal, unrelated-file preservation, activation refusal,
compact/keyboard controls and app exit during a pending download. By default these use
bounded synthetic files. `VIRTUAL_CUT_VERIFY_SPEECH_INSTALL=1` explicitly adds the full pinned
download, library validation, actual CUDA model dispatch, activation/rollback and persisted
candidate checks in a disposable G: folder. It is not enabled on ordinary CI runs.

The existing transcript review gate now sends continuous positions with delayed native
page lookups in both directions, plays real synthetic source media across a page boundary,
and changes cue filters while a lookup is pending. The red reproduction remains recorded.
Crash tests collect coverage before intentional renderer/main failure; the original failed
collector attempt is retained rather than reported as a product crash fix.

The final 0.4.7 run has passing evidence for all 47 maintained scripts across the broad
run and a focused feedback retry. That retry corrects a legacy assertion to check Redo
after undoing the first edit of a reopened project; it does not change application history.
Source fingerprints/maps match before coverage reconciliation, and all fifteen unchanged
floors pass. Seven selected final-package scripts plus build also pass. See
[0.4.7 review/evidence](review-0.4.7.md) and [coverage](coverage.md) for original failures,
exact reports and measurement boundaries.

`scripts/cue-accuracy-study.mjs` scores spoken-cue recognition against labelled recordings
(`G:\VC Audio Cues` by default: each recording with a `.txt` of what was said and when). It copies
each recording, runs the app's own import, local recognition and cue logic, and reports cues found,
timing error, Note wording, false triggers and per-phrase word error rate. It needs a local speech
engine (`VIRTUAL_CUT_ASR_RUNTIME` pointing at a `transcription-runtime.json`, read only) and is not
part of the automatic gates.

`scripts/intent-score.mjs` scores proposals and the user's decisions against tagged mic notes (each
line tagged `{marker}`, `{general}`, `{notion}` or `{edit}`, Splits with where they should cut). It
reads a `get_proposal_decisions` answer, a saved `submit_proposals` run or a mic transcript, and
reports per intent: tagged lines covered, proposals on tagged speech, accepted and rejected, Split
cut points against their targets, and false proposals. The notes format is in
`electron/intent-notes.ts`; `intent-score.test.mjs` in the fast gate covers the reader and scoring.

M3 adds context inheritance, immutable transcript storage, corrections, cue actions, silence offsets, pagination/search, checkpoint recovery, cancellation/retry and separate-window IPC/layout checks. The maintained storage test uses a synthetic worker boundary; it is not recognition-accuracy evidence. Explicit real-model worker/native/sample scripts remain classified outside CI and need copied audio plus an installed runtime. Their measured results and known recognition errors are in [M3 review](m3-review.md). Python-worker execution is not included in Istanbul's JavaScript/TypeScript percentage.

Use the repository's Node/npm dependencies. Native and desktop gates need FFmpeg and FFprobe on PATH (or the documented tool overrides); packaged checks require both binaries in `resources/tools` beside the executable. Fixture preparation runs under the repository Electron runtime; application checks run the packaged executable. Packaged tests do not silently substitute the installed application for a missing executable.

Each invocation creates an isolated `run-*` under `G:\GPT\Work\virtual-cut\test-runs`. Override `VIRTUAL_CUT_SUITE_OUTPUT` on other machines (CI uses its temporary workspace). `VIRTUAL_CUT_TEST_ROOT` is set by the runner for all fixture-producing/consuming scripts. TEMP/TMP are scoped to that run. Direct legacy wrappers continue to use their original G: scratch defaults.

`report.json` and `report.md` record app/commit/dirty state, runtime/tool versions, each script's status and duration, and explicit prerequisite skips. Logs are capped at 2 MiB per script. Exit 0 means all selected checks passed; 1 is a failure; 2 is incomplete because a prerequisite was missing. Dependencies are generated within the same run and cannot silently reuse yesterday's fixture. A ten-minute per-script timeout stops the runner's own child process tree. Five completed, explicitly marked run directories are retained; other folders and unfinished runs are untouched. Preserve needed evidence outside these disposable run folders.

The fast gate uses no personal media. Native gates generate synthetic sources, including a small 140-second filmstrip fixture. Set `VIRTUAL_CUT_FILMSTRIP_REAL_FIXTURE` to a disposable copy of longer footage for an additional real-codec filmstrip run; the default does not depend on a developer's old local footage. Desktop tests use disposable profiles. Long real-footage and Resolve acceptance still require the review guide. Ordinary runs are scenario checks. The opt-in measured run is documented in [application coverage](coverage.md); VC-51 owns the remaining fault/recovery/production gates.

The 0.3.11 recovery gates add forced process termination with an unfinished transaction, migration backup/restore, checkpoint retention, corrupt/future schema handling, locks, separate-file recovery and failed project-switch cleanup. See [project recovery](project-recovery.md). The desktop gate includes the native picker/recovery flows with wide/compact keyboard checks.

The 0.3.12 save-policy gates cover interval defaults, activity deferral, optional saving after edits, navigation exclusion, session-only Undo, preservation of native facts, zero SQLite writes for staged edits, compact rolling-copy conversion, corrupt-copy preservation, and failed-save retry. The Electron check advances wall time while retaining real media/event timers; it checks the actual disk state, pending edits and settings, including compact keyboard focus. Process-interruption recovery now checks that unsaved session edits are lost and the last saved state is retained. See [save policy and measurements](save-policy.md).

## Version 0.3.13 additions

Filing gates check frozen accepted revisions, duplicate submission, unchanged original hashes, full copied packet timing, annotation/date verification, cancellation, a destination junction swap after planning, output collision preservation, partial publication and actual forced writer termination. Retry reconciles the same verified pair and removes only its private stages. Library gates cover offline originals, full output/companion verification, matching-pair relink and reopen. Electron gates cover search, marker seeking, queue progress/Done, compact keyboard focus and Review-to-Cut playhead preservation.

The Resolve helper has Python reconciliation/rollback/ownership tests and a native installation-preservation check. Python 3 is required for that gate (set `VIRTUAL_CUT_PYTHON` when needed); the CI environment must provide it. A separate generated 60 fps fixture was checked with the live Resolve 21.1 SDK and actual helper window; this remains separate from the maintained synthetic suite and Connor's manual production review. No whole-application coverage percentage is claimed; VC-50 remains open.

## Version 0.3.16 additions

The eighth fast script checks date/name sorting, both grouping modes, deterministic/missing dates, multiple completed revisions, current Done location selection and draft preservation. Review and Library desktop gates exercise global interleaved groups, unchanged saved edits, verified external relink and reopen, stable focused typing/viewer identity during regrouping, native Explorer paths and wide/compact Handoff controls. Native helper checks cover missing/unmanaged/current/outdated/customized states, update backups, confirmed owned removal, invalid ownership metadata and link/directory preservation; Python reconciliation tests remain included. Code coverage measurement stays separate under VC-50.

## Version 0.3.18 additions

Two maintained scripts cover range marker native persistence/export and real Electron interaction/layout. Existing marker tests cover movement, clipping and overlap lanes; helper tests include duration conversion, idempotency, user-edited duration protection and explicit variable-rate conflicts. Filing checks measure verified preview revisit reuse; Library UI asserts reuse of the same overview URL after a clip switch. Native/export checks verify version 4 companions and legacy receipt compatibility. See [0.3.18 review notes](review-0.3.18.md) for manual acceptance boundaries.

## Version 0.3.17 additions

Native Library checks inspect verified outputs with originals offline, exercise keyframe extraction, nonzero/silent/no-audio waveforms and cancellation, and compare output/companion hashes and dates. No additional script is added to the inventory. Library Electron checks cover first-load filmstrip, game waveform, embedded audio, zoom/reset, immediate J/K/L, relink, compact layout and full-page Handoff helper controls. Marker tests check that the retimed selected card remains inside the inspector. Six Python helper cases include explicit generated-anchor removal, genuine/edited/legacy preservation, idempotency and full rollback after anchor deletion. Export gates validate version 3 companions and retain legacy annotation compatibility.

The generated MP4 experiment under `G:\GPT\Work\virtual-cut\review-0.3.17\chapter-check` confirms a delayed chapter at 1 second becomes zero without an anchor. Actual Resolve import/Check/Apply acceptance for the new cleanup is a manual review item; synthetic helper tests do not replace it. Code coverage remains unmeasured under VC-50.

## Version 0.3.19 additions

Existing marker timing checks cover the screen-space snapping threshold at full and zoomed extents and disabled/zero-width cases. The range desktop gate adds actual clip start/end, range start/end/body and point-marker magnetic gestures, frozen targets, disabled snapping, persistence of the toggle, zoom, invalid-edge constraints, Escape and Undo. Alt-drag with Manipulate off, thin text-free bands and wide/compact controls are checked. Library desktop verification waits for a complete cached overview and observes placeholder mutations through a verified revisit, as well as checking unchanged cached image URLs. These are scenario checks; renderer/native code coverage remains unmeasured under VC-50.

## Version 0.3.20 additions

The range desktop gate asserts stationary video time at pointer-down, during movement and after release/save across all snapping gestures. It exercises H-mode Alt conversion shapes during/after capture, selection/deselection versus double-click seeking, H-mode double-click, keyboard retiming, ruler/filmstrip scrubbing, exact-position input validation/cancel/focus and compact layout. Timeline unit checks cover elapsed-time parsing/rounding and bounded, spaced labels for compact, zoomed and long recordings. Existing feedback and zoom checks target the explicit seeking surface. Coverage measurement remains a separate VC-50 task.

## Version 0.3.22 additions

The 0.3.22 follow-up adds native and Electron project deletion checks: preserve sources/exports/companions, retain unknown/shared/linked files and locked saves, reject stale previews, exercise both deletion choices and Cancel, and save/close an active project. Existing range checks cover peer point/range/clip snapping with a stationary playhead. Review and filing checks cover Trim, initially visible Tree, destination links and nowrap timings. Nine Python helper tests now include recursive bin discovery, duplicate-path lookup/verification reuse and all five supported export containers. These focused runs do not remeasure full application coverage.

## Version 0.3.21 additions

VC-50 adds opt-in source-level renderer/native coverage, missing-collector failures, untouched-file inventory, HTML/JSON/LCOV reports and measured critical-module gates. See [coverage methodology and baseline](coverage.md). The ninth fast script proves uncovered branches fail thresholds and missing processes cannot silently pass. Save validation cases cover orphan markers, invalid audio roles/pins, stale edits and concurrent imported records.

The range interaction check covers keyboard-accessible time/frame icons, exact frame entry and cancellation, Position/ruler spacing, and scrubbing snap to every point/range/clip boundary with H on/off, zoomed and on the filmstrip. Existing compact Library and four-overlap Cut checks retain their viewer-size assertions. Close/reopen checks collect coverage before native window close and still exercise actual save-on-close behavior. Packaged builds always rebuild without instrumentation.
