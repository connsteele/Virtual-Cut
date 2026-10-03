# M3 review — 0.4.6

October 3, 2026. This review supersedes the repeated entry points in older M3
guides while preserving their original results in Notion. M3 remains open.

## New checks

### M318 — More room for the transcript (VC-88)

- [ ] Check the native **Transcription · Virtual Cut** title. Recording, Transcribe
      and settings share one aligned row; **Select transcript** comes before Show.
      JSON/SRT and Follow playback should align with their related selectors.
      The repeated large heading is removed and Help expands the reading instructions
      and model details. Judge the amount of visible transcript at your normal size.
- [ ] Try your usual word seeking, editing, search, Follow playback and keyboard
      navigation in the shorter layout. Compact windows should wrap naturally.
      Settings and start options should remain discoverable without occupying space
      when closed. Your subjective layout acceptance remains open.

### M319 — Prefer the spoken “Marker” cue (VC-88)

- [ ] Use **Marker**, followed by the intended context, on microphone speech.
      For example: “Marker: the gate opens after the battle.” Review the proposed
      title/context and accept or reject it. Game dialogue must never offer editing
      actions. Recognition of new speech still needs your listening check; a manual
      phrase correction can test the rule while retaining the original.

**Marker** avoids the common-name ambiguity of Mark, though no single word
eliminates false recognition. Guarded **Mark** remains a legacy alias for existing
recordings. Both use the same marker action and decision identity, so earlier
accepted/rejected decisions and Undo remain compatible. Nothing is applied without
review. Note, Split and Clip start/end retain their existing meanings.

## Continue only the unresolved checks

| Review            | What is still useful                                                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M314              | Shorten an overlong cue's included context, seek its endpoint, edit the title/note and accept; judge those controls. Paired-title/Undo acceptance already passed.                 |
| M315              | Check source versus completed-clip JSON/SRT save labels and filenames. The old Mark-rule check remains available for legacy recordings; M319 is the new preferred wording review. |
| M316              | Reopen a later searched/filtered page and confirm the full reading state. Unsaved-draft and focus checks already passed.                                                          |
| M308              | Check completed-output offsets and a phrase crossing a cut boundary; this can share the M315 export check. Companion protection has engineering evidence.                         |
| Resolve subtitles | Import a chosen SRT into Resolve and check its scope/timing. Marker handoff is a separate accepted M2 feature.                                                                    |

M301–M304, M307 and M312–M313 have Connor's recorded passes. M302 includes
real file/folder/multi-file-drop consent; M306 includes Connor's cancel/retry note
and the separate objective pause/resume/worker-lifetime evidence. Empty older
checkboxes alone do not require repeating a passed workflow.

Remaining production work is representative long/noisy audio acceptance, portable
speech-runtime provisioning, the unresolved natural exit investigation (VC-86),
and the deferred optional alignment/game-only speaker adapters (VC-81). Mic
speaker identification stays excluded. Context-aware agent correction remains M4.

## Engineering verification

Implementation commits: `cccb792` (preferred Marker with stable decisions) and
`923532e` (compact layout and native runtime recovery check).

Domain/native checks passed. Electron checks cover aligned recording actions,
bounded leading whitespace, selection/correction/Undo, cue context and paired
decisions, exports, reopening, compact windows and GPU warning controls. The first
layout attempt exposed inherited Field margins shifting buttons below the selector;
those margins were removed only within transcript toolbars and the rerun passed.
Earlier failed evidence is retained under `focused/run-nelaWi`.

Focused final report:
`G:\GPT\Work\virtual-cut\review-0.4.6\focused-final\run-oVgMML\report.json`.

Build: `G:\GPT\Work\virtual-cut\review-0.4.6\builds\Virtual-Cut-0.4.6-win-x64-2026-10-03T18-32-53-800Z\Virtual Cut.exe`.
Keep the folder together. This workstation build still uses separately installed
Python, model and GPU dependencies. Existing projects/transcripts remain available.

At Connor's request, M317's two remaining GPU checks passed using the real native
runtime in the final package and a disposable profile. Choosing an empty GPU folder
produced the actual missing-cuBLAS message, warned before file/folder import and
later transcription, blocked Automatic until explicit CPU continuation, and blocked
NVIDIA-only. Restoring the installed folder and Check again restored available GPU
status and enabled starting. Normal app settings and installed files were untouched;
no recognition job was required. Evidence:
`G:\GPT\Work\virtual-cut\review-0.4.6\packaged-checks\run-1m0yoe\transcript-ui\run-RUHJGE\actual-gpu-readiness.json`.

Final packaged domain/native, cue review, transcription UI and shell smoke checks
passed: `G:\GPT\Work\virtual-cut\review-0.4.6\packaged-checks\run-1m0yoe\report.json`.
The prior 0.4.5 real CUDA model run
remains the dispatch evidence; no new acoustic benchmark was needed.
No fresh full-suite coverage or acoustic-quality percentage is claimed.
