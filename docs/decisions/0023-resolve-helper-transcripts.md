# 0023. The Resolve helper sets transcripts on clips that have none

- Status: Proposed
- Amends: [0009](0009-resolve-handoff.md) ("transcript import stays manual")
- Sources: Connor's request in the Sprint 13 lane B thread (2026-11-05, "manually importing for
  every single clip is a pain"), card M418, VC-158 and its Resolve check (M417), the Resolve
  scripting API from 21.1.2 (`MediaPoolItem.GetTranscription` / `SetTranscription`, read again
  on 21.2.0.5 on 2026-11-05; Studio only)

## Context

Decision 0009 kept Resolve's transcript manual: Audio Transcription > Import from Subtitles, one
clip at a time, because the 21.1.1 scripting API could not set a transcript. Resolve 21.1.2 can.
On 2026-11-05 Connor imported a Virtual Cut export's plain `.srt` into Resolve: a clip with no
start timecode starts at 00:00:00:00 and every cue landed within one frame, and the
`.timecode.srt` lined up on a clip that starts at 01:00:00:00. A batch has many clips, so one
import per clip is the step he wants gone before the first real batch.

## Decision

- **The same helper run.** The Virtual Cut metadata Utility script checks transcripts in the same
  plan as markers and sets them on Apply. Its checks before Apply are unchanged: the clip must
  match its `.vcut.json` receipt (identity and hash), and the plan is checked again before
  writing.
- **Only clips with no transcript.** A clip that already has one in Resolve, whoever made it
  (Resolve, a manual import, an edit, an earlier helper run), is kept and the plan says so. The
  helper never clears or replaces a transcript.
- **Game dialogue only.** Microphone notes are the creator's notes, not what is said in the clip,
  and never go into Resolve's transcript.
- **Words from the export.** When the companion holds the transcript history (VC-154), its word
  timing and corrected text are used. Otherwise the game dialogue `.srt` beside the video is used,
  each line's words spread across it as Resolve's own import does. Times are clip-relative and
  are placed from the clip's start in Resolve, so start timecode does not matter.
- **The run summary names the clips** that got a transcript and says why each other clip did not
  (already has one, no game dialogue transcript beside the video, or an error).
- **Receipts stay versions 1 to 4.** Anything the helper needs from the companion comes from
  existing or optional, separately versioned sections.

## Alternatives considered

- **Keep it manual (0009):** one Import from Subtitles per clip; fine for a few clips, slow for a
  batch.
- **Replace an existing transcript with Virtual Cut's:** could discard Resolve's own work or
  Connor's edits; never.
- **Only the `.srt`:** simpler, but Resolve spreads words evenly across each line, so text-based
  edits cut near the word, not on it. The companion's word timing is exact when it is there.

## Consequences

- 0009's transcript bullet is superseded; its marker decisions stand.
- The helper needs Resolve 21.1.2 or later for transcripts. On an older Resolve it applies markers
  as before and says transcripts need a newer Resolve.
- Recheck the transcript API when Resolve's version changes.
