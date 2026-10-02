# Local speech runtime

The app communicates with a disposable worker over bounded JSON-lines messages.
`transcript-contracts.ts` contains engine-independent words, phrases, confidence,
timing, jobs and edits. `transcription-runtime.cts` owns process setup/cancellation;
`worker.py` contains the faster-whisper adapter and Windows process guard. Recognition
never runs in the renderer. No model stays resident after a job exits.

## Installation and upgrades

The review build references a separate Python 3.12 installation, an isolated library
folder, an optional NVIDIA library folder, and a downloaded CTranslate2 Whisper model.
The package only embeds workstation paths when `VIRTUAL_CUT_ASR_REVIEW_CONFIG` is supplied.
Public packages do not embed those paths. This is not yet a portable speech installer.

Install the pinned engine requirements into a new dedicated folder or virtual environment.
Keep the old installation until the candidate passes the worker, storage, UI and copied-audio
checks. Select the new folders in Transcript > Local transcription setup. Updating the
engine does not replace saved transcripts: each recognition records engine/runtime versions,
model name, device and pipeline. Existing corrected text and original recognition remain.
To try a completely different recognizer, implement the worker request/event contract and
validate source-relative word timing; project/UI schemas should not depend on its SDK.

On Connor's workstation use explicit G: paths for caches, model downloads, installation
targets, temporary WAVs and benchmark output. GPU DLL search is scoped to the child process.
Do not change machine PATH or vendor another application's Python environment.

Tested engine: faster-whisper 1.2.1, CTranslate2 4.8.2, large-v3. The Windows CTranslate2
wheel includes cuDNN 9; optional `requirements-gpu.txt` supplies cuBLAS 12. Other distributions
must provide both. Setup shows load checks and official installation links. Automatic tries
the GPU then CPU on model startup failure; explicit GPU selection fails visibly.

Before a general release, provide a managed optional runtime/model installer with versioned
directories, verified downloads, licenses, disk-space/progress reporting and rollback.
Do not describe workstation configuration as bundled support.

## Throughput and accuracy

Production keeps one worker/job and one utterance at a time. The developer study can request
batch sizes 2/4/8 inside that one model. Each batch reads at most 180 seconds of PCM and uses
explicit original utterance offsets; it never joins speech across gaps without timing maps.
This path changes decoder behavior and is experimental, unavailable through renderer IPC.
`scripts/transcription-device-study.mjs` compares CPU/GPU and batch variants only on explicitly
supplied disposable samples. Review recognition, cue anchors and timestamps as well as speed
before promoting batching or a new model. Multiple whole-model workers increase memory demand
and contention; they are not the default batch-import scheduler.

Sources: [faster-whisper](https://github.com/SYSTRAN/faster-whisper),
[CTranslate2 performance](https://opennmt.net/CTranslate2/performance.html).
