# Transcription throughput — October 2, 2026

One copied 475.1-second headset recording, separate game and microphone streams, English,
no vocabulary hints, large-v3, faster-whisper 1.2.1 / CTranslate2 4.8.2.
RTX 4090 24 GB, driver 617.14. CPU used int8/four threads; GPU used float16.
Measurements include process startup, audio extraction, model loading, VAD and recognition.
These are single runs with different warm-cache conditions, not a hardware-wide benchmark.

| Path                        | Game dialogue | Microphone notes |
| --------------------------- | ------------: | ---------------: |
| CPU, one utterance          |      181.09 s |          75.07 s |
| GPU, one utterance          |       46.08 s |          11.49 s |
| GPU, batch 4 (experimental) |       25.84 s |           7.21 s |
| GPU, batch 8 (experimental) |       15.13 s |           6.91 s |

The tested production GPU path is about 3.9× faster on game and 6.5× on mic in this run.
Peak process working set was roughly 3.4 GB in each configuration; this is **host RAM,
not GPU VRAM**. We did not measure per-worker VRAM. No concurrent full-model workers were tested.

## Accuracy/timing observations

Word counts were CPU 962/160, GPU 963/160 and batched GPU 964/161 (game/mic).
Counts are not an accuracy score. Comparing exact case-insensitive word strings, including
punctuation, gave CPU-vs-GPU sequence similarity 99.43% game / 96.88% mic; CPU-vs-batch8
90.97% game / 94.08% mic. Many game differences are punctuation. Matched word starts had
95th-percentile differences of 0.02 s on the single-utterance GPU path, and 0.14 s game /
0.114 s mic for batch8. The largest matched-word differences were 0.64/0.24 s and
0.89/0.566 s respectively. This is comparison against another recognizer output, **not
ground truth or word error rate**.

The batch decoder recovered a possible “Note” near 411.6 s but interpreted the known missed
“Cut” around 156.4 s as “Got it.” The “Note” near 226.75 s remained “No” across these runs.
That makes batching promising, but not ready to promote on speed alone. Keep batch size 1
in the review app; expose batching only through the developer study until more recorded
cues, sparse speech and long recordings have reviewed timing evidence.

## Recommendation

Use one GPU worker with one shared model. First optimize chunk batching within that worker;
multiple workers duplicate model memory and compete for the same GPU. A future scheduler
can assemble chunks from several recordings while preserving source/job identity and
cancellation, but that needs measured queue fairness, VRAM limits and acoustic validation.
For now, each recording track remains a separate queued job and unloads on completion.

Engine libraries, model files and optional GPU libraries are separate installations with
pinned requirements and native configuration. A candidate upgrade can be installed alongside
the old version and selected after validation, preserving rollback. A new engine needs an
adapter to the existing worker protocol, not a rewrite of project transcripts or UI.

Evidence: `G:\GPT\Work\virtual-cut\review-0.4.1\device-study-3`, `batch-study`,
and `worker-lifecycle`. GPU success, cancellation, failure and loaded-worker parent crash
all released the worker/guard in the real lifecycle check.

Primary references: [faster-whisper](https://github.com/SYSTRAN/faster-whisper),
[CTranslate2 performance](https://opennmt.net/CTranslate2/performance.html).
