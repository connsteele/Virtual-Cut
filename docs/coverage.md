# Application coverage

Run `npm run test:coverage` on Windows with Node 22.15+ (for synchronous module hooks), the repository dependencies, Python 3, FFmpeg and FFprobe. Outputs go into the suite's owned G: run directory; override `VIRTUAL_CUT_SUITE_OUTPUT` elsewhere. Coverage is opt-in and packaging refuses an instrumented build. A normal build removes instrumentation from emitted application modules.

## Final M2 baseline — 0.3.23, October 2, 2026

All **39 maintained scripts passed** in the full current-source run. The expanded deletion/storage safety check then passed in an explicit measured follow-up. The reconciled report is **complete** across **73 application source files**, with **all eleven critical-module gates passing**. The original nine floors are unchanged; cleanup and storage now have measured floors too.

| Area     |                  Lines |              Functions |               Branches |
| -------- | ---------------------: | ---------------------: | ---------------------: |
| Renderer |     79.83% (2728/3417) |      71.35% (994/1393) |     75.77% (2678/3534) |
| Native   |     92.25% (2643/2865) |       92.35% (664/719) |     81.84% (1781/2176) |
| Combined | **85.49% (5371/6282)** | **78.50% (1658/2112)** | **78.09% (4459/5710)** |

Reports: `G:\GPT\Work\virtual-cut\m2-closeout\coverage-baseline\combined\index.html`, with renderer/native drill-down, `summary.json` and `reconciled-tests.json` alongside. Input runs are `coverage\run-LyXaCX` and `safety-coverage\run-Xl5kYw` beneath the closeout folder. Application source fingerprints and counter maps are identical. The latest deletion check replaces its earlier passing attempt; other full-run counters remain. Both attempts are recorded. This pass had no failed scripts, prerequisite skips or missing collectors.

The two intentionally terminated filing/recovery workers retain conservative partial counters; their parent recovery scenarios passed. The range interaction script completed in 464 seconds under instrumentation. It was slow, not deadlocked; coverage timing is not an app-performance measurement.

| Critical module                    |  Lines | Functions | Branches |
| ---------------------------------- | -----: | --------: | -------: |
| Autosave policy                    |   100% |      100% |     100% |
| Workspace persistence coordination | 81.21% |    79.06% |   76.86% |
| Edit validation/merge              | 98.87% |      100% |   94.28% |
| Project store                      | 92.19% |      100% |   83.95% |
| Recovery                           | 91.22% |      100% |   73.21% |
| Project/filing service             | 93.37% |    94.66% |   82.71% |
| Export/packet verification         | 90.11% |    97.14% |   78.14% |
| Destination validation             | 93.68% |    94.44% |   84.81% |
| Acceptance revision state          |   100% |      100% |     100% |
| Project deletion                   | 96.80% |    95.83% |   84.21% |
| Storage accounting                 | 98.30% |    91.66% |   92.68% |

New safety scenarios prove preservation/rejection for foreign, corrupt and future-version saves; pending database writes; changed identity; a writer lock acquired after planning; unavailable peer projects; linked ancestors; and a project referenced as media. Storage checks cover incomplete and linked locations. Floors for deletion are 95/95/84 (lines/functions/branches); storage is 98/90/90. These preserve the measured behavioral baseline without requiring 100% of defensive branches.

Remaining gaps include rare filesystem races during deletion, unusual malformed records, some permission/disk-full paths, packet-clock fallback branches and less-used renderer error/prototype UI. A high percentage does not establish those cases, all codecs, or every Resolve version. Meaningful protection assertions remain the gate. No additional app behavior changed; the normal uninstrumented build and lint pass, and the accepted 0.3.23 package remains current. M2 acceptance and explicit follow-ups are in [closeout](m2-closeout.md). First hosted CI is still pending authorized publication.

## Historical 0.3.21 baseline

All 37 maintained scripts have passing evidence across the full run and explicit corrected runs. The reconciled report is **complete**, with all nine critical-module gates passing and 70 application source files inventoried.

| Area     |              Lines |          Functions |           Branches |
| -------- | -----------------: | -----------------: | -----------------: |
| Renderer | 78.83% (2634/3341) |  69.67% (935/1342) | 75.49% (2612/3460) |
| Native   | 91.74% (2423/2641) |   91.75% (612/667) | 81.43% (1658/2036) |
| Combined | 84.53% (5057/5982) | 77.00% (1547/2009) | 77.69% (4270/5496) |

Local report: `G:\GPT\Work\virtual-cut\review-0.3.21\coverage-baseline\combined\index.html`; corresponding `renderer` and `native` directories provide separate drill-down. `summary.json` and `reconciled-tests.json` record the exact runs and correction history. The first full pass caught compact Library/four-overlap Cut layout regressions and missing snapshots before native window close. These were fixed and rerun without weakening assertions. Original failed reports remain. Application TS fingerprints/counter maps match across the reconciled attempts; only layout CSS and test collection changed.

The forced filing-writer and transaction-crash processes retain conservative partial snapshots; the parent recovery scenarios completed and passed. These partial tails are listed explicitly. Renderer unload-only execution is not claimed as covered.

### Critical areas and remaining holes

| Module                             |  Lines | Functions | Branches |
| ---------------------------------- | -----: | --------: | -------: |
| Autosave policy                    |   100% |      100% |     100% |
| Workspace persistence coordination | 75.12% |    74.41% |   76.11% |
| Edit validation/merge              | 98.87% |      100% |   94.28% |
| Project store                      | 92.19% |      100% |   83.95% |
| Recovery                           | 90.65% |      100% |   70.83% |
| Project/filing service             | 93.17% |    94.49% |   82.62% |
| Export/packet verification         | 90.11% |    97.14% |   78.14% |
| Destination validation             | 93.68% |    94.44% |   84.81% |
| Acceptance revision state          |   100% |      100% |     100% |

Uncovered native cases include some malformed packet clocks, missing packet durations, insufficient-space/permissions errors, rare corrupt-record/schema combinations and defensive compaction mismatch checks. Save validation gained meaningful invalid-reference/stale-edit/concurrent-import cases during this pass. Lower renderer coverage includes the retained prototype UI and less-used error/dialog paths. Percentages do not prove all codecs, storage failures or real Resolve behavior. VC-26 and the remaining manual compatibility/recovery checks remain separate; the first hosted CI run is pending an authorized push.

## What is measured

The maintained fast/native/desktop suite uses generated media and isolated profiles. Istanbul instruments original TypeScript/TSX before compilation, so statement/function/branch locations already refer to the checked-in source; compiled helpers and minified bundle offsets are not counted as application lines. The same instrumentation is used for unit module loading, renderer bundling and native compilation. [Istanbul instrumentation API](https://github.com/istanbuljs/istanbuljs/blob/main/packages/istanbul-lib-instrument/api.md).

Every executable file under `src` and `electron` is included, even if never imported during tests. Type-only files remain inventoried with zero executable counters. Tests, scripts, dependencies, generated assets, declarations, CSS and the separately tested Python Resolve helper are outside these TypeScript totals. Prototype/sample UI under `src` remains in the denominator. This is application JS/TS coverage, not total product, media-codec or Resolve coverage.

`coverage/renderer/index.html` and `coverage/native/index.html` give separate line/function/branch drill-down. `coverage/combined/index.html` combines comparable counters from the same instrumentation. Each also has JSON and LCOV. The canonical `coverage/summary.json` records status, suite source, errors and partial process snapshots. A focused run is labelled **focused**, never a full-suite baseline. Failed collection/test runs are diagnostic only, even when HTML shows percentages.

Desktop launches record expected main/renderer/isolated-preload collectors; all must produce nonempty final snapshots. Unit/native test groups also require completed nonempty coverage. Missing collectors fail the run. Native worker counters are periodically retained and finalized on exit; intentionally terminated recovery workers may retain only a conservative partial snapshot. Main-process final snapshots replace periodic copies. Test failures and prerequisite skips prevent a complete baseline.

## Regression limits

Critical-module limits live in `scripts/coverage-gates.json`. They are measured floors for save/edit validation, acceptance revisions, export verification, path/collision checks and recovery, rather than a whole-app percentage target. They apply to a complete maintained inventory; focused subsets are explicitly labelled and do not claim to satisfy full-suite floors. Do not lower a floor to hide a regression: inspect uncovered branches and add a meaningful scenario or explain a changed denominator in review.

The coverage pipeline test executes only one arm of a real conditional and verifies that its 100% branch gate fails; its 50% gate passes. It also verifies that an untouched function remains at zero and missing main/renderer/preload/native collectors are rejected. These synthetic proof counters are excluded from the application baseline.

Coverage instrumentation adds test overhead. Do not interpret these runs as playback or save-performance benchmarks. Manual production-batch and hardware/Resolve acceptance remain separate.

## Explicit corrected runs

`node scripts/coverage-merge.mjs NEW_OUTPUT FULL_RUN RETRY_RUN` combines explicit attempts only when application source SHA-256 fingerprints and instrumentation maps are identical. The latest attempt of each check wins, including a failure; counters from superseded attempts are excluded. Process identities are scoped to their run. `reconciled-tests.json` retains original report paths and superseded results. Set `VIRTUAL_CUT_COVERAGE_GATES` to the absolute gate JSON path when producing the reconciled baseline. This is useful for CSS-only fixes or collector corrections; changed application TypeScript requires a fresh full run.

Renderer/preload snapshots are read immediately before the test closes a window. Main-process exit snapshots additionally cover shutdown. Unload-only renderer execution and abruptly terminated worker tails may be undercounted, never inferred as covered. The project reopen test explicitly collects before its native window-close action, preserving the actual close/save behavior being tested.
