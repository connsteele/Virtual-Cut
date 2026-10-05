# M3 review — 0.4.13

October 5, 2026. Two items to check: filmstrips are made after import and kept in the project
cache (M331), and anything you start goes ahead of filmstrip making (M332). Eight checks from
earlier builds are carried forward, one card each, on the
[Virtual Cut Review board](https://claude.ai/artifact/HdJ3dXBscsVgiwtWiVATpT). M3 remains open.

## M331 — Filmstrips made after import, kept in the project cache (VC-133)

- [ ] Import a few recording copies into a disposable batch and leave the app idle for a minute.
      **Project > Storage** shows **Thumbnails and filmstrips** grown by a few MB per recording.
- [ ] Open one of them, then zoom and pan along the timeline: thumbnails appear without the
      "Loading filmstrip…" pause.
- [ ] Zoomed in past the keyframe spacing, neighbouring tiles repeat the nearest keyframe, as
      before.
- [ ] Close and reopen the project and open the same recording: thumbnails come straight from
      the file.

What changed: each recording gets one FFmpeg pass that decodes only keyframes (4 CPU threads,
below-normal priority) and writes every tile to `<source>-<fingerprint>-filmstrip.bin` in the
preview cache. Opening a recording loads its file into memory, so zooming and panning need no
decoding. A recording opened before its file exists still gets decoded thumbnails and is made
next. Decision record: [ADR 0013](decisions/0013-filmstrip-tile-files.md).

## M332 — Anything you start goes ahead of filmstrip making (VC-133)

- [ ] Import a larger batch of copies and straight away start a transcription or an export. The
      job starts at once; filmstrip making resumes when the queue is empty.
- [ ] Playback stays smooth while filmstrips are being made.

## Engineering with no visible change

- **VC-134:** changing, removing or relinking one recording drops only that recording's
  thumbnails. A native check shows another recording's thumbnails still serve with no decoder.
- **CI (VC-49):** the three hosted failures are fixed in the checks and workflow, not the app:
  Chocolatey's FFmpeg shim showed up as a second FFmpeg process, one 61 s clock jump let an
  autosave slip past the seeking guard, and a fixed 30 px click put the playhead within snap reach
  of a trim target in the runner's narrower window.

## Evidence

Commits since 0.4.12: `276018e`, `952f1ab`, `a769ee6` and `8051241` (CI fixes), `306e3a6` (filmstrips at import and
VC-134), plus this delivery commit.

- Measured on a copied 7.2-minute 4K60 AV1 session (442 keyframes), never the originals: today's
  per-tile path took 2.8 s for a full view and 2.8 s for a zoomed view; one pass at 4 threads made
  all 442 tiles in 3.2 s; the tile file is 1.9 MB; a full view served from it took 5 ms and pans
  under 1 ms: `G:\Claude\Virtual Cut\evidence\0.4.13\filmstrip-real\result.json`.
- Full desktop suite on 0.4.13: 49 of 49 passed in 5 min 55 s:
  `G:\Claude\Virtual Cut\evidence\0.4.13\suite\run-Q0JWhV`.
- Build: `G:\Claude\Virtual Cut\builds\Virtual-Cut-0.4.13-win-x64-2026-10-05T05-48-43-065Z\Virtual Cut.exe`.
- Packaged checks all passed: export (tool lifetime: stopped with its parent), filmstrip UI and
  reuse, playback UI and smoke: `G:\Claude\Virtual Cut\evidence\0.4.13\packaged\run-icJgec`.
