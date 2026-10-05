# M3 review — 0.4.15

October 5, 2026. Sprint 2: three checks, on the
[Virtual Cut Review board](https://claude.ai/artifact/HdJ3dXBscsVgiwtWiVATpT) with a push card
and the retrospective. M3 remains open.

## M336 — Transcript window toolbar (VC-114 stage 2a, VC-92)

- [ ] The transcript window has one toolbar row: recording, transcript, search with Original,
      Follow, Export, speech engine and Transcribe. Transcript selection sits beside search.
- [ ] Filter chips (All, Needs review, Cues, Accepted, Rejected) show counts for the whole
      transcript and filter the list; accepting a cue moves it from Needs review to Accepted.
- [ ] Export opens a menu with the format (SRT or JSON) and, when completed clips exist, the
      timing. Export transcript saves the file and closes the menu.

## M337 — Help button (VC-93)

- [ ] The bottom bar shows Help where "F11 · Fullscreen" was. Help opens a dialog with the
      spoken cues; Escape closes it. F11 still toggles fullscreen and is listed in Keyboard
      shortcuts.

## M338 — Smoother reverse scan (VC-146)

- [ ] J reverse at 1×, 2× and 4× shows visibly more movement than 0.4.14, at the same speed.
      Pause, return to 1×, loops and range ends behave as before.

Measured on a copied 4K60 AV1 session, pictures per second, 0.4.14 → 0.4.15: 1× 10 → 20.7,
2× 10.2 → 17.9, 4× 4 → 19.2, 6× 6 → 16.2, 8× 8 → 9, 16× 11.9 → 16.2.

## Evidence

Commits since 0.4.14: `53cbb89` (reverse scan), `e840cb2` (delivery command), `4705d61`
(transcript toolbar), `ec95553` (Help), plus this delivery commit. Produced with
`npm run deliver -- --version 0.4.15`.

- Reverse scan timings: `G:\Claude\Virtual Cut\evidence\0.4.15\reverse-scan`.
- Fast gate: `G:\Claude\Virtual Cut\evidence\0.4.15\fast\run-vPjruq`.
- Full desktop suite with coverage: `G:\Claude\Virtual Cut\evidence\0.4.15\suite\run-bHuvcY`.
- Build: `G:\Claude\Virtual Cut\builds\Virtual-Cut-0.4.15-win-x64-2026-10-05T19-59-15-437Z\Virtual Cut.exe`.
- Packaged checks: `G:\Claude\Virtual Cut\evidence\0.4.15\packaged\run-AIm3Nm`.
- Transport check: `G:\Claude\Virtual Cut\evidence\0.4.15\transport`.
