# M3 review — 0.4.4

October 3, 2026. Branch `m3-audio-intelligence`. M3 remains in user review.

This iteration addresses independent transcript workflow findings while the last
manual review is unfinished. WhisperX/alignment and game-only speaker integration
are deferred to later M3. The production speech engine and models are unchanged.

Build: `G:\GPT\Work\virtual-cut\review-0.4.4\builds\Virtual-Cut-0.4.4-win-x64-2026-10-03T09-33-31-700Z\Virtual Cut.exe`.
The [Notion review guide](https://app.notion.com/p/3ea7c5227a80811d8931c928c47ff3ff)
preserves previous manual results alongside these additions.
Keep its folder together. The separately installed local speech runtime remains
required. Continue the existing schema-4 project. No new recognition job is needed
to review saved transcripts or these cue changes.

## M314 — Paired titles and included context (VC-82 / VC-83)

- [ ] Open a saved microphone Clip start/end pair from its end. Its title should
      match the start cue's title. Review or replace the title, accept from either
      boundary and check the resulting clip. Undo/Redo should reverse/restore the
      paired decision and clip together.
- [ ] Find a Mark or Note proposal that gathered too much later speech. Review
      its separate **Title**, **Context**, visible source span and **Include through**
      last-phrase choice. Seek to the included endpoint, shorten the included context,
      then edit its wording and accept. A marker should use the title as its name and
      context as its note. The original transcript remains readable with Original.
- [ ] Judge whether those controls are clear at your usual window size. Pauses
      alone do not shorten a proposal. Changing Include through refreshes the draft
      context from the chosen source phrases, so choose the endpoint before editing.

## M315 — Deliberate Mark wording and export scope (VC-84 / VC-85)

- [ ] Check the reported “Mark, can I get a note…” phrase in an existing microphone
      transcript. It should now offer a tentative marker for review. Ordinary references
      such as “Mark can win…” or a request addressed to Mark should remain ordinary
      speech. Report source/track/time for new misses or false candidates.
- [ ] Export a source transcript and a verified completed-clip transcript. Confirm
      the save dialog identifies the chosen scope and suggests its selected name,
      source/clip scope and audio role. Save to separate JSON/SRT files; the video
      companion is protected. Assess the wording, not another timing benchmark.

The Mark change tests recognition-text rules; it does not prove how well a newly
spoken phrase will be recognized. Candidates still require explicit acceptance.

## M316 — Close and reopen the transcript window (VC-80)

- [ ] Search or browse to a later page, select a word, scroll and close the floating
      window normally. Reopen Transcript in the same project: recognition, search,
      filter/page, highlighted word, Original option and scroll should return.
- [ ] An unfinished correction should close without being saved or reopened.
      Existing saved corrections remain. Closing/reopening the project or app starts
      a fresh reading session; this cache is not a persisted project edit.
- [ ] Judge the restored reading position and keyboard focus in your normal setup.

The cache holds at most eight recording views, with bounded search text and numeric
positions. It writes on a recording change or normal window close, never each
playhead movement or session poll. Transcript bodies, jobs and drafts are excluded.

## Previous review still open

M312–M313 in [0.4.3](review-0.4.3.md) remain the natural word-editor, interaction,
listening and diagnostic checks. Existing checkmarks and findings are retained in
Notion. No new computer-use agent review was performed this iteration.

The natural unexpected exit remains unexplained (VC-86); logging/dumps are
available for another occurrence. Remaining M3 work also includes representative
long/noisy audio, provisioning, Resolve subtitle acceptance and the deferred
speaker adapters. Context-aware agent correction remains early M4.

## Engineering evidence

Feature commits: `dea4f29` (VC-82), `8d1cee0` (VC-83), `77d9d4f` (VC-84),
`2bb839f` (VC-85), `70dfc4f` (VC-80). Separate logical commits; not pushed.

Focused checks cover raw-recognition preservation, stale context rejection,
bounded provenance, both paired boundaries, manual titles, Undo/Redo, ordinary
speech exclusions, export offsets/companion protection, native window reopening,
page/focus/scroll restoration and project lifetime reset. Hidden Electron tests use
synthetic disposable media and profiles. They are implementation checks, not a
fresh acoustic or subjective agent review.

Build/type checks, lint and changed-file formatting passed. All six selected checks
plus the build passed against the final package: transcript domain/native storage,
cue review, transcript correction/export/reopening, crash diagnostics and shell smoke.
Final report: `G:\GPT\Work\virtual-cut\review-0.4.4\packaged-checks\run-CVVP0x\report.json`.
No full-suite/coverage rerun or GPU benchmark is claimed; the 0.4.1 coverage figures
remain historical. Earlier failed test attempts are retained: one malformed-record
expectation, incorrect test control labels and forced page disposal were corrected.
The final state test uses the native window close lifecycle.
