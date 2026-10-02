# Virtual Cut 0.3.22 review

Connor accepted M279/M280 and reported a successful VC-26 workflow for save/reopen, completed clip playback and Resolve marker handoff. This does not assume that every collision, interruption, relink or container edge case was separately exercised. Review the changed behaviors below; repeating the entire successful batch is unnecessary.

## Changes

- **Cut:** The small trash button beside range End removes only the endpoint. The point retains Start, name, note and color. Manipulate snapping now includes other point markers, both range ends and both clip ends, alongside the stationary playhead. Whole-range movement can align either endpoint without changing duration. Targets freeze at pointer-down; self-targets are excluded; the nearest valid visible boundary within ten screen pixels wins. Frame/source limits, Escape and Undo still apply.
- **Review:** Trim appears whenever the range excludes part of the source, even when its name and other metadata are unchanged. Tree starts open. The filing dialog is wider, keeps each In/Out pair together, and exposes clickable destinations in Plan and Progress. Uncreated destinations open their nearest existing parent; clicking does not create folders.
- **Resolve:** Update the helper from Handoff. Check whole Media Pool recursively visits bins and finds adjacent `.vcut.json` files for MP4, MKV, MOV, M4V and WebM. Check selected clips remains available. Discovery checks each unique path once without decoding or hashing video. Matched videos still receive full verification; Check reports discovery and total time separately. Verification is shared for repeated paths within one Check, and changed plans revalidate before Apply. A manifest is deferred unless real projects show discovery itself is slow.
- **Projects:** Each Recent row has a right-aligned trash button. The confirmation previews exact files and offers Delete without cleanup, Delete with cleanup and Cancel. An open project is saved and closed before preparing this preview; Cancel then deletes nothing and leaves it closed.

## Cleanup scope

Delete without cleanup removes the selected `.vcut` project file and its Recent entry. Delete with cleanup also removes verified same-project autosave, manual and migration save copies, and recognized disposable source thumbnail/audio preview files. The empty saves directory may be removed; directories are never recursively erased.

**Source footage, completed exports and their `.vcut.json` companions are always preserved. No option deletes exports.** Project files in use, pending SQLite journals, changed files, hard links and directory links prevent unsafe cleanup. Caches shared by another known project are retained. If a recent project cannot be inspected, cache cleanup is conservatively skipped. Unknown files and unproven interrupted export stages remain; the preview identifies retained entries. Installed helpers, shared diagnostics, app settings and other projects remain.

Filmstrip images already live in bounded memory, so there are no filmstrip image files to erase. Original recordings and finished outputs can reside inside user-selected cache roots; recorded source/output identities override disposable-looking filenames.

## Focused manual checks

- **M281 — Marker End and peer snapping:** Remove End and Undo; check Start and metadata survive. With H/Snap on, move a point, range edge, whole range and clip edge close to other annotations. Check the fixed viewer, teal guide, zoom, Snap off and Undo/Escape.
- **M282 — Review and filing clarity:** A same-name trimmed clip shows Trim; a full-length unchanged clip does not. Tree initially shows. Confirm each requested/outward In/Out pair remains on one line, and destination links open the intended folder in Plan/Progress.
- **M283 — Whole Media Pool handoff:** Update the helper, use a disposable Resolve project with outputs in several bins, and run Check whole Media Pool without selecting clips. Inspect the plan and apply it. Recheck for no duplicates and confirm notes/colors/ranges. Check selected clips remains a narrower option. Report whether scanning feels reasonable; no timing spreadsheet is requested.
- **M284 — Project deletion:** Use an expendable test project. Inspect files, Cancel, then try each deletion option on separate test projects. Sources, finished exports and companions must remain. Confirm the row disappears and that cleanup removes only its listed disposable files.

## Engineering evidence

Native and Electron checks use generated media and disposable projects. They cover peer snap targets and stationary retiming, Review trim/tree state, wide/compact filing layout and Explorer actions, helper discovery/verification, and deletion protections including changed files, locked saves, shared caches, hard links and junctions. Live whole-pool Resolve acceptance remains M283.

The helper's synthetic local lookup measurement covers 5,000 path-existence checks; it excludes Resolve API overhead, network disks and full-media hash verification. The full verification cost still scales with matched video size. Coverage percentages from 0.3.21 remain a historical baseline; this iteration does not claim a new full coverage measurement.

## Delivery

Build: `G:\GPT\Work\virtual-cut\review-0.3.22\builds\Virtual-Cut-0.3.22-win-x64-2026-10-02T05-13-01-303Z\Virtual Cut.exe`.

All eleven selected maintained scripts have passing evidence across the focused development run and corrected packaged run. The initial deletion fixture required a Windows symlink privilege; it was replaced with hard-link and directory-junction protection cases, and both native/UI deletion checks passed. The original failed/skipped records remain. All five selected delivery scripts passed against the package or its native build prerequisites. Build/type checks, lint, changed-file formatting and diff checks passed. Wide/compact filing, range, Review and deletion screenshots were inspected.

Reports: `G:\GPT\Work\virtual-cut\review-0.3.22\checks\run-4ji1dQ\report.json` and `G:\GPT\Work\virtual-cut\review-0.3.22\packaged-checks\run-nEkPtG\report.json`. The reconciled summary is `G:\GPT\Work\virtual-cut\review-0.3.22\verification-summary.json`. This is focused scenario verification within the 39-script inventory, not a full suite or live Resolve acceptance pass.
