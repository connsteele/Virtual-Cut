# Resolve subtitle import check (VC-154)

Virtual Cut writes SRT files with **clip-relative** times: the first frame of the exported
video is `00:00:00,000`. Resolve clips usually carry a source timecode (often
`01:00:00:00`), so this check finds out which timing Resolve expects in each import path.
Claude does not drive Resolve; Connor runs the check.

## Make the fixture

```
node scripts/build.mjs
node scripts/resolve-subtitle-fixture.mjs "G:\Claude\Virtual Cut\fixtures\resolve-subtitles"
```

| File                            | What it is                                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Timecode fixture.mp4`          | 20 s, 30 fps; embedded timecode starts at `01:00:00:00`. White text shows the clip time, yellow text the timecode. A beep sounds at each cue start (2 s, 8 s, 14 s). |
| `Timecode fixture.srt`          | Cues A, B, C at 2, 8 and 14 s, clip-relative, exactly what Virtual Cut writes.                                                                                       |
| `Timecode fixture.timecode.srt` | The same cues shifted by one hour to match the embedded timecode.                                                                                                    |

## The check

1. Import `Timecode fixture.mp4` into the Media Pool. Confirm its start timecode reads
   `01:00:00:00`.
2. **Native transcript reuse.** Right-click the clip and choose **Audio Transcription >
   Import from Subtitles**. Choose `Timecode fixture.srt`. Open the clip's transcript. Does
   "Cue A" sit at the beep where the picture shows clip `00:00:02`? Then repeat with
   `Timecode fixture.timecode.srt`. Note which file lines up, or whether neither does.
3. **Subtitle placement.** Put the clip on a new timeline (timeline start `01:00:00:00`) and
   choose **File > Import > Subtitle**. Import `Timecode fixture.srt` and drag it onto the
   timeline. Do the captions appear at the beeps? Note whether Resolve asks about timecode or
   offsets.

## What the answers decide

- Step 2 decides whether Virtual Cut's SRT can feed Resolve's own transcript (text-based
  editing) as written, or whether Virtual Cut should also offer a timecode-based SRT.
- Step 3 is ordinary subtitle placement: a subtitle track on a timeline, not a transcript.
  It works independently of step 2.
- Neither path overwrites an existing Resolve transcript automatically; automatic or native
  attachment stays with VC-40.
