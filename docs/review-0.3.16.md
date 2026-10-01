# Review ordering and Resolve handoff — 0.3.16

Connor authorized useful remaining M2 work while away. This pass implements VC-58, VC-59 and VC-57. It retains the previous chronological editing, bulk destination bar, per-job cancellation and Library focus fixes for the pending M258–M260/M254 review.

## Review ordering

Folder name remains the default. Date modified offers oldest/newest first and uses source Date modified plus the requested In, matching the finished-file date policy. A current Done revision uses its frozen receipt date; drafts use the current source and In. Missing dates are explicit and always last, with name/ID ties for deterministic ordering.

One group per folder combines matching locations and sorts the clips inside each group. Follow sort order preserves the global sequence and repeats a folder when the sequence returns to it. The tree keeps each folder once. Sorting/grouping changes presentation only, preserving acceptance, IDs, edit order and file dates. Review cards remain mounted across regrouping, preserving focused typing fields and the preview element.

## Filed locations

A current Done revision uses its completed Library location in the card, groups, filter/tree and native Explorer action. A verified relink outside the destination root appears separately with its absolute path. The Original plan disclosure preserves the planned folder; Plan another destination opens the existing revision-producing action. Drafts and later edited revisions keep their intended folder instead of inheriting an older completed receipt. Relink does not move files or rewrite historical inputs.

## Handoff

Handoff in the bottom bar and Handoff to Resolve in Exports open one panel. It shows the native helper location and missing/current/outdated/unmanaged/customized state, with install/update, refresh, Explorer and confirmed removal. Removal requires a regular app-owned script matching its ownership hash. Customized scripts, links/directories, unrelated scripts and previous-version backups are preserved. An identical unregistered bundled script can be registered through explicit installation.

The panel explains importing the video with its adjacent companion, selecting Media Pool clips, Check selected clips then Apply marker metadata, and checking markers before a new timeline. Installing/removing a helper does not edit a Resolve project. Existing timeline instances, other Resolve installations and M212 compatibility still need human review. This is a focused panel; the breadth of an eventual full Handoff page remains a design discussion.

## Verification and remaining M2 scope

The focused regression pass includes pure ordering/revision selection checks, native helper lifecycle and Python reconciliation, native filing/recovery, actual Electron sorting/grouping, external relink/draft/Undo/reopen, focused typing and stable viewer identity during regrouping, helper installation/removal/customization revalidation, editing/playback recovery and startup/preload security. Wide/compact screenshots and the final packaged report are recorded in the Notion guide.

New manual checks are M261–M263. Existing unreviewed M258–M260, M254, M249, M212, M217 and O01–O05 stay open; M230 is conditional. Library navigation parity (VC-55), measured renderer/native coverage (VC-50), hosted CI, the terminal demuxer diagnosis (VC-41) and the representative production batch (VC-26) remain. Passing recovery tests does not establish the natural demuxer fault's root cause or complete milestone acceptance.

Build/type checks, lint, formatting and all ten selected regression scripts passed against the final packaged app. Main evidence: `G:\GPT\Work\virtual-cut\review-0.3.16\final-reports\run-BjkZ7Y\report.json`. Final portable build: `G:\GPT\Work\virtual-cut\review-0.3.16\builds\Virtual-Cut-0.3.16-win-x64-2026-10-01T20-17-39-485Z\Virtual Cut.exe`. The earlier preliminary run recorded a test assumption about a newly created clip’s default folder; the corrected test passes with a fresh fixture. Native lifecycle testing uses directory junctions because file-symlink creation is unavailable to this Windows account. These are focused checks; the full 34-script inventory and code coverage were not rerun/measured in this pass.
