# M4 review — 0.4.29

November 6, 2026. A hotfix during the first real batch (VC-29, Mass Effect footage on 0.4.28),
for batch note 28: at 2x and faster, Cut playback stuttered and the sound repeated like an echo,
on one listening track or Combined, while the Transcript window was open on any view. Closing the
window mostly cleared it. Built off `m4-agents-mcp` at 0.4.28 (e7f727f). No visible UI change.

## The echo: audio waits for a stalled picture

- Project recordings play each listening track as its own audio element beside the muted video.
  Every 50 ms the app compared them, and a track more than 0.12 s × speed off the picture
  (0.24 s at 2x) was moved back to it. When the 4K AV1 picture stalled (Connor's diagnostics show
  the video waiting about every 0.36 s), the track ran ahead and was pulled back, replaying that
  slice: the echo. The stall itself is the stutter.
- Now (`src/workflow/audioSync.ts`, used by `Player.tsx`): while the video is waiting, or hasn't
  moved for 150 ms while playing, each track holds (pauses) where it is. A track ahead of a moving
  picture also holds until the picture is within 0.05 s × speed of it. A track behind the picture
  skips forward. Only a drift larger than 1 s (or 4 × the tolerance at high speeds) seeks either
  way, as before. Sound is never repeated by a stall; a stall is a short gap.
- Pausing records `audioHolds`, `audioSeeksBack`, `audioSeeksForward`, `videoWaits` and
  `stalledMs` for the play that just ended in the diagnostics log, so a recurrence can be read
  from a diagnostics report.

## Why the Transcript window made it worse: a costly redraw

- The main window sends the playhead to the Transcript window about 8 times a second while
  playing, and each update redraws the page. For every phrase and every word, the page searched
  the session's whole list of corrections, building an id string per correction it compared, and
  serialized every correction again (once per page and once per spoken cue). Heard-as spellings
  (VC-194) and dropped lines add many corrections, so the cost grew with words × corrections.
- Now corrections are looked up through a map made once per change, the serialized corrections
  and heard-as summary are made once per change, and the silence gaps use a running maximum
  instead of rescanning earlier lines for each row.
- Measured with `scripts/transcript-render-study.mjs` (a new manual study): a Both page of 60
  lines × 12 words, playhead updates every 120 ms for 10 s, Transcript window main-thread time
  blocked (cloud Linux container, software rendering):

  | Corrections in the session | 0.4.28                                 | 0.4.29                             |
  | -------------------------- | -------------------------------------- | ---------------------------------- |
  | 480 (all on the page)      | 2.7 s of 10 (27%)                      | 0.12 s (1.2%)                      |
  | 1,980                      | 7.4–7.7 s (74–77%), longest 160–250 ms | 0.17–0.20 s (2%), longest 15–18 ms |

## Checks

- Unit: `audio-sync.test.mjs` (new, in the fast gate): a stalled picture holds at every speed and
  drift, ahead waits then releases, behind skips forward, large drift seeks, and a simulated 2x
  playback with the picture stalling 0.3 s of every 0.36 s never moves the audio backward.
- Desktop: `project-ui-checks.mjs` now freezes the playing video and sends `waiting`: both
  Combined tracks must pause and never move backward, then play again when the picture moves.
  On 0.4.28's player this step fails (`backward: true`); on 0.4.29 it passes.
- Passing on the cloud container: `npm test` (fast gate), and desktop `playback-ui-checks`,
  `combined-transcript-ui`, `transcription-review-ui`, `transcription-ui-checks`,
  `project-ui-checks`.

## Not in this hotfix

- Batch note 42's "demuxer seek failed" preview error (reload once by itself before showing the
  error). It may share the cause; it stays a candidate ticket.
- The Transcript window still re-renders its page on each playhead update (now cheap). Moving the
  active-word highlight out of the page render, and making the 1.2 s session poll and Both page
  queries lighter in the main process, are follow-ups if stalls remain.
- Spoken cue detection, cue words and scoring (AGENTS.md).
