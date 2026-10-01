# Filmstrip reuse — 0.3.8

VC-45 and VC-46 share one implementation. The dynamic timeline strip stays in memory;
the existing, stable media-pool poster remains a separate disk asset.

## Behavior

- The main process retains verified 240×136-or-smaller JPEG keyframes across recording
  switches within the open project. A project-wide LRU holds at most 192 frames or
  8 MiB of accounted base64 string memory. Switching cancels obsolete decoder work,
  without discarding completed frames. One decoder runs at a time.
- The renderer retains recent source-time tiles as revocable JPEG blob URLs. A cache
  hit can display without a native request. Source ID, URL/path, modified time,
  duration and source clock/index metadata distinguish images. Snapshot updates
  invalidate missing, changed, relinked or removed recordings. Project changes/close
  release the cache. Native requests also stat the source before and after decoding.
- The renderer allows up to 192 tiles and 24 MiB of estimated JPEG + decoded RGBA
  memory. Eviction prefers old zoom detail over up to 96 recent overview tiles;
  pressure can still evict old overviews. Current request tiles are protected during
  insertion. Eviction explicitly revokes blob URLs; no hidden Image elements remain.
  This bounds app-owned images, not Chromium's total RSS/GPU/decoder overhead.
- Tiles are anchored to source time at each zoom/width. Panning moves overlapping
  tiles with the ruler, clips them at the viewport edges, and requests only missing
  slots. Returning to a cached view avoids decoding. Newly exposed slots can be
  empty until the 250 ms debounce and decoding finish. Never stretch an old scene
  into a different source interval.
- Only the visible area is requested: no background batch precomputation, disk
  images or whole-video decoding. Playback, seeking and waveform replacement defer
  missing work. Tile width is measured before the first request; strip height stays
  reserved at 64 px (48 px in compact-height windows).
- Images are nearest verified keyframes, not frame-perfect images at every cursor
  position. Hover retains actual keyframe time and tile center. Zoom/resize can need
  different samples. Reopening the app starts cold; this is intentionally not a disk
  cache. Exports and playback timing are unchanged.

## Verification

- Build/type checking and lint.
- `node --experimental-strip-types --test scripts/filmstrip-memory.test.mjs`:
  fractional pans and boundary grids, overview preference under pressure, bounded
  allocation across 40 recordings, revoked URLs, removal/relink/project invalidation,
  rejection of late responses.
- `node scripts/filmstrip-native-run.mjs` uses Electron's SQLite runtime:
  synthetic + copied 4K AV1 sources, nonzero source clock, exact keyframe verification,
  cancellation and replacement, source modification rejection, native LRU pressure,
  unchanged source hashes and no generated timeline image files. Cross-source hits
  pass even when given a nonexistent decoder executable, proving no decode occurred.
- `node scripts/filmstrip-reuse-checks.mjs` exercises the actual Electron UI with a
  disposable project/profile: revisit without IPC, overlapping tile translation,
  missing-only pan requests, reverse-pan hits, keyboard reset, pause-only generation,
  rapid switches, wide/compact layout and no renderer errors. Screenshots inspected.
- Packaged shell/preload/navigation smoke checks after allowing only image blob URLs
  in the content security policy. No other protocol or API access was added.

Native evidence: `G:\GPT\Work\virtual-cut\filmstrip\native-JAcuZ1`.
Cold 16-tile 4K AV1 request: 1,615 ms; warm native hit: under 1 ms.
Stress cache: 192 entries, 2,833,136 accounted string bytes.
Development UI: `G:\GPT\Work\virtual-cut\filmstrip\reuse-et1hSi` — revisit made
zero requests; a quarter-view pan retained eight tiles and requested three new slots.
Automated evidence does not replace Connor's M232/M233 visual acceptance.

Packaged UI: `G:\GPT\Work\virtual-cut\filmstrip\reuse-5osngU`, including reopening
Review details without new requests, and a Windows-only PATH using bundled tools.
Packaged shell evidence: `G:\GPT\Work\virtual-cut\filmstrip\packaged-shell-038`.
