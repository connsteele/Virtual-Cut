# M3 review — 0.4.5

October 3, 2026. Branch `m3-audio-intelligence`. M3 remains in user review.

This iteration fixes the reported silent Automatic CPU fallback (VC-87). The
0.4.4 review package omitted its NVIDIA library folder from the local runtime
configuration. Its Python and model paths were present, so Automatic continued
on CPU and reported the missing library only in the completed transcript. Explicit
NVIDIA requests failed in Jobs. This was a review packaging mistake.

Build: `G:\GPT\Work\virtual-cut\review-0.4.5\builds\Virtual-Cut-0.4.5-win-x64-2026-10-03T17-59-30-383Z\Virtual Cut.exe`.
Keep the folder together. Continue the existing schema-4 project. Saved CPU
recognition remains readable. The local speech runtime is still installed separately;
this package supplies the correct workstation configuration, including
`G:\GPT\Caches\virtual-cut-asr-gpu`. It is not a portable speech-runtime installer.

The [Notion review guide](https://app.notion.com/p/3ea7c5227a80811d8931c928c47ff3ff)
preserves previous manual results. No new speech engine, alignment or speaker
integration is included. Those changes remain deferred to later M3.

## M317 — GPU readiness before transcription (VC-87)

- [ ] Enable transcription for an import, using Automatic. On this workstation,
      NVIDIA should be reported available before choosing files or a folder.
      Start one desired job and confirm Jobs and its result report NVIDIA GPU.
      A completed CPU recognition from an earlier run should remain available.
- [ ] To review missing-runtime feedback without changing the working runtime,
      choose an empty disposable GPU folder in Transcript settings. Reopen import
      options or use **Check again**. Automatic should warn that CPU can take much
      longer and disable starting until **Continue this request on CPU** is checked
      or CPU is explicitly chosen. NVIDIA-only should remain blocked. The same
      warning should appear in the floating window's **Transcribe…** options.
      No long recognition job is needed for this UI check.
- [ ] Restore `G:\GPT\Caches\virtual-cut-asr-gpu` in Transcript settings and use
      **Check again**. Verify the warning clears and assess its clarity at your
      normal window size. Report source/track, requested device, actual device
      and GPU check details if another fallback occurs.

Opening GPU options performs a lightweight, cached readiness check. **Check again**
refreshes it; there is no continuous polling or model loading for this check.
Model startup can still fail later, for example because GPU memory is unavailable.
Automatic retains its fallback behavior then, but Jobs now displays the CPU device
and reason as soon as the worker reports them, before CPU model loading, and keeps
them through completion and reopening. The readiness message explains this boundary.

## Existing review

Continue unfinished M312–M316 in [0.4.4](review-0.4.4.md) and Notion. This change
does not resolve VC-86's unexplained natural exit or finish the wider long/noisy
audio, provisioning, Resolve subtitle and deferred speaker acceptance work.
Context-aware agent correction remains early M4.

## Engineering evidence

Implementation commit: `d658851`. Separate delivery/version documentation commit
follows. No push or computer-use agent review was performed.

Build/type checks and lint passed. Against the final 0.4.5 package, native transcript
storage/runtime checks, floating transcript/import interactions and Electron shell
smoke all passed. These cover preflight cache reuse and explicit refresh, early and
persisted fallback status, unavailable GPU, CPU acknowledgement, changing devices,
GPU recovery, compact layout and existing word-edit/export interactions. Automated
checks use hidden disposable profiles and synthetic media. Folder/file controls
were exercised; a fresh real drag/drop acceptance check is not claimed.

Final package report:
`G:\GPT\Work\virtual-cut\review-0.4.5\packaged-checks\run-O4wbDb\report.json`.

A separate real-runtime test loaded the packaged configuration with all ASR
environment overrides removed, verified GPU readiness and ran Automatic with the
cached production model and bundled FFmpeg. Its actual device was **CUDA**. The
15-second synthetic silent sample verifies CUDA model startup and dispatch; it
does not measure game-dialogue accuracy or representative throughput.
Report: `G:\GPT\Work\virtual-cut\review-0.4.5\packaged-gpu\run-vPbtEP\report.json`.

The first focused UI attempt caught a readiness callback bug when switching from
acknowledged Automatic to CPU; it was corrected and both subsequent focused and
packaged checks passed. The failed report remains under `focused/run-AVwGAS`.
No fresh full-suite or coverage run is claimed; earlier coverage figures remain
historical. Test reports identify the implementation commit and version-file
changes present while packaging.
