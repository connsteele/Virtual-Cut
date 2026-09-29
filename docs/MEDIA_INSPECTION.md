# Virtual Cut — reference media inspection

Read-only inspection of Connor's supplied Fortune's Weave reference folders. No source or review media was edited, exported, renamed, or deleted. This is a metadata/project-file inspection, not a visual content audit or playback benchmark.

## Scope

- Raw: `I:\YouTube\Virtual Legacy\Videos\WIP\Fire Emblem Fortunes Weave Review\Video\_Unsorted\Cai`
- Cut/marked, awaiting agent and human review: `I:\YouTube\Virtual Legacy\Videos\WIP\Fire Emblem Fortunes Weave Review\Video\_Review`
- Probe inventory: `G:\GPT\Work\virtual-cut\engineering-audit\media-inventory.json`
- LosslessCut project-file snapshot: `G:\GPT\Work\virtual-cut\engineering-audit\losslesscut-projects.json`

## Observed inventory

| Property | Raw | Review |
| --- | --- | --- |
| Media files | 44 | 47 |
| Total size, GiB | 12.36 | 9.61 |
| Shortest duration | 1.916667 s | 1.964323 s |
| Middle ordered duration | 119.366667 s | 43.776 s |
| Longest duration | 385.083333 s | 384.96 s |
| Files with chapters | 11 | 19 |
| Total chapter entries | 35 | 48 |

All 91 files report AV1 video, 3840x2160, 60/1 fps and two stereo FLAC audio streams. Stream roles were not established by listening; their metadata does not label game versus microphone content. Nineteen review chapter entries are titled `Start` or `Clip start`.

The session spans over an hour, but the individual recordings in this batch are at most about 6 minutes 25 seconds. Treat hour-long-file performance as a separate untested case.

## Marker representation

`2026-09-28 10-16-54.mp4` contains an initial `Start` chapter and six `Unnamed` chapters. Each has a start and end timestamp. For Virtual Cut intake, each start is a point; chapter ends do not define export ranges.

The corresponding `.llc` project contains three named ranges plus independently named points, including `Theodora punches Cai` and `Theodora eyes and arm glow red`. The latter are source-time observations and remain separate from segment boundaries.

`2026-09-28 11-52-45-proj.llc` contains three named ranges and three point markers. Its second and third ranges overlap slightly (second ends 118.485905 s; third starts 118.119076 s). Independent/overlapping cut ranges are therefore part of the observed data, not merely a theoretical case.

The `.llc` files were found in `_Review` during inspection and refer to original recording basenames stored in `_Unsorted\Cai`. Import should resolve media identity through the project/source catalog rather than assume a sidecar is beside its source.

Generic chapter-start entries need provenance-aware treatment. Preserve deliberately authored point names. Internal point-marker records should not require the container's synthetic chapter filler to appear as an editorial observation.

## Chronological timestamps

For raw `2026-09-28 10-16-54.mp4`:

- Embedded creation time: `2026-09-28T17:16:54Z` (10:16:54 local).
- Filesystem Date modified: `2026-09-28T17:22:20.9474753Z` (10:22:20.947 local).
- Duration: 326.333333 seconds.

The three associated exports share the original embedded creation time. Their Date modified values follow the selected cut offset:

| Export | Requested source start | Local Date modified |
| --- | --- | --- |
| Theodora arrives to Dagsion | 1.274739582 s | 10:22:22.222 |
| Cai and friends encounter Theodora | 82.603124916 s | 10:23:43.550 |
| Cai recovers…gets idea to enter games | 163.931510249 s | 10:25:04.879 |

The observed relation, within timestamp rounding, is:

`output Date modified = source Date modified + requested cut start`

Connor's LosslessCut settings at `C:\Users\Connor\AppData\Roaming\LosslessCut\config.json` explicitly have `treatInputFileModifiedTimeAsStart: true` and `treatOutputFileModifiedTimeAsStart: true`. Its upstream `transferTimestamps` implementation applies exactly this formula for that combination:

https://github.com/mifi/lossless-cut/blob/master/src/renderer/src/util.ts

The same settings confirm `keyframeCut: true`, `enableImportChapters: always`, and `preserveChapters: true`.

This compatibility sorting date is not necessarily true recording-start wall time. In this raw example, Date modified is near recording end. Two inspected approximately two-minute replay files have creation/modification times near replay save time and no embedded creation-time tag. Therefore:

- Preserve the existing export timestamp convention as a separately named policy.
- Keep source timestamp values and their meaning/provenance, requested cut positions, and verified exported positions as separate fields.
- Do not label an inferred capture time as verified.
- Verify dates after marker embedding and filing, not only immediately after the FFmpeg cut.
- Connor subsequently specified Explorer's generic **Date** column and believes he uses **Date modified** in Resolve. These are the intended cross-application acceptance targets.

### Windows property follow-up

For the source and three related exports, Windows Shell exposes Date modified and Media created as expected. The generic `System.ItemDate` property and the shell's Date display column returned no value through the metadata interface for these samples. This does not establish what the live Explorer folder view displays or how it orders ties. Record a direct UI check for the prototype rather than assume Date and Date modified are synonyms. Source and output media were not edited to investigate this.

The property snapshot is `G:\GPT\Work\virtual-cut\engineering-audit\explorer-date-properties.json`. Microsoft defines [System.ItemDate](https://learn.microsoft.com/en-us/windows/win32/properties/props-system-itemdate) as the primary date of interest for an item, distinct from the filesystem modification-date property.

## Implications for the first media prototype

Use this batch for automatic point-marker import, independent cut ranges, outward keyframe selection, metadata propagation, explicit audio mapping, and mapping source points onto clips. The future game-only export policy intentionally differs from these existing two-audio-stream exports. Add playback and export tests separately; the inventory alone does not prove performance or exact cut behavior.
