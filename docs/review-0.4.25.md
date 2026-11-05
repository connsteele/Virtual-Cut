# M5 review — 0.4.25

November 5, 2026. Sprint 11, the second half of the footage-evidence core before real batches:
on-screen text read in a background pass, its own engine setup, an MCP read tool for it, and two
transcription fixes for the microphone. Three lanes ran in parallel; each ticket was reviewed and
accepted in its own thread, and this delivery puts them together. Design rule for the screen text
work: it is built for every game, and the app records text only as facts (what, where, when, how
long, how sure). It never decides what a piece of text means; agents do, with the game's context.

## Screen text in a background pass (VC-141)

Accepted 2026-11-04 (board M390 prototype, M392).

- After its picture pass, each recording gets one screen text pass in the media lane: keyframes
  (at most about one a second), scaled to 1080p and read with RapidOCR and the PP-OCRv6 small
  models on DirectML. Keyframes inside a still picture found by the picture pass are not read
  again, and the same text in the same place on consecutive keyframes joins into one line.
- Each line stores its text, box, first and last time, keyframes seen and mean confidence, in a
  `screen_text` table beside the picture events, outside the editable model and Undo, removed
  with the recording. No labels, no per-game setup. Decision record 0021.
- The thumbnail badge shows the picture pass, then screen text with its own icon and percent
  (amber when paused), and both icons with a tick when both are ready. The scan icon starts both
  passes. Without the engine it turns amber and opens setup; Jobs says "Set up screen text
  engine".
- Measured on copies (RTX 4090, DirectML): 3 min for a 16-minute Mass Effect recording, 5 min for
  the 34-minute Battle and 9 min for the 47-minute City recording, about 640 MB peak memory and
  0.4 to 2.1 MB stored per hour. Battle 22 of 23 checked dialogue lines and 871 of 871 name plates,
  City 15 of 17 lines and 575 of 583 plates, and 16 of 16 sampled Mass Effect lines matched their
  frames. Cross-game tuning on six more recordings kept the small recognizer (the medium one was
  18% slower and traded misreads) and reads 16 lines at a time (about 5% faster).
- Evidence: `W:\AI\Claude\Virtual Cut\evidence\0.4.25\vc-141`.

## Read screen text through MCP (VC-191)

Accepted 2026-11-04 (board M391 revised, M392).

- `get_screen_text(recording_id, start, end, …)` returns the stored lines as text. By default it
  groups pieces on screen over the same keyframes in one area into one compact line in reading
  order; `detail: true` gives each piece with its box, keyframes and confidence. Filters: screen
  area, minimum time on screen, numbers-only lines and `min_confidence`. 200 lines a page with
  `next_cursor` and per-area counts. A recording without lines says where its pass stands or that
  the engine is not installed, never an empty list; `get_context` says whether screen text is ready.
- Whole-recording size as sent (about 4 characters a token): Battle 53k tokens (18k with a 2 s
  minimum), City 114k (34k), Mass Effect 16k (4k). Agents are told to read time windows in busy
  games.
- Intent guide version 3: two sentences in the general section on reading raw screen text and on
  spelling names only as seen written or in the game vocabulary.

## Install the screen text engine (VC-192)

Accepted 2026-11-05 (board M395 prototype, M396).

- A Screen text engine card under the speech engine card in the Transcript window: the engine in
  use and its folder, the last test-image check (graphics card or processor), Check again, Open
  folder, Download and install with sizes and progress, Cancel, and the previous engine kept with
  "Use the previous engine again" and "Delete previous engine".
- `integrations/screen-text/runtime-manifest.json` pins Python 3.12.10 and 23 wheels by URL, size
  and SHA-256 (137.9 MB download, about 0.34 GB installed), in a runtime of its own because its
  ONNX Runtime clashes with the speech engine's. Setup reuses the speech engine's download,
  unpack and process helpers; the engine is used only after it reads its test image.
- `VIRTUAL_CUT_OCR_RUNTIME` and `VIRTUAL_CUT_OCR_DOWNLOADS` in `.env` point checks and development
  at a local engine and local copies of the pinned files.

## Drop invented microphone lines (VC-166)

Accepted 2026-11-05 (board M398).

- The speech worker scores the voice under each line's words. A finished microphone transcription
  drops short lines (2 s or less) that are a stock phrase, or where both the voice detector and
  the recognizer's no-speech probability say there is no speech. Drops are one journaled edit, so
  Undo restores them; the Original view shows them as "Dropped: no speech". Cues, game dialogue
  and older transcripts are untouched.
- Tuned on copies of Cai Chapter 4 Battle and City with the VC-128 scorer: on Battle both
  "Thank you." lines and three other short lines were dropped, and none of the 37 tagged entries
  lost words.

## Game names reach recognition (VC-164)

Accepted 2026-11-05 (lane C thread, M399).

- Vocabulary hints are on by default and apply when the batch's game has names or terms. They run
  at batch 8 with a guard: a hinted line that is a stock phrase (the list shared with VC-166) or
  has under one word per 2 s across 8 s or more is recognized again without hints. The
  transcript notes the guard's redos and where the hints came from.
- On Battle: 32:00–32:28 comes back as dialogue instead of "Thank you for watching!", and the mic
  hears Orchel, Theodora and Yu Phas right (Archel, Urshell, Theodore and Euphos gone); 14 tagged
  entries better and 1 worse of 37. Cai is still heard as Kai.
- Evidence: `W:\AI\Claude\Virtual Cut\evidence\0.4.25\vc-164` and `vc-166`.

## Also in this delivery

- `filmstrip-ui-checks` reads the running build's version, so packaged checks pass on labelled
  test builds (Sprint 10 retro).

## Delivery

Fast gate (19 s), desktop suite with coverage (279 s), Windows package, packaged checks (220 s)
and the transport check (38 s) passed. Evidence in `W:\AI\Claude\Virtual Cut\evidence\0.4.25`,
with packaged-build screenshots of the screen text badge, Jobs, engine card and dropped lines in
`screens`.
