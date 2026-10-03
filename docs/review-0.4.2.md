# Transcript correction follow-up 0.4.2

October 2, 2026. Branch `m3-audio-intelligence`.

Clicking a different transcript word now closes the current correction editor and
selects/seeks the new word. Double-clicking opens that word for correction. Clicking
the same word preserves its draft. Corrections still require Save correction;
dismissing an editor does not save its unfinished text.

Build: `G:\GPT\Work\virtual-cut\review-0.4.2\builds\Virtual-Cut-0.4.2-win-x64-2026-10-03T05-39-38-284Z\Virtual Cut.exe`.
The rest of M309–M311 remains in [the 0.4.1 guide](review-0.4.1.md).

Build/type checks, lint, changed-file formatting and packaging passed. The requested
interaction was verified in the packaged 0.4.2 application. The 0.4.1 full-suite and
coverage results remain historical evidence; they were not rerun for this small change.

## Requested agent review

Connor requested this functional review and keeps subjective UI acceptance and all
manual review checkboxes. Future agent reviews require an explicit request.

The first pass used the actual 0.4.1 desktop application and a separate copy of the
prepared M3 project. It confirmed:

- Clicking the game transcript word at 7.998 seconds set the viewer to 7.998 seconds
  without opening correction.
- L started playback from the floating transcript and K paused it.
- Double-click opened word correction; Escape dismissed it.
- Saving the test correction Kai to Cai retained the original Kai in the word's
  recognition information.
- Typing L in transcript search entered text and left the viewer paused at 7.998
  seconds.

Connor subsequently confirmed he was away and authorized resuming desktop use.
The resumed pass used 0.4.2 with the same disposable project. The following results
are observed application behavior, separate from automated tests and manual acceptance.

### Verified in 0.4.2

- **Word editing:** clicking the same word kept its unfinished draft; clicking a
  different word dismissed the editor without saving that draft and sought the new
  word. Double-clicking the new word opened its own correction editor. The saved
  Kai → Cai correction and original Kai remained after restarting the app.
- **GPU jobs:** a request for game and microphone separately produced CUDA results:
  963 game words in 41 seconds and 160 microphone words in 12 seconds for the
  475-second Headset fixture. These are job durations on this machine, not a controlled
  benchmark. Pausing game recognition stopped it with an interrupted state; Resume
  from start completed it. The microphone job progressed while game was paused.
  Jobs grouped the two tracks under their recording and retained the older CPU results.
- **Import options:** opening Import files offered transcription unchecked by default;
  opting in exposed separate game/microphone processing, language and device choices.
  The runtime setup panel showed the installed files, NVIDIA readiness and setup help.
  A repeat request after reopening reused the existing matching results without adding
  transcription jobs or changing the reviewed cues.
- **Transcript navigation:** Follow playback crossed the game transcript's page boundary
  in forward playback and reverse scanning. Manual scrolling disabled following;
  searching Anna found three phrases beyond the initial page. Enabling Follow playback
  cleared the search and restored the full transcript.
- **Cue review:** pending, accepted and rejected filters reflected decisions. A reviewed
  marker was created at 51.070 seconds. Moving a Split candidate to 55 seconds required
  an explicit target among overlapping clips; selecting Example overlap B split only
  that clip. One Undo restored it and reset the decision. Rejecting the candidate was
  reflected in the rejected filter.
- **Timed notes:** accepting the note at 456.766 seconds added it to Notes. Go to sought
  that position while leaving Notes open.
- **Paired clip:** an unmatched start was blocked. Two deliberately corrected test
  phrases formed a start/end pair while retaining their original recognition. Reviewing
  the title and adjusting boundaries to 2–6 seconds created one clip and accepted both
  cues. One Undo removed the clip and reset both decisions; Redo restored them.
  This synthetic wording tests functionality, not speech-recognition accuracy.
- **Exports:** the short clip completed as a verified 2.000–6.167-second output. Source
  JSON kept original Kai and corrected Cai; source SRT used Cai at 7.998–8.378 seconds.
  Completed-clip JSON and SRT shifted the first phrase from source 3.550–6.110 to
  clip 1.550–4.110 seconds. The video's `.vcut.json` SHA-256 was identical before and
  after transcript export.
- **Save/reopen:** the new clip, marker, phrase corrections, accepted/rejected decisions,
  timed note and completed output remained after a manual save and full app restart.
  Undo was empty after restart, as intended. The test project was left paused.

### Findings for the next iteration

1. **Paired clip title depends on which boundary is used.** Opening the end candidate
   for the test phrase `Clip start Agent review pair` / `Clip end` correctly supplied
   the range but left its title blank; the start candidate supplied the title. The UI
   initializes text from the current cue (`TranscriptCue.tsx`); `cuePartner` carries
   only the other boundary's ID/time. Carry the start title into either boundary's
   editor, while preserving a manually reviewed title. The current workaround is to
   enter the title before accepting, which passed.
2. **Cue text can absorb several later thoughts.** The marker at 51.070 accumulated
   unrelated recognized phrases through 4:58. The store intentionally collects until
   the next recognized cue (up to 200 phrases/9,000 characters), honoring the requirement
   that silence alone must not end an explicit note. This is a proposal-boundary/UX
   refinement, not lost transcript data. Add a way to review the included span and a
   separate concise title while retaining the complete original context; do not silently
   impose a short silence cutoff.
3. **The conservative cue guard also suppresses an imperative.** The observed phrase
   `Mark, can I get a note from Anna about the qualifier match?` was not a candidate.
   `cueCandidate` excludes every cue whose following text starts with `can`, to avoid
   ordinary speech such as names. Test deliberate punctuation and phrase patterns before
   changing this guard; false positives must remain reviewable candidates, never actions.
4. **Export dialog wording:** completed-clip timing produced correct files, but the
   native dialog still said “Export source transcript” and suggested a generic
   `transcript-game` filename. Reflect the selected timing scope in that label/default.

### Limits and evidence

Cancellation was attempted too late for the short microphone job: it had already
completed. It is **not verified** by this pass. Actual folder/drop intake, missing
runtime on a clean machine, crash/forced-exit recovery, optional speaker detection,
long-recording load, broader audio quality and Resolve subtitle import were not
tested here. Phrase/page navigation while actively editing was not exhaustively
retested. Existing automated checks are separate evidence, not substitutes for these
remaining desktop scenarios. No subjective UI, acoustic accuracy or milestone
acceptance is claimed; manual checkboxes remain Connor's.

Evidence: `G:\GPT\Work\virtual-cut\review-0.4.1\agent-review-2026-10-02`.
Numbered accessibility captures record the actions; `output` contains source/clip
JSON and SRT and the verified short video with its companion. The disposable project
is `Agent Review.vcut` (in-app name Agent Review 0.4.1). Source recordings were not
edited. Computer-use focus/reference errors in native dialogs are tool limitations,
not app failures. The interrupted initial word-switch test was repeated independently
after Connor authorized resuming the desktop.
