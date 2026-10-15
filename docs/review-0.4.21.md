# M4 review — 0.4.21

October 15, 2026. Sprint 7, ready for real batches: a batch record of the agent's first pass
beside what was exported, a Split snap to the end of a black screen, and transcription at batch 8. See [decision 0018](decisions/0018-batch-records.md).

## M350 — Batch record

- [ ] Pair an agent app, have it propose on a recording, decide some proposals, then change a
      few things by hand (trim a clip, rename one, add a marker) and export or file the batch.
- [ ] Ask the agent for `get_batch_record`. It shows the agent's first pass, your own additions
      marked `user`, your changes after accepting (from and to) and the spans cut away.
- [ ] The record is one small JSON file in the profile's `batch-records` folder. It holds no
      video and no copy of the project.

## M351 — Split snap

- [ ] On a recording whose mic has Splits at scene changes, each pending Split card shows the
      snapped time with "Spoken at …" under it, where the black screen ends.
- [ ] "Use spoken time" puts the card back on the word and "Use snap" switches back; both times
      stay visible.
- [ ] A Split with no black screen in the 5 s before it shows only its spoken time.
- [ ] Accepting a snapped Split cuts at the snapped time, and Reopen puts it back.
- [ ] The card first shows the spoken time and moves to the snap once it is measured (about 1 to
      4 s). Check how that feels.

## M352 — Batch 8

- [ ] Transcribe a recording's mic and game tracks on the GPU with vocabulary hints off. It
      finishes about twice as fast and reads the same.
- [ ] With vocabulary hints on, transcription stays at batch 1, as before.
- [ ] Transcripts made by this build are labelled `utterance-v2`. Asking to transcribe a track
      that already has an older transcript runs it again instead of skipping it. Older transcripts
      are kept.

## Evidence

Commits since 0.4.20 on branch `sprint-7` (from `m4-agents-mcp`), one ticket branch each, plus
this delivery commit. Produced with `npm run deliver -- --version 0.4.21`.

- Batch record: `batch-record.test.mjs` (freeze, runs after decisions, trims, renames, removals,
  splits, the rebuilt path, the store); `agent-proposals-ui.mjs` exports two clips through the
  app and reads the record back over MCP (5.5 KB, no file paths).
- Split snap: `split-snap.test.mjs`; `split-snap-ui.mjs` on a synthetic recording with a black
  from 6 to 8.5 s. Scored from Connor's notes on two real recordings: 25 of 26 Splits on target
  (spoken time 12 of 26), no "keep it where I said it" Split moved. The miss has its target 16 s
  after the word. Median 1.4 s per Split on the CPU, longest 4.0 s.
- Batch 8: `transcript-storage-checks.mjs` asserts 8 by default, 1 with hints and an explicit
  size honoured. On a 47-minute recording's mic (GPU): 164 of 169 note entries and 15 of 18
  Splits, as at batch 1, none invented, 55 s against 119 s.
