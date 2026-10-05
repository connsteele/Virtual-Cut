# 0013. Filmstrips made once per recording and kept in the preview cache

- Status: Accepted (October 5, 2026)
- Sources: [Filmstrip generation and caching investigation](https://app.notion.com/p/3ef7c5227a80811dac6ef33e99b38234), Virtual Cut Review board (DEC-filmstrip), VC-133, VC-134

## Context

Each filmstrip tile used to be its own FFmpeg process, about 98 ms per tile on 4K60 AV1, so a 31-tile view took about 3 s, and most zoom or pan steps decoded again. One FFmpeg run that decodes only keyframes makes every tile of a recording in about the time a single view took. Kept in memory only, that work would repeat on every project open.

## Decision

- One keyframe pass per recording makes every tile (240×136 JPEG, keyframes only), CPU decoding on 4 threads at below-normal priority so the GPU decoder stays with playback.
- Passes run in the background while no job is queued, one recording at a time. Any job that starts stops the current pass, which is retried later. A recording opened without a tile file goes first.
- Tiles are written to the project's preview cache, one file per recording (`<source>-<fingerprint>-filmstrip.bin`), atomically through a partial file. The file records the source path, size, modified time, clock offset and tile shape; a file that no longer matches is deleted and made again.
- Opening a recording loads its whole tile file into memory (within a 96 MB budget across recordings), so zooming and panning need no decoding down to one tile per keyframe. Closer than that, neighbouring tiles show the same nearest keyframe.
- Until a file exists, tiles are decoded on demand as before.
- A change to one recording drops only that recording's tiles; other recordings keep theirs.

## Alternatives considered

- **Memory only:** no disk use, but every project open decodes all footage again.
- **Four tile decodes at once:** cuts a 31-tile view from 3.1 s to 0.9 s, but still decodes on every zoom step.

## Consequences

- Disk use is about 0.1% of the footage size (13–24 MB per footage hour), measured on three real projects; about 490 MB for 448 GB of footage.
- Project deletion, batch removal with app data, and the storage panel treat tile files as disposable previews.
- Decoding the frames between keyframes at very deep zoom is a separate, optional follow-up.
