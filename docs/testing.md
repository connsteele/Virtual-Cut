# Regression gates

`scripts/test-inventory.mjs` is the maintained inventory. New test/check files must be classified or the runner fails. Historical sample walkthroughs and measurements needing copied real footage remain explicitly listed outside automatic gates.

| Command                                                       | Gate                                                                                                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                    | Build/type checks, lint, six fast synthetic test files                                                                                                      |
| `npm run test:native`                                         | Build and eight native media/persistence/export/filmstrip/review scripts, using Electron's SQLite runtime                                                   |
| `npm run test:desktop`                                        | Fast, native prerequisites and eleven actual Electron interaction scripts, including shell security, playback, trim, autosave, filmstrip, export and review |
| `npm run test:packaged`                                       | Same maintained checks; UI launches `VIRTUAL_CUT_TEST_EXECUTABLE` and media prerequisites use its bundled tools                                             |
| `npm run test:suite -- desktop --only=review-planning-ui.mjs` | A focused check plus its fresh native fixture prerequisite                                                                                                  |

The Windows GitHub workflow runs build/lint/fast checks and native synthetic media gates. Packaged and human hardware/Resolve checks are separate. The workflow uses the official [checkout](https://github.com/actions/checkout), [Node setup](https://github.com/actions/setup-node), and [artifact upload](https://github.com/actions/upload-artifact) actions. A first hosted run is still required after publishing the branch.

## Prerequisites and evidence

Use the repository's Node/npm dependencies. Native and desktop gates need FFmpeg and FFprobe on PATH (or the documented tool overrides); packaged checks require both binaries in `resources/tools` beside the executable. Fixture preparation runs under the repository Electron runtime; application checks run the packaged executable. Packaged tests do not silently substitute the installed application for a missing executable.

Each invocation creates an isolated `run-*` under `G:\GPT\Work\virtual-cut\test-runs`. Override `VIRTUAL_CUT_SUITE_OUTPUT` on other machines (CI uses its temporary workspace). `VIRTUAL_CUT_TEST_ROOT` is set by the runner for all fixture-producing/consuming scripts. TEMP/TMP are scoped to that run. Direct legacy wrappers continue to use their original G: scratch defaults.

`report.json` and `report.md` record app/commit/dirty state, runtime/tool versions, each script's status and duration, and explicit prerequisite skips. Logs are capped at 2 MiB per script. Exit 0 means all selected checks passed; 1 is a failure; 2 is incomplete because a prerequisite was missing. Dependencies are generated within the same run and cannot silently reuse yesterday's fixture. A ten-minute per-script timeout stops the runner's own child process tree. Five completed, explicitly marked run directories are retained; other folders and unfinished runs are untouched. Preserve needed evidence outside these disposable run folders.

The fast gate uses no personal media. Native gates generate synthetic sources, including a small 140-second filmstrip fixture. Set `VIRTUAL_CUT_FILMSTRIP_REAL_FIXTURE` to a disposable copy of longer footage for an additional real-codec filmstrip run; the default does not depend on a developer's old local footage. Desktop tests use disposable profiles. Long real-footage and Resolve acceptance still require the review guide. Tests are not a code-coverage measurement: VC-50 owns the renderer/native baseline and VC-51 owns the remaining fault/recovery/production gates.
