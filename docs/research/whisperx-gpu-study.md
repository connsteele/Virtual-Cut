# Local GPU pipeline comparison — October 3, 2026

## Decision

Use WhisperX's alignment and speaker utilities behind optional, replaceable
postprocessing adapters. Retain the production `utterance-v1` recognition policy.
Do not switch the app to WhisperX's default full-file recognition pipeline on these
results. Its speed advantage is real, but sparse speech produced unacceptable seek
positions and cue regressions. Speaker labels need user correction and an unknown
state; they do not establish a fictional character's identity.

This is completed engineering research for VC-81, not a new application build.
The 0.4.3 app, saved transcripts, corrections and normal runtime remain unchanged.
The conditional whole-pipeline refactor is not justified by the quality findings.

## Environment and method

RTX 4090, Windows, Python 3.12.6. Created an isolated environment on G: rather than
updating the working app runtime. `pip check` passed. Primary versions:

- WhisperX 3.8.6; pyannote.audio 4.0.4.
- PyTorch/torchaudio 2.8.0+cu128; torchvision 0.23.0+cu128.
- faster-whisper 1.2.1; CTranslate2 4.8.2, matching production recognition.
- Transformers 4.57.6; huggingface-hub 0.36.2.
- Same cached large-v3 weights, English, no vocabulary hints.
- Community-1 revision `3533c8cf8e369892e6b79ff1bf80f7b0286a54ee`.

Compared three approaches on identical 16 kHz mono PCM copies:

| Approach   | Recognition                                 | Timing and speaker stages                                        |
| ---------- | ------------------------------------------- | ---------------------------------------------------------------- |
| A: direct  | Actual production GPU worker                | Direct pyannote; small overlap-based assignment                  |
| B: aligned | Same production recognition as A            | WhisperX forced alignment, pyannote and WhisperX word assignment |
| C: full    | WhisperX default pyannote VAD, batch size 4 | WhisperX alignment, pyannote and word assignment                 |

CUDA was asserted for recognition, alignment when used, and speaker pipelines.
An unavailable GPU would fail the experiment rather than silently run CPU recognition.
Audio extraction, orchestration, clustering/reconciliation and the current worker's
Silero speech detection can still use CPU. GPU acceleration does not mean every
operation is a CUDA kernel.

Ran serially, avoiding contention between experimental jobs. A/B reuse one actual
production recognition result per source, then add separately measured postprocessing.
Their total includes both process starts. C uses one process. A/B also include a
small WAV-to-WAV extraction; C starts with prepared PCM. These are single workstation
measurements with imports/model loading, not repeated statistical benchmarks or
strictly identical integration boundaries. The first model downloads are excluded.

Twenty-four successful comparisons cover eight samples: DJI commentary, sparse
headset commentary, an approximately eight-minute game track, sparse Cai-folder
dialogue, a four-minute dungeon dialogue and three empty-recognition controls,
including 30 seconds of generated silence. Four additional videos from Connor's
approved Cai folder were copied to G: before extraction/testing. Original footage
was not processed in place or changed. Empty recognition on a game sample is not
proof that the recording contains no human vocalization.

## Measured elapsed time

Seconds, including processing and worker startup at the boundaries described above:

| Sample duration             | Production ASR alone | A: direct | B: aligned | C: full |
| --------------------------- | -------------------: | --------: | ---------: | ------: |
| DJI mic, 60.6 s             |                 6.48 |     12.55 |      13.65 |   11.06 |
| Sparse mic, 475.1 s         |                11.17 |     20.41 |      21.87 |   16.11 |
| Game dialogue, 475.1 s      |                46.07 |     55.73 |      59.83 |   24.47 |
| Sparse Cai dialogue, 80.1 s |                 4.64 |     11.69 |      12.77 |   11.73 |
| Dungeon dialogue, 251.0 s   |                18.77 |     26.46 |      28.69 |   15.82 |

C completes the long game sample about 2.3–2.4 times faster than A/B. Direct speaker
inference, including loading its models, cost roughly 1–5 seconds on these samples;
alignment added approximately 0.7–4.6 seconds. Python imports and separate-process
startup are additional overhead. This supports one serial GPU job with bounded
within-file batching before trying simultaneous recordings; multi-recording GPU
concurrency was not tested here.

Peak process RAM for sequential A/B jobs was about 3.44 GB, dominated by production
ASR. Their postprocessing processes peaked around 1.4–2.5 GB. C peaked near 4.0 GB.
Use the larger of sequential process peaks, not their sum. PyTorch's reported peak
GPU allocation was about 1.71 GB in full runs, but **excludes CTranslate2 allocations**;
it is not total VRAM usage. Other desktop applications also occupied GPU memory.

## Quality and locality findings

All successful comparisons produced finite, ordered word intervals within the
recording bounds when speech was recognized. This structural check is insufficient
to establish a correct word-seek anchor.

1. **Sparse Cai dialogue exposes a clear locality regression in C.** A/B place
   separate phrases at approximately 33, 52 and 57 seconds. C recognizes the latter
   phrases inside a broader span but aligns them around 34–41 seconds. Its speaker
   turns do not support speech at those misplaced positions. B preserves the five
   original phrases and local timing; C omits the opening greeting and labels only
   7 of 15 words, versus B's 17 of 17. Nearest-speaker filling would hide part of
   this error and was disabled throughout.
2. **Sparse microphone cues regress under C.** The current worker retains a Cut
   around 317 seconds; C drops it. C recovers a previously missed Cut near 157
   seconds, but aligns that word to 152.450–157.132, making its seek start several
   seconds early. The previously user-corrected Note around 227 seconds remains
   recognized as No. Forced alignment cannot repair an incorrect recognized word.
3. **Smaller chunks are not a sufficient repair.** A separate 10-second C trial on
   the sparse mic took 18.46 seconds and returned 170 words rather than 159. It
   introduced multiple short “Thank you” phrases in gaps with no corresponding
   speaker overlap, still lost the Cut near 317 and still placed the later Cut
   too early. The original evidence and this failed quality trial are retained.
4. **B is the useful integration direction, with validation.** Matched-word median
   start differences from production were approximately 0.15–0.22 seconds. This is
   agreement, not measured accuracy. Some words shifted by over one second. B's
   output tokenization also changes: the long game's 963 production word objects
   become 961 aligned word objects. A direct replacement would break correction
   indices and lose original confidence/timing evidence.
5. **Speaker counts are estimates.** Pyannote found one cluster for DJI, two for
   sparse headset commentary, six for the long game and four for dungeon dialogue.
   The same speaker stage gives similar clusters under all three integrations.
   Source-frame checks confirm multiple named characters in the dungeon scene,
   but labels are not one-to-one with them: several characters share a cluster.
   Shared voice actors and model merging are possible explanations; neither is
   established here. No human-verified voice reference or diarization error rate
   is claimed. Separate microphone/game roles remain essential.
6. **Empty inputs complete.** All three approaches returned zero words on generated
   silence and two additional empty-recognition game samples. Pyannote emitted a
   cluster on one such game recording despite no recognized words. A speaker turn
   alone must not create transcript text or a confident character label.

No WER, DER or overall recognition accuracy percentage was measured. Transcript
agreement, word counts, visible dialogue names and bounded timestamps are different
forms of evidence. Overlapping voices, hour-long recordings, other languages and
other GPUs remain unvalidated.

## Offline, provisioning and lifecycle

The complete pipeline first passed with locally authenticated model access. It then
passed with socket connections blocked, offline flags enabled and no token available
to the test process. Every WhisperX/pyannote comparison process used this
blocked-network configuration. A/B's reused production recognition ran with its
existing Hub-offline policy and explicit local model, rather than the socket patch.
No audio or transcript was uploaded. Hugging Face and pyannote telemetry were disabled.
Cached models can be used without a login during inference; initial access/download
still requires the model's conditions and credential setup.

Using the application's existing Windows Job Object guard with the experimental
CUDA stack, active cancellation was checked after the loaded recognition, alignment
and speaker stages began. Killing the test parent was also checked. All recorded
owned processes exited, sources retained their hashes and cancelled runs published
no completed result. Observed release times were 38–48 ms. These are guard/process
tests, not a claim that the application's new-stage UI cancel/retry integration exists.

Failed harness attempts are retained: nested subprocess output initially did not
reach the parent, and a subsequent run found an old result at a reused output path.
Explicit output forwarding and unique run paths fixed those test issues. The final
four lifecycle cases passed. An initial empty-game case also correctly exposed the
harness's invalid assumption that every selected game recording contained speech.

TorchCodec's native decoder did not load on this Windows environment because suitable
FFmpeg shared libraries were not available. Feeding preloaded PCM to the pipeline
worked. Keep the app's existing FFmpeg extraction rather than adding a second decoder
requirement. Do not claim arbitrary TorchCodec file-path decoding passed.

The model is available for free local GPU inference. Its model card lists CC BY 4.0;
WhisperX code uses BSD-2-Clause and pyannote.audio code MIT. Preserve attribution and
review each alignment/model license before shipping models. The stable WhisperX
release pins Torch 2.8 and requires huggingface-hub below 1; the production environment
has a different Hub version. An isolated, versioned runtime avoids breaking it.
Licenses do not by themselves settle a redistribution/provisioning design.

## Integration work selected for VC-81

1. Separate recognition, alignment and diarization provider contracts. Normalize
   third-party results at one boundary; keep project/UI storage independent of
   WhisperX classes. Record runtime/model versions and stage-specific fingerprints.
2. Retain immutable production recognition and approved correction indices. Store
   refined word anchors, alignment scores and speaker turns as separate derived
   layers keyed to the original transcript. Alignment score is not ASR confidence.
   Never replace the original word list with a differently tokenized result.
3. Align within preserved utterance spans. Reject or flag missing/nonfinite timings,
   large displacement, implausibly long words and intervals outside speech support;
   fall back to original anchors. Use validated anchors for clicking words. User
   corrections remain independent of automatic timing proposals.
4. Speaker detection stays off by default and can run later on existing recognition.
   Use transcript-scoped Speaker 1/2 labels, real overlap and Unknown; preserve
   overlapping-turn evidence. Provide assignment/name corrections. Community-1's
   exclusive turns are a potential reconciliation option, not a tested improvement.
5. Reuse the guarded worker lifecycle, with one model stage loaded at a time and no
   resident inference while idle. Preserve source offsets, cancellation, cleanup
   and retry. Test those through the app before shipping the feature.
6. Explicit setup/preflight must distinguish missing CUDA, alignment assets, speaker
   weights and cached tokenizer resources. No automatic model download on import.
   Keep credentials outside projects/logs; normal credential storage can stay on C:,
   while large runtimes, models and intermediates remain on G: on this workstation.

Whole-pipeline recognition remains a candidate for continuous game dialogue after a
locality-preserving recognition adapter and broader listening review. The faster C
result does not justify applying its sparse-speech behavior to all tracks today.

## Evidence and references

Local private evidence: `G:\GPT\Work\virtual-cut\whisperx-study`.
`matrix-summary.json`, `extra-matrix-summary.json`, `dialogue-matrix-summary.json`
record the 24 comparisons; `quality-summary.json` records timing differences and
counts; `lifecycle-summary.json` records process checks. Full stage logs, original
recognition, aligned results, source hashes and pinned `requirements.lock.txt` remain
there. Private audio, video, images, transcript bodies and credentials are not committed.

- [WhisperX stable 3.8.6 dependency requirements](https://raw.githubusercontent.com/m-bain/whisperX/v3.8.6/pyproject.toml).
- [WhisperX implementation and limitations](https://github.com/m-bain/whisperX).
- [Community-1 GPU, in-memory, offline usage and model license](https://huggingface.co/pyannote/speaker-diarization-community-1).
- [pyannote.audio code and optional telemetry](https://github.com/pyannote/pyannote-audio).
