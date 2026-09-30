# Milestone 2 — verified single-clip export (0.3.0)

## Delivered slice

Cut's **Export selected clip** and an expanded Review card's **Export clip…** open a range/audio/container review. Choose MP4 or MKV, confirm that the assigned game track has no microphone mixed into it, then choose one new output file. Original video and that audio stream are copied; the output contains exactly one audio stream, as audio track 1. Native validation blocks a missing game track, a shared game/mic track, changed source identities, changed plans, registered-original destinations and the disposable cache.

The existing review queue is not filed or marked Done by this action. **Exports** shows durable receipts, verified actual ranges, failures, cancellation/retry and native Explorer actions for the video and its `.vcut.json` companion. Receipts are outside editorial Undo and survive restoring older saves; differing current work is labelled **Earlier edits**. Original recordings stay intact.

## Cut and timing proof

1. Freeze the relevant clip, source identity, audio assignment, markers, notes and folder intent in a native plan. Snap In to the nearest preceding usable keyframe and Out to the nearest following keyframe or video EOF. No arbitrary padding or re-encoding fallback.
2. Inspect original packet presentation/decode times and hashes. Seek at a decode boundary, including a game-audio packet crossing the first displayed frame when needed. Bound video packets at the next keyframe's decode time using a packet filter with `amount=0`; let audio continue through the last video presentation time. This avoids losing the first keyframe or truncating audio early on B-frame footage.
3. Copy only the original video and selected game audio. Apply one common timestamp shift, including a final shared shift to put the first video frame at zero. Compressed audio packets spanning a boundary remain intact as preroll/tail; codec packet edges can extend beyond the displayed video range. Preview AAC, waveform samples and player clock correction never feed this path.
4. Match every output video packet against the exact intended contiguous source sequence. Match every audio packet and require the entire intended contiguous audio sequence, including both edges. Compare PTS and available DTS using the same shift for both streams, within two source/output clock ticks plus probe rounding. Duplicate audio payloads are matched by time and sequence, not just by hash.
5. Add chapters, then repeat payload/timing/stream/range checks and verify chapter names/times. Decode the start and end of the final staged output. Recheck the source identity, hash the finished file and persist the verification receipt before publication.

MP4 uses a microsecond movie timescale so the movie edit list does not round a nonzero AV1 cut's audio offset to milliseconds. MKV still has millisecond timestamp precision. Real demo-copy results are recorded separately below; packet checks do not substitute for Connor's independent playback/Resolve review.

The implementation follows the documented timestamp options in [FFmpeg](https://ffmpeg.org/ffmpeg.html), the common mux timestamp shift in [FFmpeg formats](https://ffmpeg.org/ffmpeg-formats.html), and the unchanged-packet/drop expression behavior in [FFmpeg bitstream filters](https://www.ffmpeg.org/ffmpeg-bitstream-filters.html#noise). Selecting and verifying this policy is our implementation decision.

## Metadata and dates

- Embedded: chapter names and their verified container timestamps. MP4's first QuickTime chapter is anchored to zero; a neutral **Clip start** chapter is inserted when necessary to keep the first real marker from being moved there. It is not an editorial marker in the companion file.
- Companion: schema/version/export identity, clip and original names, intended folder, clip note, recording context, requested/planned/actual range, source identity/path/date, chosen audio, complete in-range marker identities/names/categories/colors/topics/multiline notes, source/clip/container times, output SHA-256 and verification metrics.
- Only markers inside the actual video range are exported; overlapping clips have independent metadata records. A companion file is not automatically read by Resolve.
- Date modified follows the established LosslessCut policy: source Date modified + requested clip start. Embedded creation metadata is retained; no capture date is guessed. Explorer's generic Date column and Resolve's dates still require manual review.
- Existing Resolve research supports MP4/MKV chapter names/times in Studio 21.1. Current-build color, distinct marker-note and clip-note transfer are **unverified**. Portable preservation is implemented; a Resolve metadata helper is not implemented or implied.

## Publication and recovery

The native save picker grants an output path. An exclusive destination lock reserves it. Raw/final stages and metadata are written beside the destination; final publication uses exclusive hard links and never replaces an existing file. A destination must support this operation (normally a local NTFS folder); unsupported or unwritable locations fail explicitly. Normal failure/cancellation removes the stages created by that attempt. Originals, previews and user files are not overwritten.

If interruption happens between publishing the video and metadata, retry accepts only the expected verified video hash and matching metadata; it can complete a missing companion without copying another video. Stale locks are recovered only for this export and a dead process. No automatic retries on project open. Save restoration reconciles missing retry jobs while keeping receipts. Force-kill leftovers can remain as hidden `.vcut-*` stages; broader batch crash reconciliation and cleanup belong to the next filing slice.

## Verification evidence

`npm run test:export` builds and runs isolated native and hidden Electron UI checks under `G:\GPT\Work\virtual-cut\m2`. Optional `VIRTUAL_CUT_REAL_EXPORT=1` also tests both containers against the disposable 4K AV1/FLAC demo copy, never the I: original. Native checks cover B-frames, zero/nonzero source times, VFR, delayed/early game audio, selecting the second source audio track, Unicode/multiline metadata, container chapter timing, outward cuts, EOF, collisions, stale plans, cancellation/retry, missing-companion recovery, old-save restoration, receipt reopen and original hashes.

UI checks cover Cut and Review export entry points, audio confirmation, container changes, native-picker cancellation, a real queued/verified export, receipt table, native metadata reveal, centered navigation and wide/compact dialogs. M1 storage/timing/feedback, media-access, desktop-shell and sample-workflow checks remain regression gates. The packaged UI check uses Windows-only PATH to exercise bundled media tools.

### Version 0.3.0 evidence — September 29, 2026

- Portable app: `G:\GPT\Work\virtual-cut\m2\builds\Virtual-Cut-0.3.0-win-x64-2026-09-30T04-25-13-244Z\Virtual Cut.exe`. Keep the build folder together.
- Packaged export UI passed using only Windows system directories on PATH: `G:\GPT\Work\virtual-cut\m2\ui-po1VdM`. Wide/compact dialog screenshots were inspected; no renderer errors were reported.
- Synthetic export coverage passed after the final packet-matching change in `G:\GPT\Work\virtual-cut\m2\native-XQ5O37`. Source hashes stayed unchanged. Packet timing differences remained within the documented source/container clock tolerance.
- Real 3840×2160 AV1/FLAC proof files and companions: `G:\GPT\Work\virtual-cut\m2\av1-flac-tgSjjR\Cai Blaze Arts.mp4` and `.mkv`. The requested 2.2–10.2 s range expanded to 1.616666–10.65 s. All 542 video and 96 game-audio packets matched the originals. Maximum packet timing error was 7 µs for MP4 and 0.667 ms for MKV; the disposable source's full SHA-256 was unchanged.
- Build/type checks, lint, formatting, media access, desktop shell, sample workflow, project/storage/timing and M1 feedback regressions passed. Project evidence: `G:\GPT\Work\virtual-cut\milestone-1\native-FwXUt3`, `ui-NrgEyW` and `timing-bqHxGV`; feedback evidence: `G:\GPT\Work\virtual-cut\m1-feedback\native-u45h4W` and `ui-a0wHxp`.

These automated results verify the implemented copy/timing contract. They do not tick Connor's hands-on review or establish Resolve color/note compatibility.

## Remaining M2 work

- Connor's new M201–M207 review checks, keeping unfinished F01–F07 and O01–O05.
- Manual import of the provided MP4/MKV proofs in a disposable Resolve project: record version, playback, chapter names/times, colors, both kinds of notes, dates and reimport behavior. Decide the default container and whether a bounded metadata helper is needed from that evidence.
- Reviewed batch names/destinations and real Windows folder filing, collision choices, per-item durable receipts, interruption reconciliation and safe stage cleanup, then one representative real batch. No claim that M2 or production readiness is complete yet.
- Long-source verification performance and broader unsupported codec/container/time-layout cases. Current packet inspection is bounded at two million media packets; unsupported copies fail explicitly.

Transcription/agents, direct Selects/timeline handoff, and source deletion remain later work. No runtime AI calls or USD tracking are introduced.
