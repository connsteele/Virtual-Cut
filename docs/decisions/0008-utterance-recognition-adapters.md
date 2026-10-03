# 0008. Keep utterance recognition; alignment and speakers as optional adapters

- Status: Accepted (October 3, 2026)
- Sources: [WhisperX GPU study](../research/whisperx-gpu-study.md), [transcription throughput](../research/transcription-throughput-0.4.1.md), [M3 implementation](../m3-implementation.md)

## Context

Early tests found severe early word anchors when sparse speech was concatenated across silence. Later, WhisperX's full pipeline was evaluated as a faster alternative and as a route to speaker identification (VC-81).

## Decision

- Keep the production `utterance-v1` policy: scan 60-second windows with speech detection and recognize bounded speech spans independently, preserving each span's source offset.
- Add WhisperX forced alignment and Game-only speaker identification only as **optional, replaceable postprocessing adapters** over the preserved recognition, with timing guards, fallback to original anchors, and neutral editable labels including Unknown.
- Never replace the original word list with a differently tokenized result; refined timings and speaker turns are separate derived layers.

## Alternatives considered

WhisperX's default full-file pipeline was about 2.3× faster on continuous dialogue across 24 GPU comparisons, but it shifted sparse speech several seconds early and lost or misplaced microphone cues. Smaller chunks did not fix this. It was rejected as the app default.

## Consequences

- Speaker setup (pyannote) has separate prerequisites, including accepted model terms and an initial download credential; recognition setup needs no account.
- Any future engine change must re-validate timing locality and cue retention, not just speed.
