# M3 review — 0.4.16

October 6, 2026. Sprint 3: four checks, on the
[Virtual Cut Review board](https://claude.ai/artifact/HdJ3dXBscsVgiwtWiVATpT) with a push card,
the retrospective and the Sprint 4 plan. M3 remains open.

## M339 — Dense transcript rows and in-line corrections (VC-114 stage 2b)

- [ ] Each phrase is one compact row: time on the left, words beside it. Edit phrase appears
      when you hover a row or tab into it.
- [ ] A pause of 10 s or more between phrases shows as a "… without speech" line (All, no
      search).
- [ ] Double-click a word: it becomes a field in the line. Enter saves, Escape cancels. The
      word's tooltip keeps the original; typing the original back, or Restore original in the
      hint under the line, removes the correction.
- [ ] Edit phrase makes the whole line editable the same way; the line then shows "phrase
      timing". Several words typed into a single-word edit are refused with a pointer to Edit
      phrase.

## M340 — SRT subtitles with export and filing (VC-94)

- [ ] Export selected clip and File accepted clips show a Transcript section. Game dialogue and
      Microphone notes are available only when that recording has a finished transcript.
- [ ] With SRT subtitles chosen, the export writes `<video>.srt` (game dialogue) and/or
      `<video>.mic.srt` beside the video. The cues start at the video's first frame and follow
      the actual cut, which may start a little earlier than the requested in-point.
- [ ] Exporting to a name whose SRT already exists leaves that file untouched and says so in
      the export history; the video still completes.

## M341 — Transcript history in the companion; Resolve subtitle check (VC-154)

- [ ] With Transcript history chosen, the video's `.vcut.json` has a `transcripts` section with
      the original words, your corrections and word timing. The Resolve helper still reads the
      file as before.
- [ ] Resolve check, by hand: follow [the subtitle fixture steps](resolve-subtitle-fixture.md)
      and note which SRT lines up in Audio Transcription > Import from Subtitles and in timeline
      subtitle import.

## M342 — Searchable game picker (VC-53)

- [ ] In project or batch context, Choose a game, then the Game name field offers saved games
      as you type and still takes a new title.
- [ ] Choosing a saved title shows "Saved game" and brings its names and terms; a new title
      shows "New game". A game saved in one project is offered in other projects on this
      computer.

## Evidence

Commits since 0.4.15: `045c726` (transcript rows), `df13acd` (SRT with export and filing),
`3a294da` (companion history and Resolve fixture), `6526969` (game picker), `5bf937f` and
`aee3a80` (deletion check coverage), plus this delivery commit. Produced with
`npm run deliver -- --version 0.4.16`; the first two runs stopped at the
`project-deletion.cts` coverage gate, fixed by the two check commits.

- Fast gate: `G:\Claude\Virtual Cut\evidence\0.4.16\fast\run-l3QKys`.
- Full desktop suite with coverage (50/50, gates met):
  `G:\Claude\Virtual Cut\evidence\0.4.16\suite\run-y9Hgc3`.
- Build: `G:\Claude\Virtual Cut\builds\Virtual-Cut-0.4.16-win-x64-2026-10-06T06-21-14-597Z\Virtual Cut.exe`.
- Packaged checks (50/50): `G:\Claude\Virtual Cut\evidence\0.4.16\packaged\run-05u5cT`.
- Transport check: `G:\Claude\Virtual Cut\evidence\0.4.16\transport`.
- Screenshots from the packaged checks: `G:\Claude\Virtual Cut\evidence\0.4.16\screens`.
- Resolve subtitle fixture: `G:\Claude\Virtual Cut\fixtures\resolve-subtitles`.
