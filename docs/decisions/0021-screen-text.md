# 0021. Screen text read once per recording, recorded as facts beside the model

- Status: Proposed
- Sources: VC-141, the visual data spike (Seeing the Footage, D3 and D4, accepted October 10),
  decisions [0019](0019-job-lanes.md) and [0020](0020-picture-events.md), the Sprint 11 refinement

## Context

Agents spend most of their image tokens reading text off the screen: dialogue, names, numbers,
menus and notices. The spike showed that the same text, read once by local OCR and given to agents
as text, lets them spell names they would otherwise guess (8 of 9 core names, none wrong, no
images). Virtual Cut is for every game, so it cannot know where a game puts its dialogue box or what
a number on screen means, and per-game region setup was rejected (extra work, and text moves
between scenes).

## Decision

- **Facts only.** The app records what text the screen showed, where, when and how long, and the
  engine's confidence. It never decides what text means (speaker, item, damage number, menu).
  Agents interpret with the game's context; per-game lessons go in the intent guide's game
  sections, which Connor approves. No game-specific rule lives in the app.
- **One pass per recording and source fingerprint**, queued as background work in the media lane
  after the import and after the recording's picture pass (it starts when the picture pass has
  finished or failed). "Analyse picture now" queues it too. Without the screen text engine nothing
  is queued and the app says "Screen text engine not installed" with a link to setup.
- **What it reads:** each keyframe (about one a second in OBS recordings), decoded on the CPU with
  FFmpeg's keyframe-only decode and scaled to 1080p (smaller recordings at their own size), read
  whole by RapidOCR with the PP-OCRv6 small models on DirectML and the spike's settings
  (`limit_type` max, side 736, no angle classifier). A keyframe inside a still picture from the
  picture pass, together with the last keyframe read, is not read again.
- **What it keeps:** a line per piece of text that stayed in one place: the text (whitespace
  collapsed, nothing else changed), its box on the read frame (the union of its readings), first
  and last keyframe time, how many keyframes showed it, and the mean confidence. The same text
  whose box overlaps by half or more on the next keyframe joins the same line; one missed keyframe
  is allowed, a longer absence starts a new line. Nothing is filtered out by kind or position.
- **When it waits:** the picture pass's rules: paused while any transcription runs and while a
  preview plays, giving way to work ranked ahead of it, carrying on after the last keyframe it
  read. It never waits for an NVIDIA decoder, because its decode is keyframes only on the CPU.
- **How it runs:** the screen text worker (`integrations/screen-text/worker.py`) behind a guard
  with the speech worker's kill-on-close Job Object, so closing or crashing the app or cancelling
  ends the reader and its FFmpeg.
- **Where lines live:** the project's `screen_text` table, keyed by recording and source
  fingerprint, with a version and a summary column. Not in the editable model, never in Undo,
  removed with the recording.

## Alternatives considered

- Crops of known regions (the spike's plates and dialogue box): game-specific, which the design
  rule rules out. Whole 1080p frames read the 40 checked dialogue lines as well as the crops did
  (side lengths 736, 1280 and 1920 gave the same 37 of 40 exact, the three misses being a
  title above an item panel that the key leaves out, the continue arrow and one ellipsis), so the
  fastest side was kept.
- A frame every second by full decode: keyframe-only decode reads about 90 4K AV1 keyframes a
  second on the CPU and leaves the GPU decoder to playback and the picture pass.
- Skipping keyframes by the picture pass's cut scores: they are stored rounded, and a changed
  dialogue line scores well under one, so only still pictures (FFmpeg's `freezedetect` at -60 dB)
  are safe to skip.

## Consequences

Each recording gets a second background job after its picture pass. Measured on copies (VC-141,
RTX 4090, DirectML): 0.14 to 0.19 s per keyframe including decode, so 3 min for a 16-minute Mass
Effect recording, 5 min for the 34-minute Battle and 9 min for the 47-minute City recording, at
about 640 MB peak memory; 0.4 to 2.1 MB stored per hour. Accuracy held against the spike's crops:
Battle 22 of 23 checked dialogue lines and 871 of 871 name plates, City 15 of 17 lines (the extra
miss is an item title the key leaves out) and 575 of 583 plates, and 16 of 16 sampled Mass Effect
lines matched their frames. Busy screens make many lines (Fire Emblem's battle HUD: about 10,000
for Battle, most on screen for one keyframe); readers page and filter them (VC-191) and nothing is
thrown away. Recordings with keyframes far apart get fewer readings; that is a recording setting,
noted rather than worked around. Checks use a stand-in OCR (`scripts/screen-text-stub`) with the
real worker, guard and FFmpeg. A new reader of screen text goes through `ProjectStore.screenText`.
