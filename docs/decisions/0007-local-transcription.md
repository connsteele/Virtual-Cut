# 0007. Local, on-demand faster-whisper transcription with immutable recognition

- Status: Accepted (September 29, 2026; speaker scope clarified October 3)
- Sources: [design decisions — Transcript feature](../design-decisions.md#transcript-feature-requested-for-exploration), [M3 implementation](../m3-implementation.md), [local transcription research](../research/local-transcription.md)

## Context

Searchable game dialogue and microphone notes are central to M3, but Connor does not want a paid cloud speech service, idle GPU/memory use, or transcripts that silently rewrite what was said.

## Decision

- Recognition is local, using faster-whisper with Whisper large-v3 (validated runtime: faster-whisper 1.2.1 / CTranslate2 4.8.2; Automatic, NVIDIA or CPU).
- It runs only for an explicitly requested job, in a disposable Python process under a Windows Job Object. The process unloads on completion, cancellation, pause, failure and app exit. Reading saved transcripts never loads a model.
- Game dialogue and microphone notes are separate jobs and results.
- Original recognition is immutable; corrections and cue decisions are separate editorial records. Spoken cues are microphone-only, tentative and need human acceptance.
- Speaker identification, when added, is optional, off by default and **Game audio only**.
- No cloud account is required to obtain or search a transcript. Agent correction is a separate later action (M4).

## Consequences

- Model files stay on disk; managed setup (0.4.7) downloads a pinned runtime instead of embedding it in each build.
- After source retirement, microphone content is kept as transcripts/notes only, so wanted mic transcription must happen before originals are removed.
