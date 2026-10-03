# M3 review — 0.4.7

October 3, 2026. This iteration closes the workstation-only recognition setup gap.
It keeps the current engine, fixes the new page-following note, and incorporates
Connor's latest 0.4.6 results and requests. M3 remains open.

## M321 — Follow playback across pages (VC-91)

- [ ] Enable **Follow playback** on a transcript with several pages. Play through a
      page boundary without stopping; the next page should appear and keep the spoken
      word visible. Seek backward across a boundary too. Search, cue filters, editing
      and manual page navigation should still keep their requested reading state.

The old isolated-seek check missed a timing-dependent failure. Continuous position
updates could invalidate each pending page lookup before it returned. A reproducer
with 140 ms updates and a 350 ms native lookup remained on Page 1 before the fix;
the fix permits one lookup per reading context and ignores results after changing
that context. Forward/reverse streams and actual source playback now pass. This
establishes a failure path, not the exact latency in your reported session.

## M320 — Optional local speech setup (VC-90)

- [ ] Open **Transcript > settings**. Under Download local speech setup, choose a
      disposable folder on G: and review the size/free-space summary. Choosing the
      folder must not download anything. NVIDIA libraries are optional; leave them
      selected for the GPU check. Judge the wording and discoverability.
- [ ] If you want to exercise a download, choose **Download and install**. Progress
      and Cancel setup should be clear. After cancellation the prior setup stays
      selected. A complete setup requires **Use this setup** before it becomes active.
      The agent has already tested actual downloads, verification and GPU startup;
      you do not need to repeat a large download to supply that evidence.
- [ ] After activation, check that Automatic reports GPU ready and try one desired
      transcription. Existing recognition/corrections remain available. Use **Restore
      previous setup** to return, then close/reopen and confirm the selected setup.

Download with NVIDIA libraries: 3,583,255,544 bytes (~3.34 GiB). Installed files:
3,932,352,971 bytes (~3.66 GiB); required free space includes an extraction reserve.
The chosen folder is shared between projects, so project cleanup keeps it. Existing
setups are not deleted. Downloaded model files remain on disk; no model stays resident
just to read saved transcripts. No account is needed for recognition. Optional game
speaker models have separate prerequisites and are still deferred under VC-81.

The current release is an unsigned Windows folder build. Managed setup supports
Windows x64 and the pinned engine/model; it is not a general-purpose Python installer.
An unexpected exit during setup may leave its incomplete folder. A completed candidate
and the previous runtime choice survive restart. Closing normally during a download
waits for removal of its verified partial folder. Compatibility on a clean second
computer still needs acceptance; this workstation's NVIDIA driver remains installed.

## Continue the unresolved review

M318, M319 and all of M316 now have Connor's recorded passes. Compact controls and
Marker are accepted (VC-88 Done); normal window reading-state restoration does not
need repetition. VC-80 retains its actual changed-monitor validation criterion;
ordinary focus acceptance and automated offscreen bounds do not prove that case.
The optional brief (VC-75) and paired-title behavior (VC-82) are also closed from
the recorded M301/M307 and M314 acceptance respectively.

Continue M314 context shortening using **Marker** or Note. The mixed M315 review
is split below as requested; the original checkboxes/callout stay in Notion history.

### M322 — Marker candidate guards (VC-84)

- [ ] If reviewing candidate precision, use preferred **Marker** wording with
      deliberate context and compare ordinary name/addressed speech. Candidates must
      remain tentative and microphone-only. Report source/track/time for false or
      missed proposals. M319 already accepted the basic Marker flow; no repetition
      is required. Legacy Mark is compatibility guidance, not the preferred recipe.

### M323 — Standalone transcript export scope (VC-85 / M308)

- [ ] Export source and completed-clip JSON/SRT separately. Confirm the selected
      source/clip name and role in the save dialog, then check the completed clip's
      actual outward-cut offsets, including speech crossing a boundary. This checks
      existing standalone export, not the newly requested automatic video sidecar.

### M324 — Resolve native transcript reuse (VC-40 research)

- [ ] On a disposable clip, use Resolve's **Transcription window > Options > Import
      Subtitles** with its clip-relative SRT, rather than dropping SRT on a timeline.
      Check source timecode, search, seek and timing. Note whether imported phrase
      boundaries provide useful word selection. No second recognition run is needed.

The installed Resolve 21.1 manual documents this path (PDF page 1009). Resolve 19
also documents Media Pool > Audio Transcription > Import from Subtitles. The installed
21.1.1 scripting API has generation/read/clear methods but no transcript importer.
Automatic batch attachment is therefore not promised. See
[Resolve transcript handoff research](research/resolve-transcript-handoff.md).

## Latest requests intaken; not included in 0.4.7

- **VC-92:** reorder entire control rows per the screenshot, putting transcript
  selection near search while preserving alignment and compact wrapping.
- **VC-93:** replace the bottom F11 hint with discoverable Help, starting with
  spoken-cue examples and review behavior. Broader help is **Later VC-95**;
  user-defined vocabulary remains VC-89.
- **VC-94:** offer clip-named, correctly rebased SRT from video export and Review
  filing; optionally preserve richer transcript data in the companion. JSON embedding
  alone cannot populate Resolve's native transcript store. Existing **VC-40** retains
  the separate native/batch attachment investigation, rather than creating a duplicate.

These are planned work, not checkboxes asking Connor to test absent controls.

Remaining engineering includes optional game-only speakers (VC-81), the searchable
saved/custom game picker in VC-53 (core inheritance/override behavior already passed),
and representative longer/noisier audio acceptance (VC-23). Keep the natural-exit
investigation VC-86 open for captured evidence. A clean second-computer provisioning
check is still needed; this download test used a new profile on the current workstation.

## Engineering evidence

Implementation: `6420faa`. Native setup checks cover bad hashes/byte counts,
cancellation, unrelated-file preservation, archive traversal and activation refusal.
Two actual cold download/install runs completed; each reached validated Ready and CUDA
model startup. They exposed a relative default-path restore defect, fixed before delivery,
and a test-only undefined-property comparison. A subsequent lifecycle rerun reused the
verified candidate, then the final full suite performed another cold download and passed
activation, restore, persistence and GPU recognition on synthetic silence. Its install
took 25.56 seconds on this connection. Silence proves model dispatch, not speech quality.

Final cold-install/lifecycle report:
`G:\GPT\Work\virtual-cut\review-0.4.7\final-regression\run-MRPgvD\speech-setup\run-lWGSlX\report.json`.

Electron checks exercise native folder planning, no-download consent, smaller plans
without NVIDIA libraries, unchanged runtime settings, compact wrapping, keyboard focus
and reopening the planned setup. The existing review check was updated for the renamed
manual-setup expander. Subjective UI/acoustic acceptance is left to Connor.

All **47 maintained scripts** have passing evidence across the full run and a corrected
focused retry, covering **90 application files**. The full run exposed an invalid legacy
assertion expecting another Undo after undoing the first edit of a reopened project;
the test now checks Redo. Session history remains intentionally empty on reopen.
Original failed reports are retained. Matching source fingerprints/maps were checked
before explicit latest-attempt reconciliation; no mismatched run was merged.

Combined coverage: **85.69% lines / 78.44% functions / 78.62% branches**. All fifteen
unchanged critical-module floors pass, with complete collection. Two deliberately
terminated worker counters remain conservative/partial. Python coverage, acoustic
accuracy and clean-second-computer compatibility are separate from these percentages.
See [coverage](coverage.md).

All **seven selected packaged scripts plus build** pass in the final uninstrumented
0.4.7 package, including actual missing/restored GPU checks, continuous page following,
native setup/lifecycle, transcript storage/interactions and shell smoke. Packaged setup
reused the verified candidate; the source suite performed the cold download above.

Build: `G:\GPT\Work\virtual-cut\review-0.4.7\builds\Virtual-Cut-0.4.7-win-x64-2026-10-03T20-18-54-958Z\Virtual Cut.exe`.
Packaged report: `G:\GPT\Work\virtual-cut\review-0.4.7\packaged-checks\run-1OkGfT\report.json`.
Final coverage: `G:\GPT\Work\virtual-cut\review-0.4.7\final-coverage\summary.json`.

Implementation commits: `6420faa` (setup), `2346c85` (coverage harness), `48e2a16`
(normal-exit cleanup), `2462948` (continuous following), `26f3282` (Redo assertion).
Source is local on `m3-audio-intelligence`, not pushed. Speaker integration, broader
acoustic acceptance and the natural-exit investigation remain open. Context-aware
agent correction stays M4; custom cue vocabulary stays Later without a milestone.
