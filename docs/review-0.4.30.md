# M5 review — 0.4.30

November 10, 2026. Sprint 14, the first sprint of M5 (batch workflow), built from what Connor's
first real batch (Mass Effect, 0.4.27 and 0.4.28) turned up. A shared first commit gave clips an
optional color. Seven lanes ran in parallel after it: four app lanes, two spikes that end in
recommendations, and a What's new lane added mid-sprint. Each ticket was reviewed and accepted
in its own thread, and the intent guide changes were accepted on the review board. This delivery
puts them together on `m5-batch-workflow`.

## Clips carry a Resolve clip color (shared commit)

- A clip can have one of Resolve's 16 clip colors (Orange, Apricot, Yellow, Lime, Olive, Green,
  Teal, Navy, Blue, Purple, Violet, Pink, Tan, Beige, Brown, Chocolate). Resolve's clip colors are a
  different list from its marker colors. Saving rejects other names.
- The export companion carries the color in a new optional `clipColor` section
  (`virtual-cut-clip-color`, version 1), so the receipt stays version 4.

## Neighbouring markers no longer spill into a clip (VC-208, lane A)

Accepted 2026-11-08.

- Outward keyframe cuts pad a clip with its neighbours' footage. Markers in that padding used to
  land in the clip's companion and chapters ("Distress Transmission" at frame 0 of Eden Prime).
  New exports now keep only the clip's own markers, and a marker that starts at the in-point snaps
  to frame 0. Exports queued before this keep their old marker scope.
- Checks: `marker-spill-native.mjs` (fails on 0.4.29), and a companion scope test in
  `save-policy.test.mjs`.

## SRTs name their transcript; an empty SRT when there's no dialogue (VC-236, lane A)

Accepted 2026-11-08.

- Every requested SRT is written. The companion says which transcript each one holds (mic, game
  or both), and a clip with no speech gets an empty SRT, so a missing file always means something
  went wrong.
- Check: `srt-sources-native.mjs`.

## Clip colors reach Resolve (VC-207, lane A)

Accepted 2026-11-08.

- Connor sets a clip's color in Cut, and the Resolve helper applies it with `SetClipColor`. The
  helper was installed straight into Resolve.
- Checks: `clip-color-ui.mjs`, and `resolve-helper.test.py` through `resolve-helper-checks.mjs`.

## Agents propose changes to existing markers and clips, and amend their cards (VC-204, lane B)

Accepted 2026-11-09 (decision 0026).

- `propose_changes` proposes edits to markers and clips already in the project (name, position
  or range, trim, marker color, clip color, note). Each change is a card showing before and after,
  and accepting edits through the same commands as the user, so Undo works.
- `amend_proposal` revises the agent's own pending card in place and keeps every version. It
  replaces the withdraw-and-resubmit loop (about 43 rounds on one recording in the batch).
- Checks: `agent-changes.test.mjs`, `agent-changes-ui.mjs`, `agent-proposals-ui.mjs`,
  `agent-access-ui.mjs`, `proposal-preview-ui.mjs`.

## No default whole-recording clip (VC-206, lane C)

Accepted 2026-11-08.

- Importing a recording no longer makes a clip covering all of it. A recording with no clips says
  so in Cut and Review and exports nothing, and Cut has a one-click Whole recording clip. Existing
  projects keep their clips.
- The checks that relied on the default clip now cut one with `withWholeClips` in
  `scripts/shared.mjs`. After the merge, two of lane A's new checks needed the same change.
- Follow-up filed in Triage: accepting a Split cue on a recording with no clip makes the clips on
  either side.

## Scrubbing keeps up on 4K recordings (VC-202 and VC-41's reload, lane E)

Accepted 2026-11-07. Connor keeps OBS at a keyframe every second.

- One seek is in flight at a time and the newest target wins. Slow drags show exact frames, and
  fast drags seek keyframes. The last decoded frame stays up while the next decodes. A failed
  preview reloads once by itself (VC-41).
- Measured on a 4K60 AV1 Mass Effect copy at full zoom: a slow drag went from 7 to 40 new
  pictures a second, and 0 of 198 seeks were thrown away (0.4.29 threw away 260 of 287). A 0.5 s
  keyframe re-encode reached 59 a second at 24% more size, and a 1080p proxy 62 a second.
- Settings now has a dialog, with `Fastest scrubbing` (off by default).
- Studies: `scrub-timing-study.mjs`, `scrub-cache-study.mjs`; checks in `playback-ui-checks.mjs`.

## Proxies spike (VC-16, lane F)

Accepted 2026-11-09. Study scripts only; no app changes.

- Eight candidates (H.264 at 1080p and 720p, long-GOP and all-intra, ProRes and DNxHR) were made
  from copies, with time, size and GPU and CPU load measured. Almost all of them run at the speed
  of the GPU's single AV1 decoder, about 6.5 to 9 minutes per footage hour. H.264 proxies are
  smaller than the source, and ProRes and DNxHR are 7 to 10 times larger.
- The recommendations became five proxy tickets in Triage under M5.
- Studies: `proxy-candidates-study.mjs`, `underflow-study.mjs`, `viewer-probe-study.mjs`.

## What's new, for the user and for agents (VC-242, lane G)

Accepted 2026-11-10 (decision 0027).

- Each version carries release notes for the user and a For agents list (`electron/release-notes.ts`).
  Clicking the version number in the bottom bar opens What's new in its own window. A dot shows
  after an update, and a pop-up offers it once.
- Agents read the notes since their last read with `get_whats_new`, and the server tells them to
  reconnect when a tool named in the notes is missing.
- `npm run deliver` stops when a version has no notes entry or still has a draft one.
- Checks: `release-notes.test.mjs`, `whats-new-ui.mjs`.

## Intent guide v5 and v6 (VC-224)

Wording accepted on the review board in two rounds (2026-11-09) and applied 2026-11-10. No scored
test was rerun.

- **v5:** one clip per coherent activity or scene with trims expected; a named clip range on every
  recording; clip ranges instead of splits, with a spoken Split marking the boundary; several clips
  per recording; searchable titles named the same for range markers and clip ranges; `Scene:`,
  `Me:` and `Fact:` notes; fact-checking; watching before writing; Windows file-name rules and a
  `fileNames` table; `amend_proposal` and `propose_changes`; where existing notes live; and
  recurring moments without a fixed count, checked with one `get_annotations` call per earlier
  batch.
- **v6:** the guide is general only. The per-game sections are gone. A game's own rules come from
  its brief and context (`get_context`) or the creator's Notion pages for the game. Decision 0021
  carries a dated amendment.
- Checks: `intent-score.test.mjs`, `look-ui.mjs`, `agent-proposals-ui.mjs`.

## Merges

Each lane was merged with `--no-ff` once accepted, and the checks for every ticket merged so far
ran after each merge. After lane C, the full desktop suite with coverage passed 86 checks once two
check fixes and a coverage test were in (`d9ef502`, `907a942`). Reports from each merge check are
in `evidence\0.4.30\merges`.

## Delivery

The release notes check, fast gate (22 s), desktop suite with coverage (352 s), Windows package,
packaged checks (235 s) and the transport check (39 s) passed.

Build `W:\AI\Claude\Virtual Cut\builds\Virtual-Cut-0.4.30-win-x64-2026-11-10T03-05-58-926Z`.
Evidence in `W:\AI\Claude\Virtual Cut\evidence\0.4.30`, with each lane's runs in `a`, `b`, `c`,
`e`, `f` and `g`, and the checks after the merges in `merges`.
