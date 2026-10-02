# M3 review iteration — 0.4.1

October 2, 2026. Branch `m3-audio-intelligence`. M2 remains accepted. Keep your M301–M308
checks and comments; this pass focuses on reported refinements, not a full repeat.

Build: `G:\GPT\Work\virtual-cut\review-0.4.1\builds\Virtual-Cut-0.4.1-win-x64-2026-10-02T20-33-27-763Z\Virtual Cut.exe`.
Close the older app and keep the new package folder together. You can continue your current
schema-4 project or use `G:\GPT\Work\virtual-cut\review-0.4.0\sample-project\M3 Audio Review.vcut`.
Existing transcripts and corrections are preserved; changing the processing choice only
affects a new requested job. Recognition remains opt-in on each import.

## M309 — GPU choice, progress and setup

- [ ] Import files/folder or drop a batch: transcription starts unchecked. Once enabled, both
      game and microphone are selected. Set the actual microphone track, or choose game only.
      Automatic / NVIDIA / CPU should be available here and in later Transcribe requests.
- [ ] Request a new Automatic transcription. On this workstation, the completed recognition
      should show `large-v3` and `cuda`. Watch the separate game/mic recording status in Cut
      and Media, and the grouped work descriptions in Jobs. Media readiness and transcription
      progress should be distinct. Toolbar dividers should separate batch, import and job tools.
- [ ] In Transcript settings, check GPU readiness and the installation-help section. CPU
      remains available. Automatic explains CPU fallback if NVIDIA startup fails; explicit
      NVIDIA reports failure. Do not uninstall working dependencies just to test this—the
      missing-dependency cases have automated evidence.

Measured 475.1-second source: game CPU 181 s → GPU 46 s; mic 75 s → 11.5 s. Experimental
chunk batching reached 15 s / 7 s, but changes some text/anchors and is not enabled in the
app. See [measurement details](research/transcription-throughput-0.4.1.md).

This review package uses separately installed Python/model/GPU files. It is not a portable
speech installer. Setup now links to official instructions; managed installation remains
release work. No model stays loaded after the job.

## M310 — Transcript navigation

- [ ] Single-click a word: select and seek without opening the editor. Double-click: correct.
      Escape closes the editor. J/K/L controls the viewer from the transcript window except
      when typing or choosing values in a field. Existing K toggles pause/play.
- [ ] With **Follow playback** on, cross a page boundary in both directions on the game
      transcript. Search, cue filtering, manual paging, wheel browsing and editing suspend
      following; resume it with the button. The visible word should stay in view.
- [ ] Filter all/pending/accepted/rejected cues. Candidates beyond the first page must appear.
      Accept/reject then Undo should update the filtered list.
- [ ] Open Notes, use a timed note's Go to, and confirm the notes panel stays open.

## M311 — Reviewed spoken edits

- [ ] Review a **Split** cue (the older **Cut** wording still works). Adjust its seconds before
      accepting. Where clips overlap, choose the intended clip; only that clip should split.
- [ ] On disposable material, try **Clip start** / **Clip end** (or **Clip in** / **Clip out**).
      Review the proposed start/end and title together, then accept. One clip and two linked
      decisions should be created; one Undo removes the whole acceptance. An end can initiate
      the same review as its matching start.
- [ ] Missing/repeated boundaries should remain unresolved. Nothing should silently become a
      clip. If recognition missed a cue, a manual phrase correction can recover it while
      retaining the original speech. The supplied old recording does not deliberately use
      the new paired vocabulary, so a new recording or explicit test correction is needed.
- [ ] Save/reopen after a correction or cue decision. Original recognition, accepted timing
      and your existing project work should remain.

## Still outstanding

Finish untested first-pass M305/M306/M308 checks (complete cue review/dedup, pause/resume,
completed-clip transcript offsets and companion preservation). Known acoustic misses still
need listening review. Optional speaker detection is last priority. Window search/selection
restoration, portable speech provisioning and wider audio validation remain M3 follow-ups.
Context-aware agent corrections remain early M4; Connections/story tools remain M5.

All 44 maintained scripts pass; current coverage is 84.88% lines / 78.49% functions / 78.16%
branches across 85 files, with all fifteen unchanged critical-module floors passing. The real
packaged app found the configured GPU runtime and completed the copied 475.1-second game track
with 963 words. Packaged transcript/shell checks pass separately. Compact Media setup sections
also lose duplicate spacing so more height remains for the video.

Automated evidence and delivery commits are recorded in the Notion guide and
`G:\GPT\Work\virtual-cut\review-0.4.1\verification-summary.json`.
Synthetic behavior tests do not establish recognition accuracy; the real packaged job was
checked before the final CSS-only spacing correction.
