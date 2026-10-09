# 0017. One lossless audio copy per track, heard and exported

- Status: Proposed
- Sources: ALAC Library playback bug (0.4.19-5), research "FLAC vs ALAC vs PCM in Resolve"
  (October 9, 2026), Notion ticket "Use 24-bit FLAC for all audio Virtual Cut makes"

## Context

Connor records OBS in 24-bit ALAC, the only 24-bit lossless compressed audio OBS offers. Chromium
cannot decode ALAC (or PCM inside MP4), so the Library and the Open video viewer played filed ALAC
clips in silence. The Cut page never had the problem because it plays a separate copy of each
track, but those copies were AAC at 192 kbit/s: what you heard while cutting was not what the
recording or the export holds.

Measured on October 9 (`G:\Claude\Virtual Cut\evidence\flac-audio-tests`): FLAC keeps the source's
sample rate and bit depth by default, decodes in the app's Chromium to the original's exact
samples (24-bit; 16-bit maps back to the exact integers), seeks within a few milliseconds of AAC,
and plays at every J/L speed with sound. A raw `.flac` file has no timestamps and drops audio gaps,
so the copy lives in MP4. Resolve imports 24-bit FLAC in MP4 beside the ALAC original.

## Decision

- **One copy per track, made at import.** Audio Chromium plays as stored (AAC, MP3, Opus, FLAC,
  Vorbis) is copied packet for packet into MP4; nothing is re-encoded. Anything else (ALAC, PCM)
  becomes FLAC in MP4 at the source's own rate and depth. The copy starts at zero on the track's
  own clock, as the AAC copies did.
- **Verified before use.** A packet copy must have byte-identical packets; a FLAC copy must decode
  to the original track's exact samples. The project remembers how each copy was made and the
  file it verified. Copies from earlier versions (AAC) have no record and are made again when a
  project opens.
- **Exports carry the copy you heard.** When the game track is ALAC or PCM, export and filing
  take audio packets from its verified FLAC copy, with the original video, and verify them against
  the copy placed on the original track's clock. Nothing is re-encoded at export. A copy that is
  missing or changed is made again first; the export waits for it.
- **The Library plays filed files directly**, which now hold FLAC. The Open video viewer, which
  has no project cache, makes a temporary verified FLAC copy for ALAC/PCM files and deletes it
  when another video opens or the window closes.

## Consequences

- Preview caches grow from about 86 MB to roughly 300–700 MB per hour per track; the space check
  before preparing audio allows for lossless audio.
- Making a copy is about ten times faster than the AAC encode it replaces, plus one verification
  decode of the original and the copy.
- Filed clips from ALAC recordings now hold FLAC instead of ALAC; receipts report
  `audioCodec: flac`. Clips filed earlier keep their ALAC.
- Audio cuts still fall on whole packets, as before; a FLAC packet is about 0.085 s.
