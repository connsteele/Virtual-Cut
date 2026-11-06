# M4 review — 0.4.29

November 6, 2026. A hotfix during the first real batch (VC-29, Mass Effect footage on 0.4.28),
for batch note 28: at 2x and faster, Cut playback stuttered and the sound repeated like an echo,
on one listening track or Combined, while the Transcript window was open on any view. Closing the
window mostly cleared it. Built off `m4-agents-mcp` at 0.4.28 (e7f727f). One small visible
change: the Transcript window's active-word highlight moves without its short fade.

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

## The stutter: a fading highlight kept the window drawing

- Found on Windows with the real footage (below). With the two changes above, the echo was gone,
  but with the Transcript window open the 4K picture still waited for frames hundreds of times a
  minute (2x played at 1.38x). The window's main thread was nearly idle, and so was the main
  process. Playback was clean when the window was open but hidden, and when it was shown without
  playhead updates. It stalled as soon as the shown window animated anything: a single 4 px
  looping animation in an otherwise still window dropped 2x to 1.08x.
- Every transcript word is a button, and buttons fade their background over 0.14 s. Each playhead
  update moved the highlight and started two fades, about 8 times a second, so the window kept
  drawing frames all the time. On this PC that starved the main window's hardware decode of the
  4K60 AV1 picture.
- Now transcript words have no transition (`TranscriptWindow.module.css`), so a playhead update
  draws one frame. With transcript fades switched off, 2x played at 2.00x with no waits.

## Windows results

Connor's PC (RTX 4090, GPU about 13% busy and decoder idle beforehand), November 6, 2026.

Render study (`transcript-render-study.mjs` on a desktop suite run, two runs each, Transcript
window main-thread time blocked in 10 s; the CSS change doesn't affect this number):

| Corrections in the session | 0.4.28                              | 0.4.29                                |
| -------------------------- | ----------------------------------- | ------------------------------------- |
| 480 (all on the page)      | 1.30–1.33 s (13%), longest 19 ms    | 0 s (no task over 8 ms), longest 7 ms |
| 1,980                      | 3.21–3.22 s (32%), longest 42–69 ms | 0 s, longest 7 ms                     |

Real footage: a disposable project on a copy of the Mass Effect recording (4K60 AV1, 16 min 25 s,
game and mic ALAC tracks), with synthetic mic and game transcripts over its whole length and
3,936 heard-as corrections (the copy had no transcripts). Listen on Game, from 1:00, 60 s per
run, both windows shown off-screen. The same in-page probe ran on every build: backward and
forward `currentTime` sets on the listening track, video `waiting` events and time spent waiting,
and the Transcript window's main-thread time.

| Build                           | Transcript | Speed | Played at | Video waits | Waiting | Audio seeks back (sound replayed) | Window busy |
| ------------------------------- | ---------- | ----- | --------- | ----------- | ------- | --------------------------------- | ----------- |
| 0.4.28                          | closed     | 2x    | 2.00x     | 0           | 0 s     | 0                                 | —           |
| 0.4.28                          | closed     | 4x    | 4.00x     | 0           | 0 s     | 0                                 | —           |
| 0.4.28                          | Both       | 2x    | 1.60x     | 253         | 11.8 s  | 55 (14.9 s)                       | 35.1 s      |
| 0.4.28                          | Both       | 4x    | 2.20x     | 517         | 26.5 s  | 122 (68.7 s)                      | 42.5 s      |
| 0.4.29 audio + redraw (7faa809) | Both       | 2x    | 1.38x     | 323         | 18.4 s  | 0                                 | 0.3 s       |
| 0.4.29 audio + redraw (7faa809) | Both       | 4x    | 2.06x     | 498         | 28.6 s  | 0                                 | 0.3 s       |
| 0.4.29                          | closed     | 2x    | 2.00x     | 1           | 0 s     | 0                                 | —           |
| 0.4.29                          | closed     | 4x    | 4.00x     | 0           | 0 s     | 0                                 | —           |
| 0.4.29 (two runs)               | Both       | 2x    | 2.00x     | 0, 0        | 0 s     | 0                                 | 0.2–0.4 s   |
| 0.4.29 (two runs)               | Both       | 4x    | 3.99x     | 13, 8       | 0.13 s  | 0                                 | 0.2–0.4 s   |

On 0.4.29 the app's own pause diagnostic agreed: `audioSeeksBack` 0 in every run; with the window
open at 4x, `audioHolds` 15 and 11, `videoWaits` 15 and 11, `stalledMs` 134 and 154 (these
include the moments while L stepped up to speed). On 7faa809 alone it had read 331 and 489 holds
with 19.1 s and 29.6 s stalled. Numbers, screenshots and the probe scripts are kept outside the
repository with the evidence for this version.

## Checks

- Unit: `audio-sync.test.mjs` (new, in the fast gate): a stalled picture holds at every speed and
  drift, ahead waits then releases, behind skips forward, large drift seeks, and a simulated 2x
  playback with the picture stalling 0.3 s of every 0.36 s never moves the audio backward.
- Desktop: `project-ui-checks.mjs` now freezes the playing video and sends `waiting`: both
  Combined tracks must pause and never move backward, then play again when the picture moves.
  On 0.4.28's player this step fails (`backward: true`); on 0.4.29 it passes.
- Desktop: `transcription-review-ui.mjs` now moves the playhead word by word and catches the
  first highlight change: no animation may be running among the phrases. Before the CSS change it
  fails (two `background-color` fades); after it, it passes.
- Passing on the cloud container: `npm test` (fast gate), and desktop `playback-ui-checks`,
  `combined-transcript-ui`, `transcription-review-ui`, `transcription-ui-checks`,
  `project-ui-checks`.
- Passing on Windows: the same fast gate and desktop checks, and `npm run deliver`. In the first
  focused desktop run, `feedback-native-checks.mjs` (a dependency the hotfix doesn't touch) failed
  once on its cache-cleanup count (7 files removed, 6 expected, likely an audio preview written
  during the count) and passed on the rerun.

## Not in this hotfix

- Batch note 42's "demuxer seek failed" preview error (reload once by itself before showing the
  error). It may share the cause; it stays a candidate ticket.
- The Transcript window still re-renders its page on each playhead update (now cheap). Moving the
  active-word highlight out of the page render, and making the 1.2 s session poll and Both page
  queries lighter in the main process, are follow-ups if stalls remain.
- Other animations elsewhere in a second open window (a hover fade, a spinner) still cost a few
  frames each. They are brief, but anything that loops while playing would bring the stutter back.
- Spoken cue detection, cue words and scoring (AGENTS.md).
