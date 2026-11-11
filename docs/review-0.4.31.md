# M5 review — 0.4.31

November 11, 2026. Sprint 15 got Virtual Cut ready for the next real batch. A clip can now lose
dull stretches from its middle and still export as one clip. Proxies make dragging and rewind
fast. A spoken Split works on a recording that has no clip yet. A shared first commit added the
proxy record on a recording. Four lanes ran in parallel after it, and each was reviewed and
accepted in its own thread. This delivery puts them together on `m5-batch-workflow`.

## The proxy record on a recording (shared commit)

- A recording's native source can carry a verified proxy record. It holds the file name in the
  project cache, the height (1080 or 720), width and codec, the keyframe step, the recording
  fingerprint it was made from, and the size and time it was verified with.
- Each snapshot works out what the windows see on `recording.proxy`. It is none; making (a queued
  or running `proxy` job, with progress); ready (the file is unchanged, with a playback address);
  or missing (the file is gone or changed, or was made from another revision). The record
  survives relinking and re-import of the same file, and project storage lists proxies on their
  own row.
- Check: `proxy-record.test.mjs`.

## Making proxies (VC-237, lane A)

Accepted 2026-11-11.

- Each recording card has a proxy chip (make, stop, remove, show in folder). Proxies, beside
  Transcript, makes them for the whole batch. It also sets when they are made (only when asked,
  ticked at import, or never) and their size (1080p or 720p).
- Proxies are H.264, with a keyframe on every source keyframe and every half second. Each one is
  checked frame by frame before use. Making them takes about 7 minutes per footage hour on the
  GPU. They pause for playback and transcription and carry on where they stopped. Originals are
  never changed.
- A follow-up spike on sharing one decode between the picture pass and the proxy is filed in
  Triage.
- Checks: `proxy-make.test.mjs`, `proxy-native.mjs`, `proxy-ui.mjs`.

## Split on a recording with no clip (VC-243, lane C)

Accepted 2026-11-11.

- Accepting a Split on a recording with no clips makes both clips, whether the Split was spoken
  or came from an agent. One clip runs from the start to the Split, and one from the Split to the
  end. They are named by the card, the agent, or after the recording. Reopen removes both.
- Intent guide v7 (accepted in the lane C thread): an agent reworks a spoken Split cue with one
  split that refines the cue line and names both clips with `clip_names`. That makes one card, and
  accepting it settles the cue. It proposes two clip ranges only where there is no Split cue. The
  rules for moving a Split to a black screen or for a late call are unchanged.
- Checks: `split-clipless-ui.mjs`, `transcript-domain.test.mjs`, `agent-proposals.test.mjs`,
  `batch-record.test.mjs`, `intent-score.test.mjs`.

## Original/Proxy switch (VC-238, lane D)

Accepted 2026-11-11.

- Original / Proxy at the viewer's top right, or P, switches the whole project between the
  originals and their proxies, and the project remembers the choice. Flipping keeps the frame and
  keeps playing. A recording without a proxy shows its original, and the switch is hidden when
  proxies are set to never.
- Dragging on a proxy lands on exact frames (the VC-202 follow-up). The size, codec and frame
  rate sit in a tag on the picture, and Info beside the switch shows it Always, When paused or
  Never. Exports always copy the original.
- Checks: `proxy-switch-ui.mjs`, `save-policy.test.mjs`.

## Gaps inside clips, exported as one clip (VC-212, lane E)

Accepted 2026-11-11 (decision 0028), after a prototype and decision record.

- G starts and ends a gap inside a clip, or Shift-drag over the clip and press G. The gap shows
  inside the clip. Backspace or the gap's right-click menu removes it, and H drags it. A gap at
  the clip's start or end trims the clip instead.
- Shift+G (Skip gaps) plays clips as they will export. It is off whenever a project opens.
  Before acceptance, the bottom-bar message shown at every skipped gap was removed at Connor's
  request.
- A clip with gaps exports as one file. Video is copied unchanged and joined on keyframes, so
  each end of a gap keeps up to one keyframe interval. Game audio is rebuilt losslessly with a
  short fade at each join. Markers and subtitles move to the clip's own time, and the companion
  lists what the gaps left out.
- Checks: `clip-gaps.test.mjs`, `stitched-export-native.mjs`, `gaps-ui.mjs`,
  `playback-ui-checks.mjs`.

## Merges

Each lane was merged with `--no-ff` into `sprint-15` once accepted. Every lane had already merged
the sprint so far, so each merge's tree matched its lane's tip. After each merge, the fast gate
and the checks for the lanes merged so far ran. The first full desktop suite with coverage after
lane E failed one gate: `clip-export.cts` branches were at 76.49% against 78%. The stitched
export's real-footage step is skipped without a footage copy. Unit tests for a stitched export's
markers on its own clock brought it to 78.09% (`06d64c9`, `f79d69e`). The suite then passed 99
checks with coverage.

## Delivery

The release notes check, fast gate, desktop suite with coverage, Windows package, packaged checks
and the transport check passed.

| Step                        | Time  | Report                                                         |
| --------------------------- | ----- | -------------------------------------------------------------- |
| Release notes               | 0 s   |                                                                |
| Fast gate                   | 21 s  | `W:\AI\Claude\Virtual Cut\evidence\0.4.31\fast\run-f3mqOP`     |
| Desktop suite with coverage | 400 s | `W:\AI\Claude\Virtual Cut\evidence\0.4.31\suite\run-GXeV8m`    |
| Package for Windows         | 9 s   |                                                                |
| Packaged checks             | 275 s | `W:\AI\Claude\Virtual Cut\evidence\0.4.31\packaged\run-AToaMb` |
| Transport check             | 39 s  | `W:\AI\Claude\Virtual Cut\evidence\0.4.31\transport`           |

Build `W:\AI\Claude\Virtual Cut\builds\Virtual-Cut-0.4.31-win-x64-2026-11-11T04-22-42-727Z`.
Evidence in `W:\AI\Claude\Virtual Cut\evidence\0.4.31`, with lane runs in `a`, `c`, `d` and
`lane-e`, and the checks after the merges in `merges`. Steps skipped without local setup: the
screen text engine, the installed GPU engine, the real-footage stitched export, the real speech
install and video playback in smoke.
