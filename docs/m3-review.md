# M3 first review — 0.4.0

October 2, 2026. Branch: `m3-audio-intelligence`. M2 remains accepted. This is the first M3 implementation for manual review, not milestone acceptance.

## Start here

**Launch:** `G:\GPT\Work\virtual-cut\review-0.4.0\builds\Virtual-Cut-0.4.0-win-x64-2026-10-02T10-52-38-450Z\Virtual Cut.exe`.

The local folder build and the current Notion review guide identify the exact executable. Keep the package together. It references this workstation's existing Python runtime and cached Whisper large-v3 model; it does not download a model or provide a portable speech installer. CPU int8 with four threads is the validated setting. No model is loaded merely by opening the app or a saved transcript.

Open `G:\GPT\Work\virtual-cut\review-0.4.0\sample-project\M3 Audio Review.vcut` through Projects. This disposable review project already has three completed recognitions:

- Headset spoken cues: separate game and microphone results from the 7:55 recording.
- DJI microphone: retained real microphone audio in a clearly labeled solid-picture test video. The original DJI video was unavailable; this fixture assesses audio, not its original visual synchronization.
- Two overlapping headset clips around 00:45–01:15 for transcript-to-clip review. No cue has been accepted and no transcript correction has been pre-approved.

The headset video is a copy. Sources and all finished exports remain protected by the existing deletion policy. Schema 4 stores recognition separately from ordinary edit records and makes a verified pre-upgrade copy when opening an older project. Use the supplied review project first; older app versions cannot reopen a schema-4 project.

## M301 — Project and batch context (VC-53, VC-75)

- [ ] In Projects, expand **Project game and video brief**. Change the game, names/terms and optional video brief. Close the dialog and use **Batch context**.
- [ ] Check inheritance, a different game, unspecified/mixed games, appended/separate/no batch brief. “Using” should reflect the effective context. Undo and Save/reopen should retain your intended records.
- [ ] Context entry should never start recognition. A completed recognition retains the context revision used for that job; changing current context does not rewrite it.

Game terms are optional recognition hints when explicitly enabled for a job. They are not an agent correction pass. Automatic context-aware correction remains early M4, and the Connections/glossary/story interface remains M5.

## M302 — Import consent and later transcription (VC-79, VC-12)

- [ ] Try one-file import, several files dropped together and folder import in a separate disposable batch. **Transcribe this import locally** starts unchecked each time. Leaving it unchecked must import without recognition.
- [ ] Opt in once for the import. Choose game, microphone or both, language and optional vocabulary hints. Both roles should create separate results. Audio-track assignments must reflect the actual recording.
- [ ] Open **Transcript** for an existing recording and start recognition there. Repeating the same completed request should reuse it. Missing roles or unavailable runtime should produce a useful explanation.

English is the initial selection; automatic language detection is available. Vocabulary hints default off because they can also introduce expected words that were not spoken. Speaker detection is not implemented in this iteration (VC-81, optional last priority).

## M303 — Floating transcript and source seeking (VC-15, VC-80)

- [ ] Open Transcript from the headset recording. Move and resize its separate window; check it alongside the viewer. Switch between game and microphone recognition.
- [ ] Click individual words near the beginning, after a long silence and near a minute boundary. The word should highlight and the main viewer should seek to its source time. Listen to judge the acoustic alignment; the automated test checks delivery of the stored timestamp, not whether recognition aligned every word correctly.
- [ ] Play the viewer and observe active-word highlighting. Search a phrase, clear search and move between transcript pages. The game result has more than one page.
- [ ] Switch recordings with the transcript window open. Close/reopen the window and check that the correct recording/result is shown. An unavailable saved monitor position should reopen on a connected screen.

The main viewer retains playback shortcuts. This iteration has one floating transcript window and no docking.

## M304 — Correct names without losing recognition (VC-15)

- [ ] Around 00:51 on the headset microphone result, correct “Kai”/“Caster” to the intended names. One-word correction should keep its original anchor. The **Original** checkbox should still expose the original text.
- [ ] Edit an entire phrase to a different number of words. It should explicitly show phrase timing rather than inventing precise word positions. Restore the original, then test main-editor Undo/Redo.
- [ ] Search the corrected and original spellings. Save, close the project and reopen it: both originals and corrections should survive, with a fresh Undo session.

## M305 — Review spoken cues (VC-20, VC-23)

- [ ] Check tentative Mark, Note and Cut candidates on the **microphone** result. Game dialogue must not produce these actions. Read the full continuation before accepting.
- [ ] Accept a Mark, inspect its point marker and Undo it. Accept a Note, open Notes and use **Go to** to reach its source. Undo that note.
- [ ] Accept a Cut only where exactly one clip contains the point. It should split the editable plan and Undo cleanly. At overlapping clips it should explain the ambiguity instead of guessing.
- [ ] Around 03:47, recognition says “No, it’s nice…” where the recorded cue was Note. Correct that first word to Note and check that the candidate becomes available while the original remains intact.
- [ ] Review all candidates before applying. Repeating the same recognition should not create duplicate accepted actions. Reruns use a 0.5-second source/track/type tolerance; larger recognition shifts still need review.

**Known accuracy limits:** the confirmed Cut around 02:37 is absent from the current headset result. The Note around 03:47 is misrecognized. Proper nouns are also imperfect. The DJI tail contains a questionable “For me.” These are recognition limitations, not silent automatic actions. No precision/recall or word-error percentage is claimed without a labeled reference.

**Cut meaning:** the current action splits at the spoken cue anchor. Instructions such as “before this transition” preserve their text but require choosing the intended picture boundary manually. Relative visual interpretation belongs to agent work. A cue's original timestamp is retained in its decision; later manual marker/clip edits use the existing editing tools.

## M306 — Job lifecycle (VC-12, VC-23)

- [ ] Start an explicit job, pause it, then Resume. Pause stops its worker; Resume restarts that track. Cancel and retry should be clear and should not change completed originals.
- [ ] Close only the floating transcript window during a requested job. It should continue. Close the whole app: recognition must stop. Reopening must show interrupted work and require an explicit retry, without automatically loading the model.
- [ ] Check responsiveness while recognition is running. Saved transcript browsing should remain available after workers are off.

Recognition uses about 3.2 GiB peak worker memory in the observed CPU runs. Its temporary mono audio is removed after the job; cached model files remain reusable on disk. Diagnostics are local and bounded. The verified guard stops the worker and its child processes on completion, cancellation, failure and parent-process termination.

## M307 — Saves and recovery (VC-15, VC-23)

- [ ] Make a correction, a context edit and a reviewed cue action. Save/reopen and check all three plus original recognition. Ordinary playback should not create Undo entries or trigger rapid autosaves.
- [ ] In a disposable copy, use Save history to recover a checkpoint with transcript data. Existing immutable recognition should not be duplicated; missing checkpoint recognition should be restored.

Original recognition is in separate SQLite records, outside renderer workspace polling and Undo snapshots. Corrections and decisions are small edit records. Existing adjustable ten-minute autosave and session-only Undo remain in force.

## M308 — Transcript exports and clip links (VC-15)

- [ ] Export source JSON and SRT from Transcript. JSON should retain original text, approved corrections, source times and recognition provenance. SRT should use the selected displayed text.
- [ ] Inspect the overlapping clip links. After filing a completed clip, export its transcript and check offsets against the actual outward-cut output. A phrase crossing the clip boundary should not claim exact corrected word timing.
- [ ] Exporting JSON must not overwrite a `.vcut.json` companion. Opening/filing media and transcript export remain separate explicit operations.

Transcript JSON/SRT are included. Automatic reuse inside Resolve's native transcription database has not been established; the existing marker handoff remains separate.

## Observed local recognition performance

Whisper large-v3, faster-whisper 1.2.1, CTranslate2 4.8.2, CPU int8 / four threads, `utterance-v1`, English, hints off. These runs included other test activity and are not controlled comparative benchmarks. Worker elapsed time includes extraction/loading/recognition; source duration is the entire track, including silence.

| Recording/role     | Track duration | Processing | Words | Peak worker memory |
| ------------------ | -------------: | ---------: | ----: | -----------------: |
| Headset microphone |        475.1 s |     74.5 s |   160 |           3.19 GiB |
| Headset game       |        475.1 s |    181.2 s |   962 |           3.19 GiB |
| DJI microphone     |         60.6 s |     23.7 s |    99 |           3.19 GiB |

The first whole-stream speech-detection approach misplaced some words by tens of seconds on sparse microphone audio. The current implementation detects bounded utterances and recognizes them with their source offsets retained. This repairs that observed failure mode; individual word alignment still needs the listening checks above.

Evidence: `G:\GPT\Work\virtual-cut\review-0.4.0\review-fixture.json`, `worker-lifecycle\run-ENLRVH`, and the final maintained suite report linked from the Notion guide. Automated tests use synthetic behavior fixtures where indicated. Python speech-worker coverage is not part of the JavaScript/TypeScript Istanbul percentage.

The canonical vocabulary comparison (`vocabulary-study\run-D9zsQe`) changed Caster to Castor and the later Lita/Vandal to Leda/Vandahl, while Kai remained uncorrected. It did not recover the known missing Cut or the 03:47 Note. It also changed ordinary wording and changed the questionable DJI tail from “For me” to “Thank you for watching.” These observations support keeping hints opt-in; they do not establish a general accuracy gain.

## Automated evidence

All 43 maintained scripts pass. Final reconciled application coverage is 84.80% lines, 78.26% functions and 77.65% branches across 83 source files; all fifteen critical-module floors pass. The eleven M2 floors remain unchanged. Real worker lifetime checks and a fresh recognition job through the normal packaged app pass separately. The package's real-source word click reached 51.070 seconds; the synthetic timestamp-delivery test is within 0.04 seconds. These are stored-anchor delivery checks, not acoustic alignment scores.

See [coverage and remaining gaps](coverage.md), the review root's `final-coverage`, and `packaged-real\run-Vg4HuQ\result.json`. Original failed attempts and corrected collection results are retained. The final verification summary records the exact package, commits and selected delivery checks.

## Remaining decisions and work

- Manual UX and acoustic-quality acceptance; known cue misses and any reported timing errors.
- VC-81 optional speaker detection, still last priority and off/unimplemented.
- Floating-window search/scroll/selection are not yet restored after closing; saved window bounds and transcript edits are retained. This is a remaining VC-80 refinement, not a completed acceptance criterion.
- Portable runtime/model provisioning, GPU validation and longer/noisier recording measurements remain open; this workstation build uses an installed local runtime.
- M4 context-aware correction and semantic agent actions; M5 Connections and story/glossary tools. No background agent or automatic Notion publication has been added.

Record findings with M301–M308, source/role, approximate time, expected behavior, actual behavior and a screenshot or diagnostic report when useful. Leave untested items unchecked.
