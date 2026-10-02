# Virtual Cut 0.3.23 review

M281–M284 passed Connor’s review. This iteration closes the cleanup readability/storage follow-up (VC-74), with two focused manual checks below.

## Changes

- Cleanup groups repeated file types behind keyboard-accessible carets, with counts in parentheses. Single items stay visible. Retained entries are grouped too, with an explanation for each retained file.
- Projects shows Storage immediately below Preview cache: the project and working database, automatic/manual/before-upgrade saves, other save-folder files, thumbnail/audio previews, other cache files, completed videos, companion metadata and referenced source footage. The total excludes source footage.
- **Storage is computed only for the current project when Projects opens or Refresh storage is clicked. There is no polling or continuous monitoring.** A bounded asynchronous file-size pass reads metadata, never hashes/decodes media or saves edits. Repeated paths and hard-link aliases count once. Only known source/output paths and files directly inside the save/cache folders are measured. Missing files and skipped nested/linked folders are identified; these are logical file sizes in 1,024-byte units, not allocated disk sectors or exclusive cleanup ownership.
- Closed checkpoint inspection/restoration/recovery avoids creating SQLite journal files merely by reading a save. Working-project recovery retains ordinary SQLite reads so concurrent committed data is included. Pending/locked saves remain protected.

## Retained-save answer

A valid retained `.vcut` checkpoint can be recovered through **Recover from save** even after the original project is deleted; a generated fixture now proves this explicitly. Recovery creates a separate project identity and restores that checkpoint’s state. Available original media can regenerate previews. Invalid, incomplete or pending saves are not promised recoverable.

The screenshot’s original save folder was unavailable during this inspection, so its exact retained files were not diagnosed. The code retains unverified ownership, links, locks, pending journals, unknown filenames and another project’s saves. The new dialog reports the applicable reason. A disposable older WAL-mode database reproduced support files left by ordinary read-only SQLite access; closed checkpoint reads now avoid that. Existing journals remain protected rather than guessed disposable.

**Source footage, full exports and `.vcut.json` companions remain protected in every cleanup option.** Grouping and storage accounting do not broaden the deletion allowlist.

## Accepted manual review

M285 and M286 passed Connor's review. Optional scrolling within Storage is retained as polish. See [M2 closeout](m2-closeout.md) for the final acceptance and carried-forward observations.

- **M285 — Cleanup grouping and retained reasons:** Open deletion for an expendable project containing several previews/saves. Confirm repeated types show a caret and count, one item stays directly visible, and retained entries explain why they remain. Check keyboard expansion and compact layout. Cancel is sufficient to review the grouping; M284 already accepted actual deletion.
- **M286 — Project storage:** Open Projects and inspect Storage below Preview cache. Compare categories with the project’s files if useful. Make a save or prepare previews, reopen Projects or use Refresh, and expect updated sizes. There should be no repeated measuring while the panel sits open, and no saves caused by viewing storage. Unavailable files are identified, and full outputs/companions remain preserved.

## M2 goalpost

The manual production feature path and Connor’s representative batch have passed their reported review. The board closes the accepted core Review, destination, export, marker mapping, dates, filing, snapping, deletion and whole-pool handoff tickets, plus the automated failure/recovery gate. VC-74 is Done following M285/M286 acceptance.

Keep the specific unreviewed observations visible: M254 Library viewer/typing; M249 Resolve reopen/new-timeline inheritance (repeat checking is accepted via M283); M212 older MP4/MKV tail presentation and separate clip-context observation; M217 statistics behavior. The existing O01–O05 deep recipes remain available without requiring another full successful batch. VC-41 is conditional on a natural terminal playback failure. VC-49’s first hosted CI run requires publication; no push is authorized. M3–M5 and deferred Library latency/parity are outside M2.

## Verification

Build/type checks and lint pass. Focused native checks cover size categories, aliases, offline files, skipped nested folders, no measurement-triggered writes/saves, deletion protections, retained-checkpoint recovery, closed-copy reads, live-source recovery, save/Undo policy and failure handling. Actual Electron checks cover grouped counts, single entries, retained reasons, keyboard expansion, explicit size refresh, wide/compact layout and the real deletion flow. Startup/preload smoke is included.

The first recovery-reader change failed the existing concurrent-commit recovery regression; it was narrowed to known checkpoint files, and the unchanged regression passes. Failed evidence remains recorded. This is focused verification within the existing 39-script inventory, not a new full-suite or coverage measurement.

Build: `G:\GPT\Work\virtual-cut\review-0.3.23\builds\Virtual-Cut-0.3.23-win-x64-2026-10-02T05-59-55-414Z\Virtual Cut.exe`.

Evidence: `G:\GPT\Work\virtual-cut\review-0.3.23\verification-summary.json`.
