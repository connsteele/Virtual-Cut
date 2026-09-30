# Review follow-up — September 30, 2026

Connor accepted M228 (viewer switching), M229 (layout/save polish) and M216 (fast playback). The new 0.3.7 UI changes address M229's additional thumbnail action-row and narrow-list date requests. Thumbnail actions share the duration row. List dates stay beside the title when there is room, then stack below it; at the minimum panel width the date uses the full row. Sort controls also shrink within the narrow panel. Review is M231. Transport and exports are unchanged.

## Logging audit

There is useful job/error evidence but no complete persistent session logging system. Jobs retain failure messages and export receipts retain verification results. The tool wrapper captures a bounded stderr tail; player error details live in renderer state. There is no rotating session event log, persistent playback lead-up or user-exportable support bundle yet.

VC-19 now includes a bounded asynchronous log, event/session/job correlation, app/runtime/tool versions, media errors and process exits, and explicit Copy diagnostics/Open logs/export actions. Log state transitions and aggregate repeated metrics, never every playback/seek tick. Keep logs separate from project autosaving, handle disk failure without blocking editing, and redact paths/annotation contents by default. No automatic upload. This remains implementation work.

## M212: manual Resolve import

Read-only inspection of the supplied current-version MP4/companion confirms its output SHA-256 matches the recorded receipt. The file has 240 AV1 video frames at 60 fps (4.000 s) and a 4.079958 s FLAC stream; the outward source range is 6–10 s. Both multiline notes and their Blue/Red choices are intact in the companion. Embedded chapters contain names/times only. The screenshot shows empty Notes cells and Blue markers, including the marker whose companion color is Red.

This establishes that the reviewed ordinary MP4 import needs an explicit transfer for marker notes and non-Blue colors. It does not test separate clip/context notes (absent/empty in this sample), the old MKV tail comparison, or explain the screenshot's repeated marker rows. No live project was changed; Resolve was not running when checked. The installed connector reports version 21.1, not independent proof of the screenshot session's version.

The current Resolve SDK exposes MediaPoolItem.AddMarker with color, name, note, duration and customData. A scoped board ticket proposes a user-invoked metadata helper against already imported clips: verify media identity, preview changes, enrich only unambiguous untouched chapters, preserve user edits, and use stable marker IDs for idempotence. Preserve the neutral Clip start marker and roll back failed replacements. The screenshot shows frames 33 and 74 for chapter times 0.554444 and 1.242176 s; nearest-frame rounding would put the second at 75, so Resolve frame conversion and collision reconciliation need explicit validation. The helper is planned, not implemented. Selects and timeline creation remain separate.

## Filmstrip reuse

The current native cache holds one source identity, and the hook releases it on source change. The renderer also hides results whenever the viewport identity changes. This explains repeated work on recording switches and blanking while panning.

Two scoped tickets cover a bounded project-level LRU for recently viewed full overviews and a stable source-time tile grid that pans existing tiles and fills only new slots. Both remain in memory, with invalidation and cleanup; neither precomputes an entire batch or writes dynamic images to disk. Prior measurements were about 1.6 s for 16 cold 4K tiles versus 0–1 ms for warm native hits. Cache memory accounting must include decoded renderer images and transfer copies, not only compressed strings.

## Preliminary 6× audio study

`scripts/audio-speed-study.mjs` uses copied 4K AV1/60 media and both prepared audio tracks in an isolated offscreen 60 Hz Electron window. It reproduces the current bounded sync algorithm with experimental audio above 4×; the product cutoff is unchanged. Speaker output is muted, with pitch preservation enabled. This measures scheduling/decoding, not subjective audio usefulness.

| Run                      | Source seconds advanced in 12 wall seconds | Audio corrections | Video waiting/stalled/error events |
| ------------------------ | -----------------------------------------: | ----------------: | ---------------------------------- |
| 4×, both tracks          |                                     47.795 |                 0 | 0                                  |
| 6×, both tracks          |                                     71.710 |                 0 | 0                                  |
| 6×, no audio             |                                     71.710 |                 0 | 0                                  |
| 8×, both tracks          |                                     95.605 |                 0 | 0                                  |
| 6×, both tracks repeated |                                     71.711 |                 0 | 0                                  |

Both 6× audio runs presented 717 callbacks, with maximum inter-frame gaps around 33.4 ms. High dropped/total counts include intentional high-speed frame skipping; they are not a count of visible freezes. Evidence: `G:\GPT\Work\virtual-cut\transport-investigation\six-speed-BZ8t2Y`. This supports a full-app 6× trial with listening review and representative longer sources. It does not establish universal smooth playback or overturn previous intermittent 8×/16× failures. A separate Ready ticket preserves that next step; existing speed controls are unchanged.

## Rare playback error

M230 and VC-41 are deferred at Connor's request. Reload preview appears only when Player has an error, not continuously in the toolbar. Capture its details if a natural recurrence occurs; no forced recurrence is a current review gate. M217/high-speed metrics and O01–O05 remain available separately.

## Verification

Build/type checks and lint passed. Packaged `media-card-review-checks.mjs` passed at pool widths 520, 360, 260 and 180 pixels, plus a 1100×720 window. It checks duration/action alignment, adaptive date placement, no card or compact-panel horizontal overflow, keyboard access to source actions and no renderer errors. Wide and compact screenshots were inspected. Evidence: `G:\GPT\Work\virtual-cut\transport-investigation\card-review-xxnvDd`. The existing transport regression's geometry assertion was updated to accept the intentional stacked-date layout; transport behavior itself was not changed or revalidated by this CSS-only pass.
