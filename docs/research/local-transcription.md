# Local transcription research

Research checked September 28, 2026. This is a source-based assessment; no models were downloaded or benchmarked for this note.

**October 2 implementation update:** The 0.4.0 review implements the selected local runtime and disposable worker. See [M3 implementation](../m3-implementation.md) and [M3 review](../m3-review.md) for measured results and remaining acceptance. The proposals below preserve the original research context.

## Product decision

Run speech recognition locally. A cloud speech account and per-minute payment must not be required to transcribe, search, or review footage. An agent correction pass is optional and separate from recognition. Preserve the original recognized text and accepted corrections.

Connor selected **faster-whisper** as the initial engine. His additional requirement is that its worker must be fully stopped whenever Virtual Cut is not explicitly running a transcription operation. This was an unimplemented requirement at the time of this research; the October 2 implementation now has real completion, cancellation, failure and parent-crash lifecycle checks.

Keep the React/TypeScript/Electron application. Run speech recognition in an isolated worker that reports progress, cancellation, source-time segments, optional word times, language, and engine/model version. A Python runtime or native executable is a contained dependency, not a whole-application rewrite.

## Shortlist

| Candidate | Relevant capability | Assessment for Virtual Cut |
| --- | --- | --- |
| faster-whisper + Whisper large-v3 | CTranslate2 GPU/CPU execution, batching, VAD, word timestamps | Initial implementation baseline. Test large-v3 for quality, then turbo as a speed alternative. Ship a controlled worker/runtime and downloadable model files. |
| Qwen3-ASR 1.7B + Qwen3-ForcedAligner 0.6B | Open recognition and alignment models; Transformers path supports offline transcription with timestamps | Quality challenger. Verify Windows dependency packaging, long-recording behavior, memory use, and game names. Do not assume published general benchmarks predict gameplay accuracy. |
| WhisperX | faster-whisper recognition plus a separate alignment pass | Add if baseline word positions are inadequate. Alignment increases dependencies; overlapping speech and some words remain difficult. Speaker identification is unnecessary for distinguishing already-separated game and mic tracks. |
| whisper.cpp | Standalone native Whisper implementation with NVIDIA GPU support | Packaging alternative if a native sidecar is easier to distribute than a Python worker. Integration does not require writing the app in C++. Benchmark timestamp and decoder behavior before choosing it. |
| NVIDIA Parakeet TDT 0.6B v3 | Word/segment timestamps, punctuation, multilingual recognition | Worth a later speed/quality comparison. Validate the chosen Windows runtime and packaging path rather than assume the NeMo reference setup is a turnkey Windows installer. |

## Recommendation

Start the prototype with the selected faster-whisper engine and Whisper large-v3. Treat large-v3-turbo as a speed/quality tradeoff to measure. Alternative engines in the shortlist are fallback research if measured quality or packaging problems justify revisiting the decision; comparing them is not a prerequisite to starting. Add WhisperX only if timestamp errors justify it. Keep a narrow worker interface so a future speech backend can change without rewriting the UI or project records.

The RTX 4090 workstation is a plausible GPU target. No specific processing speed or concurrent Resolve/OBS performance is established yet. Model loading, decoding, batching, and GPU competition all need measurement.

## Worker lifetime and integration

Required user-facing behavior:

- Opening Virtual Cut, importing footage, searching saved transcripts, and viewing a transcript do not start recognition or load the model.
- Start recognition only for an explicitly requested transcription job or a user-started agent workflow that includes transcription within its authorized scope.
- A selected batch may share one model load while its transcription work is actively progressing. When that work finishes, the worker exits. Do not keep an idle worker or warm model pool between operations.
- Completion, cancellation, failure, or application exit must stop the worker and its child processes. If pause is supported, persist completed work and exit; a suspended process still holding model memory does not satisfy this requirement.
- Show Loading, Transcribing, Stopping, and Off states. Show Off only after confirming worker termination. Already-saved transcript search remains available while Off.
- Retain downloaded model files in a configurable disk location, using the approved G: cache locations on Connor's workstation. Files on disk are not a running model. Loading them again adds a startup delay, to be measured.
- Do not resume recognition automatically after an app restart or crash. Preserve completed segments and offer an explicit resume action.

Proposed Windows implementation:

1. The Electron main process owns a job manager. A packaged Python worker contains faster-whisper and its pinned runtime dependencies. Exchange structured job requests, progress, timed results, and errors over local process pipes; a resident server is unnecessary.
2. Place the worker and its children in a Windows Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. The last job handle must be owned by the application and must not be inherited by workers. Disallow worker breakaway and associate the process before it begins model work. This ties cleanup to the owning process even when its normal shutdown handler cannot run.
3. Request cooperative cancellation first so completed segments can be saved. After a bounded shutdown interval, terminate the job's processes and verify exit. Handle a worker that hangs on normal completion the same way. A simple Python object deletion or a signal to one process is not the complete lifecycle contract.
4. If a small Windows launcher or native binding is needed for Job Objects, keep it behind the job-manager interface. This does not change the app's React/TypeScript stack. Select the launcher/binding after a focused integration test.
5. Pin and package compatible Python, CTranslate2, and GPU runtime dependencies. The current faster-whisper documentation specifies CUDA 12 cuBLAS and cuDNN 9 for current CTranslate2 releases. Validate the final Windows package on a clean installation; GPU packaging and process teardown are meaningful engineering tasks even though the recognition API is small.

Acceptance checks before claiming the requirement is met:

- No recognition worker or model allocation after app launch or transcript search.
- Worker tree gone after success, cancellation during loading and recognition, an injected error, pause, and application close.
- Worker tree gone after forcibly terminating the owning app process; no orphaned children or inherited job handles keep it alive.
- Worker-owned GPU allocations are released after termination; compare with the pre-job baseline without expecting the Electron UI, Resolve, or other apps to stop using the GPU.
- Repeated runs and batches leave no accumulating workers or allocations. Resume preserves source timestamps and does not duplicate saved segments.

These are planned checks, not completed tests. No model has been installed or downloaded for this planning work.

## Language behavior to settle

Confirm the typical spoken language of game recordings; microphone notes can have a separate setting. Support a project language choice with per-recording override and automatic detection where needed. Recognition should preserve the spoken language; any translation is a distinct future decision and should not be silently substituted for transcription.

## Transcript flow

1. Select the intended source audio stream using the intake role mapping.
2. Extract/resample bounded audio inputs into task scratch while retaining their exact source offsets. Keep game and microphone transcripts separate.
3. Run local recognition with speech detection. Persist partial results and absolute source-time positions so interruption does not discard completed work.
4. Provide searchable text with click-to-seek, even when optional agent correction is disabled.
5. Offer a project/game glossary and an optional correction pass. A correction records the previous text and affected timed span. Changed word tokenization needs realignment or an explicitly retained phrase-level range; never fabricate word timing.
6. Map transcript spans to exported clips using verified source-to-export timing. One source passage may link to several overlapping exports.
7. At source retirement, retain transcripts/notes and lineage. Remove mic-bearing temporary assets after the requested transcription is saved and reviewed, or after the user explicitly chooses to discard that content. Exporting game-only clips can happen before transcription finishes if originals are retained.

The export process should exclude the mic stream while copying the intended video/game audio. A later filing operation can perform the equivalent verified remux for existing cut imports. Source destruction is a separate explicit cleanup operation.

## Evaluation sample

### First microphone sample — September 29, 2026

A one-off review used a disposable copy of Connor's 475.13-second OBS recording, with the second audio stream extracted as 16 kHz mono on G:. The recording is 3840 × 2160 AV1 at 60 fps, with two stereo 48 kHz FLAC audio streams and no embedded chapters. This longer source helps test sparse spoken cues; it still does not establish hour-long playback or processing behavior.

Reused the existing G: cache of faster-whisper 1.2.1, CTranslate2 4.8.2, and large-v3. Ran CPU int8 with four threads at below-normal process priority, without a cloud service, new model download, GPU inference, or a resident server. The full-file VAD pass completed in about 47 seconds; a separate-utterance pass used about 101 seconds of recognition time for 13 utterances. The latter measurement excludes model loading and speech detection, so it is not directly comparable to the first pass's end-to-end time.

Observed limitations:

- All three cue types and useful recording context were present in recognition output, but several short commands were substituted with ordinary words (Note/no/now, Cut/but).
- Concatenated speech across long silent gaps produced erroneous word anchors, including a Mark attached to the end of the previous utterance. Retain original speech spans and validate command timing against them; do not trust a word-timestamp array by itself.
- Separating utterances restored useful locality but did not resolve every word. Proper nouns and complete intent must be reviewed; cue/glossary prompting can also introduce an expected command. Disagreement between passes remains visible.
- Connor supplied two reference corrections: the word around 03:47 is Note despite repeated recognition as “No,” and around 02:37 there is a Cut that unprompted recognition missed. This establishes concrete missed/substituted cues in the sample. He recorded with a wireless-headphone mic and has a DJI mic available for a later matched comparison; its effect has not been measured.
- The supplied speech includes relative cut targets such as a black transition. Command time and intended cut location must be separate fields.
- Model output on isolated non-speech activity is not sufficient evidence of a command. Speech detection, signal context, and human review remain necessary.

This prototype is outside Virtual Cut. Normal job exit can be checked for these temporary workers; app cancellation, crash cleanup, and Windows Job Object acceptance requirements remain unimplemented. The local review artifacts are under Connor's approved G: scratch storage rather than tracked with the application.

### DJI microphone sample — September 29, 2026

A later 60.62-second recording tested a lav connected to the DJI microphone, then its built-in microphone, with game audio playing through TV speakers. The raw microphone track was recognized locally using the same cached large-v3 CPU-int8 configuration as the earlier headset sample, without vocabulary prompting or an agent correction pass. Full-file recognition completed in about 30.7 seconds including loading and returned coherent commentary for both configurations, with no transcript text in the surrounding background-only periods.

Bounded rechecks of the two speech sections largely agreed. The built-in section retained the same wording; the lav section had small disagreements in the opening sentence and one substitution of the word lav. This is a promising result for conversational notes, not a controlled accuracy score or a validation of spoken cue commands. The earlier headset sample contained isolated cues and game names that this test did not repeat.

Measured mic background averaged about −57.8 dBFS in a selected lav pause and −56.9 dBFS in a selected built-in pause, with different game content/levels between those windows. Neither setup clearly wins the background-rejection comparison. These are recorded levels, not intrinsic microphone self-noise measurements. The two temporary recognition workers were verified exited. Artifacts and the full report are under `G:\GPT\Work\virtual-cut\dji-mic-20260929`; no app transcription runtime was added.

### Further evaluation

- Clearly spoken dialogue containing distinctive character, location, and item names.
- Dialogue under music, combat effects, and short battle callouts.
- Silence/non-speech passages, checking for invented text.
- Separate spoken mic observations once a representative recording exists.
- A longer recording to test chunk boundaries and recovery.

Compare missed/incorrect words, proper-noun spelling, useful seek positions, false speech, run time, peak memory, UI playback during processing, and packaging effort. Use manually checked excerpts as reference. Published model rankings alone do not settle these requirements.

## Sources

- [faster-whisper runtime](https://github.com/SYSTRAN/faster-whisper)
- [Windows Job Objects and termination when the last handle closes](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Whisper large-v3 model](https://huggingface.co/openai/whisper-large-v3)
- [Whisper large-v3-turbo model](https://huggingface.co/openai/whisper-large-v3-turbo)
- [Qwen3-ASR and its forced aligner](https://github.com/QwenLM/Qwen3-ASR)
- [WhisperX, including alignment limitations](https://github.com/m-bain/whisperX)
- [whisper.cpp and NVIDIA support](https://github.com/ggml-org/whisper.cpp)
- [Parakeet TDT 0.6B v3 model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)

Before distribution, record the license of each pinned runtime, model, alignment model, and dependency. The shortlist is a technical recommendation, not a completed packaging audit.
