# M3 review — 0.4.14

October 5, 2026. Sprint 1: three checks, all finishing the filmstrip work you reviewed in 0.4.13.
They are on the [Virtual Cut Review board](https://claude.ai/artifact/HdJ3dXBscsVgiwtWiVATpT) with
a retrospective card. M3 remains open.

## M333 — No "Loading filmstrip…" flash (VC-133)

- [ ] Open a recording whose filmstrip is ready. Zoom in and out and pan along the timeline:
      "Loading filmstrip…" never appears. While new tiles load, the nearest thumbnails stay on
      screen and sharpen to the exact keyframes.
- [ ] Clicking a recording shows its filmstrip straight away, without the 250 ms wait.

What changed: the project now tells the timeline which recordings have a tile file, so their
first request goes out at once; tiles still arriving show the nearest frame already in memory;
and the loading text waits 300 ms. On a copied 7.2-minute 4K60 AV1 session, the old build flashed
the text on 6 of 8 zoom and pan steps and the new code on none; the median time until every tile
is exact went from 70 ms to 63 ms.

## M334 — "Making filmstrip…" on recording cards (VC-153)

- [ ] Import a batch of copies. Each recording's card in Media and Cut shows "Making filmstrip…"
      until its filmstrip file is ready, then the mark goes. Nothing appears in the job list.

## M335 — Version in the bottom bar (VC-152)

- [ ] The bottom bar shows "Virtual Cut 0.4.14" beside the keyboard shortcuts.

## Evidence

Commits since 0.4.13: `30136f9` (Sprint 1), plus this delivery commit.

- Before and after timings on the copied 4K session:
  `G:\Claude\Virtual Cut\evidence\0.4.14\filmstrip-flash`.
- `filmstrip-ui-checks.mjs` counts flashes across zoom and pan (0 required) and fails with 4 on the
  old status logic; it also checks the version label and that ready recordings carry no mark.
- Full desktop suite with coverage: `G:\Claude\Virtual Cut\evidence\0.4.14\suite\run-hwKpFc (49 of 49, coverage gates met, 6 min 40 s)`.
- Build: `G:\Claude\Virtual Cut\builds\Virtual-Cut-0.4.14-win-x64-2026-10-05T17-33-12-655Z\Virtual Cut.exe`.
- Packaged checks: `G:\Claude\Virtual Cut\evidence\0.4.14\packaged\run-ShYj14`.
