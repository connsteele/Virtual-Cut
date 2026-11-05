# M5 review — 0.4.26

November 5, 2026. Sprint 12, the last footage-evidence piece Connor wanted before real batches:
agents can look at pictures of a recording, behind one switch he controls, and names the speech
model mishears are written the way the game spells them. Three lanes ran in parallel on top of a
first commit that added the pictures setting and the one check every picture call goes through.
Each ticket was reviewed and accepted in its own thread, and this delivery puts them together.

## Allow pictures, one switch (sprint commits and VC-195)

Accepted 2026-11-05 (prototype M405, then lane B build 0.4.26-21; "Yes accepted").

- The Agent panel has an **Allow pictures** switch under "Allow agent apps to connect". It is off
  by default, including for apps paired before this version, and one line beside it says
  pictures go to each app's AI provider and are kept under that provider's data settings.
- It is one switch for every paired app. The refinement planned one per app; on the prototype
  Connor asked for one switch that affects both, so the setting moved to agent access as a whole
  (`a5dd25f`). Only the Agent panel can change it; no MCP tool can. A change applies to live
  connections from their next call.
- Every picture call goes through `AgentAccess.checkPictures`: allowed only while the switch is on
  and the calling app is still paired, otherwise refused with a message saying the user turns
  pictures on in the Agent panel.
- Each paired app shows "Pictures today: N · ~X tokens", counted from Activity since local
  midnight, and Activity shows the picture count and estimated tokens under each look, or
  "(refused: pictures are off)". Activity keeps the newest 300 calls, so a day with more calls
  than that counts only those.
- Diagnostics record the switch turning on or off, never app names.
- Checks: fast `agent-access.test.mjs`; desktop `agent-pictures-ui.mjs` (off for new profiles,
  new and older pairings; keyboard on and off; survives a restart; today's totals and activity
  lines; compact window; screenshots).
- Evidence: `W:\AI\Claude\Virtual Cut\evidence\0.4.26\vc-195`.

## Let agents look at frames on request (VC-172)

Accepted 2026-11-05 (lane A thread; guide sentence uses "the creator", not Connor's name).

- One MCP tool, `look`, with up to 8 moments a call, each one of:
  - a **strip**: a range as up to 16 tiles of 252x140 with the time burned in, taken from the
    filmstrip tile file when a keyframe is close enough, else the exact frame;
  - **frames**: 720p by default (about 1,200 tokens each, up to 6 a call) or 1080p for detail
    (about 2,700 tokens, up to 2 a call), Lanczos scaling;
  - a **crop** at full source detail: a `get_screen_text` box padded a little, or a box in
    fractions of the frame.
- Caps per call: 16 pictures, about 8,000 image tokens, 1988 px on any side, text under 100,000
  characters. A request over a cap is fitted and the answer says how. Sizes fill whole 28 px
  cells. Each picture follows a line with the recording and time; near-duplicates are left out
  and named.
- Nothing is stored. Pictures are decoded into memory with the app's own FFmpeg on the CPU at
  normal priority (never the picture pass's NVIDIA decoder) and sent as image blocks. Activity
  records the recording, times, picture count and estimated tokens, never pictures.
- Decision record 0022 amends 0014 for pictures only.
- Timed on copies (4K60 AV1, keyframes about a second apart): one 720p frame 0.2 to 0.3 s, one
  1080p frame 0.1 to 0.2 s, six 720p frames 0.6 to 0.8 s, a full-detail crop 0.1 to 0.3 s, and a
  16-tile strip 0.9 to 1.7 s, well under the 10 s limit set at refinement.
- Mass Effect gameplay check (a 4 to 9 minute cut of the 2026-11-03 00-36-07 recording, in
  `footage-copies\mass-effect`): a 16-picture call (a strip fitted to 12 tiles) took 0.8 s and
  about 6,000 image tokens; a 720p frame plus a subtitle crop took 0.3 s and about 1,600 tokens,
  and the crop reads Pressly's subtitle clearly. The first fraction box (15 to 85% of the width)
  cut off both ends of the line; at 4 to 96% both Mass Effect lines read in full (`me-study-wide`).
  A crop from a `get_screen_text` box gets the whole line, since that box is the text plus padding.
- Intent guide version 4: apps read three sentences in the general section while Allow pictures
  is on (look whenever a picture would make the work better, check several moments in one call
  starting with a strip, and say when a picture decided a proposal); with it off they read v4
  without them.
- Checks: fast `look-plan.test.mjs` and `intent-score.test.mjs`; desktop `look-ui.mjs` through
  the real MCP pipe, saving every returned picture; study tools `look-timing.mjs` and
  `look-study.mjs`.
- Evidence: `W:\AI\Claude\Virtual Cut\evidence\0.4.26\vc-172`.
- Not done yet: the measure runs (agent passes on the Battle copy with pictures off and on, and
  optionally one on Mass Effect). They wait for Connor's go through the Test Queue.

## Write a name the way the game spells it (VC-194)

Accepted 2026-11-05 (lane C thread; design: the separate Heard as list, chosen on the prototype).

- A game's names and terms get a **Heard as** list: each row is the game's spelling and the
  spellings the speech model writes instead (Cai heard as Kai, Kye). Five rows show, then the
  list scrolls; problem rows get a red edge.
- After recognition, each whole-word, case-insensitive match becomes the game's spelling as an
  ordinary correction ("Kai's" becomes "Cai's", "Kaiser" is untouched), in game and mic
  transcripts. The transcript, proposals and agent reads say Cai; Original shows Kai; Undo and
  Restore original take it back, and a restored word stays as heard. The user's own corrections
  are never replaced and spoken cue words are never rewritten. The transcript header lists the
  spellings used.
- After a change to the list, the context dialog offers to apply it to the project's finished
  transcripts of that game as one undoable edit. That includes transcripts made with no game set
  whose recording is in a batch of that game (fixed after Connor's check on 0.4.26-31 found one
  still saying Kai).
- Vocabulary hints still carry the game's spelling (VC-164), never the heard one.
- Measured on the Battle copy: Kai 7 times before, Cai 7 times after, in game and mic transcripts
  alike, with no other words changed.
- Checks: fast `heard-as.test.mjs`; desktop `heard-as-ui.mjs`; study tool `heard-as-study.mjs`.
- Evidence: `W:\AI\Claude\Virtual Cut\evidence\0.4.26\vc-194`.

## Delivery

Fast gate (21 s), desktop suite with coverage (321 s), Windows package, packaged checks (233 s)
and the transport check (38 s) passed. Evidence in `W:\AI\Claude\Virtual Cut\evidence\0.4.26`,
with each lane's runs in `vc-172`, `vc-195` and `vc-194` and the checks after each merge in
`merge-a` and `merge-ab`. Lane C's tree equals the final merge, so its full suite run
(`vc-194\suite-coverage-116ce5d`) covers the merged result as well.
