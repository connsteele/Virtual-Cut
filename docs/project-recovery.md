# Project recovery and saved versions — 0.3.12

VC-5 adds a real saved-format upgrade and recovery path. It covers project data; output publication and batch-filing recovery remain VC-51/VC-22 work.

## Opening and migration

Projects now use SQLite schema version 3. Before opening an existing project for writes, the store checks the application/version, database integrity, project model, source/job identities, export receipts and supported edit history. Unsupported future versions are rejected without upgrading or replacing them. A failed open keeps the currently open project available.

Version 1 and 2 projects receive a verified `migration-v1-v3-…vcut` or `migration-v2-v3-…vcut` copy in their `.saves` directory before the schema transaction begins. The transaction adds session state/exports when needed, clears persistent Undo, then advances the version. The working file is compacted. If backup creation or validation fails, no schema upgrade occurs. Migration copies appear as **Before upgrade** in Save history and are not removed by rolling-save retention. Reopening version 3 does not create another migration copy. Older rolling copies are compacted with verified replacement; the pre-upgrade copy retains its original format.

The backup uses SQLite [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html#vacuum_with_an_into_clause), including committed WAL records, verifies the copy, then publishes it. Plain copying an open `.vcut` file would omit possible WAL changes. The schema changes themselves use one SQLite transaction.

Older app builds cannot open version 3. To use an older build, use the retained pre-upgrade copy; keep the upgraded working project intact. Restoring a version 1 checkpoint inside the current app restores its edits while retaining the current schema.

## Interrupted sessions and explicit recovery

An opened project records an unclean session until normal close completes. After forced termination, SQLite rolls back unfinished transactions; the app reopens committed state, starts fresh session Undo, and shows the recovered revision with a reminder that edits not finished saving may need repeating. Queued/running jobs and exports become interrupted; reopening does not automatically requeue the selected source's interrupted audio work. Jobs provides explicit retry controls.

**Projects → Recover from save…** chooses a checkpoint, then a new project filename. The native code validates the source, produces and verifies a staging database, gives the recovered project its own identity and publishes it without overwriting anything. Original project/checkpoint files remain intact. The native chooser starts in the last attempted project's `.saves` folder. Cancellation leaves the current project in place. A malformed project presents this recovery action in its error message. Recovery requires a valid checkpoint; this is not a tool for salvaging arbitrary corrupt SQLite pages.

Recovery preserves the checkpoint's clips, annotations, batches and export receipts. It does not copy source footage or export media. It cannot recover edits newer than the selected checkpoint. A new identity keeps original and recovered projects separate in Recent projects and avoids merging the old open draft into recovered state.

## Retention and concurrency

- Five rolling autosave copies and five manual checkpoints, independently retained. Autosaves use a configurable interval (10 minutes by default) and wait for transport/manipulation to stop. Optional saving after edits is off by default. See [save policy](save-policy.md).
- Versioned migration copies retained separately. Their filenames and dates identify the transition.
- At most 100 in-memory editorial undo entries, with a 32 MiB estimated journal budget. Navigation/playhead movement remains outside edit undo. Manual and automatic saves preserve the live journal. Reopen and separate-copy recovery start fresh Undo; restoring a checkpoint into the current project resets the current undo chain after making a protective manual checkpoint.
- A live-process lock blocks a second app writer. Stale locks are removed only when their positive integer PID is no longer running; malformed locks fail explicitly. Native edits remain serialized, with SQLite transactions and revision-aware merges. This assumes a local filesystem with working SQLite locking; distributed filesystem writer arbitration is outside this release.
- If closing the current project fails during a switch, the prospective project's lock is released and the current project stays open.

## Verification

The maintained native recovery test kills a separate process with a transaction open. It proves the preceding saved edit survives, session-only and uncommitted edits disappear, a concurrent writer is blocked, the stale lock is released and running work becomes interrupted. It also checks backup-creation failure, real v1→v3 migration and restore, independent retention, no repeat migration, future-version rejection, corrupt input, separate-copy recovery, no overwrite and project-switch write failure. These are disposable fixtures, not personal projects.

The Electron test exercises failed open → recovery, native dialog arguments, cancellation, a new recovered identity, fresh Undo and migration-save listing at wide/compact sizes. Windows picker responses are stubbed; human picker usability remains in M241/M242. Synthetic process termination is not a power-loss or exhausted-physical-drive certification.

Run `npm run test:suite -- desktop --only=project-recovery-ui.mjs` to build and run both the native prerequisite and actual UI check. The full suite also retains source/export timing, autosave, removal and review regressions. Coverage measurement remains VC-50; script counts are not source coverage.
