# Local speech runtime

The app communicates with a disposable worker over bounded JSON-lines messages.
`transcript-contracts.ts` contains engine-independent words, phrases, confidence,
timing, jobs and edits. `transcription-runtime.cts` owns process setup/cancellation;
`worker.py` contains the faster-whisper adapter and Windows process guard. Recognition
never runs in the renderer. No model stays resident after a job exits.

## Installation and upgrades

From 0.4.7, **Transcription > settings > Download local speech setup** offers an
optional managed Windows x64 installation. Choose a storage folder, inspect download
and disk requirements, then explicitly start. Recognition uses no account or audio upload.
The managed engine is separate from Electron and does not change machine Python or PATH.
The package only embeds workstation paths when `VIRTUAL_CUT_ASR_REVIEW_CONFIG` is supplied;
public packages can use the same setup flow without those paths.

`runtime-manifest.json` pins the Python 3.12.10 embeddable archive, every transitive
Windows wheel (including faster-whisper 1.2.1 / CTranslate2 4.8.2), and the large-v3
model revision. SHA-256 and byte counts are verified while streaming each download.
Python's hash was checked against its official Sigstore digest; wheel hashes against
PyPI release metadata; model.bin against the Hub's LFS digest. Small model assets are
pinned from the same immutable revision. Setup never resolves newer packages at run time.

Each installation has a fresh owned folder and receipt under `Virtual Cut speech`.
Archives are extracted with traversal/link protection and removed after use. Libraries,
versions and tokenizer/config files are validated without loading a speech model. **Use
this setup** activates it separately; **Restore previous setup** preserves the old folders.
A completed candidate survives app restart. Normal cancellation removes only the verified
owned incomplete folder; orderly app exit waits for this cleanup. An unexpected process
exit may leave an incomplete directory;
there is no automatic scan or deletion of arbitrary folders. Recognition setup is shared
across projects and retained by project cleanup.

The NVIDIA option adds cuBLAS 12; the selected CTranslate2 wheel supplies cuDNN 9.
A compatible NVIDIA driver is still a system prerequisite. Readiness and per-job device
warnings remain authoritative. Python and dependency licenses are retained in their
installed directories; NVIDIA libraries use their proprietary license. See the official
[Python release](https://www.python.org/downloads/release/python-31210/),
[faster-whisper installation](https://github.com/SYSTRAN/faster-whisper#installation),
and [model](https://huggingface.co/Systran/faster-whisper-large-v3).

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

This is the first managed setup review, not a signed installer/update service or a promise
of every Windows hardware configuration. Test a new manifest in a separate folder before
release. Additional models and speaker adapters can have their own pinned manifests;
the project/transcript contract stays independent of the installation mechanism.

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
