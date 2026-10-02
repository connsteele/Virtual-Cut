# Regression gates

`scripts/test-inventory.mjs` is the maintained inventory. Version 0.3.21 has nine fast, thirteen native and fifteen desktop scripts (37 total). New test/check files must be classified or the runner fails. Historical sample walkthroughs and measurements needing copied real footage remain explicitly listed outside automatic gates.

| Command                                                       | Gate                                                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                                                    | Build/type checks, lint, nine fast synthetic test files                                                                                                      |
| `npm run test:native`                                         | Build and thirteen native media/persistence/export/filmstrip/review scripts, using Electron's SQLite runtime                                                 |
| `npm run test:desktop`                                        | Fast, native prerequisites and fifteen actual Electron interaction scripts, including shell security, playback, trim, autosave, filmstrip, export and review |
| `npm run test:packaged`                                       | Same maintained checks; UI launches `VIRTUAL_CUT_TEST_EXECUTABLE` and media prerequisites use its bundled tools                                              |
| `npm run test:suite -- desktop --only=review-planning-ui.mjs` | A focused check plus its fresh native fixture prerequisite                                                                                                   |

The Windows GitHub workflow runs build/lint/fast checks followed by measured native/desktop coverage with synthetic media. Packaged and human hardware/Resolve checks are separate. The workflow uses the official [checkout](https://github.com/actions/checkout), [Node setup](https://github.com/actions/setup-node), and [artifact upload](https://github.com/actions/upload-artifact) actions. A first hosted run is still required after publishing the branch.

## Prerequisites and evidence

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

## Version 0.3.21 additions

VC-50 adds opt-in source-level renderer/native coverage, missing-collector failures, untouched-file inventory, HTML/JSON/LCOV reports and measured critical-module gates. See [coverage methodology and baseline](coverage.md). The ninth fast script proves uncovered branches fail thresholds and missing processes cannot silently pass. Save validation cases cover orphan markers, invalid audio roles/pins, stale edits and concurrent imported records.

The range interaction check covers keyboard-accessible time/frame icons, exact frame entry and cancellation, Position/ruler spacing, and scrubbing snap to every point/range/clip boundary with H on/off, zoomed and on the filmstrip. Existing compact Library and four-overlap Cut checks retain their viewer-size assertions. Close/reopen checks collect coverage before native window close and still exercise actual save-on-close behavior. Packaged builds always rebuild without instrumentation.
