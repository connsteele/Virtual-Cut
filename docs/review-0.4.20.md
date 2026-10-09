# M4 review — 0.4.20

October 9, 2026. One-sprint fix: ALAC recordings were silent in the Library and in Open video,
and the Cut page played lossy AAC copies. Every track copy is now lossless and is the audio
exports carry. See [decision 0017](decisions/0017-lossless-audio-copies.md) and the measurements
in `G:\Claude\Virtual Cut\evidence\flac-audio-tests\results.md`.

## M349 — ALAC sounds the same everywhere

- [ ] Import an ALAC recording. Once audio is prepared, the Cut page plays game and mic with
      sound, including J/L up to 6×, scrubbing and loop.
- [ ] File a clip from it. The Library plays the filed clip with sound; the filed file's audio is
      FLAC with the recording's sample rate and bit depth.
- [ ] Open video on an ALAC recording plays it with sound (a short wait while the copy is made).
- [ ] An existing project opened in this build remakes its audio copies once, then plays as
      before.

## Evidence

Commits since 0.4.19 on branch `m4-agents-mcp`, plus this delivery commit. Produced with
`npm run deliver -- --version 0.4.20`.

- Checks: `lossless-audio-native.mjs` (native): 24-bit ALAC in MP4 at 48 kHz and 16-bit PCM in
  MKV at 44.1 kHz; copies are FLAC with the same rate and depth and the original's exact samples;
  a filed clip holds FLAC with the same rate and depth, its samples a contiguous run of the
  original's; the original is unchanged. `feedback-native-checks.mjs`: an older copy is remade.
  Export and filing checks cover packet copies for AAC recordings.
