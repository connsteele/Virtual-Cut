# 0028. Stitched clips: gaps inside a clip, exported as one clip

- Status: Accepted (November 10, 2026)
- Sources: VC-212, the Sprint 15 ticket brief (card M469), note 44 of the first Mass Effect batch,
  and the Stitched Clips prototype Connor accepted on 2026-11-10 (his answers are recorded with
  it).

## Context

A clip was one start and one end. To drop a dull stretch from the middle, the user made two clips
and Resolve got two files. One clip per scene with the dead stretches gone, as one smaller file,
was named one of the most valuable things for the next batch.

Export is lossless: video packets are copied and both clip ends snap outward to keyframes
(design-decisions "Keyframe cuts"). The Mass Effect footage has a keyframe every 1.000 s. Game
audio is a lossless track; mic audio is never exported.

## Decision

- **A gap is a span cut out of the middle of a clip** (`Clip.gaps`: requested start and end in
  source time, sorted and apart, never touching the clip's start or end). The clip still exports
  as one file.
- **How it looks.** The kept pieces either side keep normal clip ends plus thin outline chevrons
  (› ‹) pointing at each other, set in from the piece's end so they clear its edge. The gap is a
  light fill with thin dashed lines above and below, a little inside the clip's top and bottom
  edges; no hatching. It is labelled only with its name (Gap 1, Gap 2); hovering shows its span
  and what it removes, and the clip card lists each gap.
- **Making one: G.** G at the playhead starts a gap and G again ends it (works while playing;
  Escape cancels), or Shift-drag over the clip and press G. While a gap is being made, the span
  from the first G to the playhead is darkened with a dashed outline, a solid edge where it
  started and its running length, and a note beside Position says how to finish or cancel.
  H drags a gap's edges or moves it. Backspace, or Remove gap in the gap's right-click menu (with
  Go to gap start and Go to gap end, the app's first right-click menu), removes a selected gap
  without the delete prompt; Undo brings it back. Overlapping gaps merge.
- **Playback can skip gaps.** Shift+G, or Skip gaps beside Manipulate, makes forward playback
  jump over each gap to where the export resumes, so the clip plays as exported. It is off
  whenever a project opens, because playing as exported could get in the way of reviewing.
- **Joins land on keyframes at both ends.** The piece before a gap ends on the keyframe at or
  after the gap's start, and the piece after starts on the keyframe at or before its end, so each
  end keeps up to one keyframe interval. A gap with fewer than two keyframes inside removes
  nothing: it stays, marked in amber, until it is widened.
- **Edges.** A gap reaching the clip's start or end trims the clip instead, and a note says so.
- **Markers inside a gap** are dimmed and left out of the export without a prompt; removing the
  gap brings them back.
- **Split (S) inside a gap** makes two clips meeting the gap's edges, with the gap as the space
  between them. Outside a gap, Split works as before and each clip keeps its own gaps.
- **Game audio** is decoded, given a 10 ms fade out and in at each join so there is no click, and
  re-encoded losslessly as FLAC. Video is never re-encoded.
- **Times move with the gaps.** Markers, chapters and SRTs use the exported clip's clock; anything
  inside a gap is left out. The companion gains an optional `stitched` section (its own version)
  with the pieces, each gap's requested and removed span, where each join lands and what was left
  out. The receipt version is unchanged.
- **Resolve:** one file per clip, with no join markers. Gaps show only for review (in the export
  panel's view of the clip as exported) and in the companion, so markers could be added later
  without re-exporting. No handles.
- **Agents** read each clip's gaps and exported length. Proposing gaps is a later follow-up.

## Alternatives considered

- Frame-exact joins by re-encoding the video around each join: slower and no longer lossless.
- An exact start with a keyframe end (copying a piece that ends mid-interval): it needed proof on
  real footage that such a piece decodes cleanly to its last frame; keyframes at both ends reuse
  the copy path every export already verifies.
- Separate files per piece that the Resolve helper lays end to end: two files again, and a
  Resolve-side assembly step.
- ALAC audio at the joins: FLAC is equally lossless and is what clips already carry.

## Consequences

- A clip's exported length is no longer end minus start.
- A stitched clip's game audio is re-encoded (losslessly) instead of copied, so the export
  verifies its samples against the original's, outside the fades, rather than its packets.
  Clips without gaps export exactly as before.
- Gaps shorter than about 2 s may remove nothing, because each end keeps up to 1 s.
- Clip proxies for Resolve (VC-239) must cut a stitched clip's proxy with the same pieces.
- Notes keyed to clip time (VC-210) can use the shifted times.
