# Saves and autosave — 0.3.12

## User behavior

- Save / Ctrl+S saves the current edits and viewing position immediately and creates a manual checkpoint. Normal project close/switch also saves.
- Save history contains **Save every** (1, 2, 5, 10, 15, 30, 60 or 120 minutes; **10 by default**) and **Also save after edits** (off by default). Settings persist on this device across projects.
- The timer measures from project open or the last successful explicit save. It saves only changed state. Playback, seeking, reverse scanning and manipulation defer an automatic save, even after the deadline; it runs after activity and edits have settled for two seconds.
- Saving after edits adds a settled-edit save to the timer policy. Moving the playhead alone waits for the timer. No playhead movement creates Undo steps or clears Redo.
- Ordinary editorial work stays in memory until a save. An unexpected exit can lose edits since that save, potentially longer than the chosen interval while transport remains active. Manual Save is the way to protect an important edit immediately.
- Undo/Redo remains available after manual and automatic saves. Reopening a project starts fresh Undo. Restore/recovery also starts fresh Undo. Five autosaves and five manual saves are retained; each is a complete saved project state.
- Source registration, inspection results, jobs and export receipts remain independently durable. Those background operations do not flush unrelated unsaved editorial changes.

## Implementation

The renderer's settled synchronization now updates the native **live session**, rather than writing the project file. This retains responsive audio preparation, validated edits, review acceptance and Undo. A separate scheduler invokes the narrow autosave API when due and idle. Explicit Save/close/restore remain serialized with automatic saves. Failed saves leave live edits available; automatic retry backs off, and Retry saving performs a real manual save.

The native journal stores only changed values, with identity-aware collection edits and ordering. Large frame indexes and waveforms are not copied into each Undo entry. Retention is at most 100 entries with a 32 MiB estimated serialized-memory budget (one large entry can remain). This is not a measurement of total process memory. The journal is never written into new project or save-copy files.

Native operations apply their own changes to the persisted state while preserving the separate live draft. A later explicit save commits the full current state. SQLite still provides atomic working-project writes and independent receipt/job transactions; changing autosave policy does not weaken verified export publication.

Save copies use SQLite VACUUM INTO, including committed WAL state and omitting reusable free pages. A copy must pass integrity verification before publication. The active database can retain a few reusable pages between writes; it need not be byte-identical in size to a compact checkpoint.

## Upgrade and older saves

Saved format 3 opens formats 1 and 2 after creating a verified, labelled pre-upgrade copy. It removes persistent Undo and compacts the working database. The original saved edits, source facts and export receipts remain. The saved-format version prevents older builds from opening the upgraded working file.

On first loading Save history, old rolling manual/autosave copies receive verified compact replacements with the same names, dates and project states. Native records are compared before replacement; a failed conversion keeps the old copy and reports it. Pre-upgrade copies retain their old format and Undo for compatibility and are not pruned with rolling saves. Those deliberate compatibility copies can still be larger. No source media is moved or modified.

## Measurements

Measured on a disposable copy of Connor's M2 Test checkpoint, on G:, September 30, 2026. Original project files were untouched.

| Measurement                                          |                  Result |
| ---------------------------------------------------- | ----------------------: |
| Original checkpoint                                  |       345,284,608 bytes |
| New compact checkpoint                               |         2,052,096 bytes |
| Working file after 40 edits and two saves            |         3,969,024 bytes |
| Retained pre-upgrade compatibility copy              |        51,752,960 bytes |
| Working-file upgrade                                 |                  1.06 s |
| Upgrade of one previously compacted old rolling save |                  0.51 s |
| 40 live edits                                        |      Zero SQLite writes |
| 40 Undo entries                                      | 89,107 serialized bytes |

For the same 40-edit / simulated 20-minute pattern used in the earlier audit, the implemented policy made two saves. Measured checkpoint bytes plus WAL bytes fell from **4,030,574,128** in the old behavior to **7,985,296** (about **99.8% less**). This excludes the one-time migration. It is a write-volume proxy, not host/NAND writes: WAL checkpoint writes, filesystem overhead and device write amplification are excluded. The local harness completed in 2.04 seconds versus 17.87 seconds in the earlier run; hardware/cache effects and changed implementation prevent treating that as a universal speedup or playback-FPS result. Actual checkpoint work in the new run took 96 ms total.

The upgraded model and source/job/export tables matched the input in the real-copy check. Project identity was preserved; the copied project uses its scratch path. Exact sizes depend on project contents.

Evidence: `G:\GPT\Work\virtual-cut\save-iteration\measurement.json` and the regression reports under that directory. Earlier comparison results are under `G:\GPT\Work\virtual-cut\save-audit`.

## Release verification

All 30 maintained scripts passed across the broad run (`broad-reports/run-Qg186H`) and final packaged run (`packaged-reports/run-7wPedH`), with build/type checks and lint passing. The broad run identified one obsolete filmstrip expectation for a Saved pulse after seeking; that check now verifies quiet navigation under the timed policy and passed against the final package. Final packaged gates also cover autosave/failed-save retry, migration/recovery, shell security, playback save deferral and immediate normal close/reopen. Wide and compact screenshots were inspected. These script counts are not a code-coverage percentage.

The portable build is `G:\GPT\Work\virtual-cut\save-iteration\builds\Virtual-Cut-0.3.12-win-x64-2026-10-01T06-32-25-657Z\Virtual Cut.exe`. Native save/recovery and renderer bundle hashes match the final tested build; hashes are retained in `packaged-code-hashes.json` beside the measurement report.

## Review

M243–M245 in the Notion review guide cover timed saving and settings, session Undo/manual-save/reopen behavior, and compact upgrade/history restoration. Existing deep review items remain open. No manual crash or power-loss test is requested on personal projects.
