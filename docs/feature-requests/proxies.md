# Deferred: Optional proxy generation and codec research

## Request

Add optional proxy generation to Virtual Cut in a later release. Development is deferred and is not a dependency of the initial Cut, Review, and local transcription workflow. Original-media playback remains the default.

The purpose is to help users whose original recordings do not play or seek smoothly. Research and benchmark candidate codecs before selecting an implementation or default profile.

## Desired behavior

- Proxy generation is opt-in and disabled by default.
- Start by evaluating 1080p previews while preserving the source's timeline and frame correspondence.
- Allow users to select a proxy location. Proposed default: a `Virtual Cut Proxies` folder at the root of the project's video directory.
- Use proxies for preview; lossless exports continue to read the original media.
- Preserve usable game/microphone track monitoring while keeping exported clips game-audio-only.
- Show preparation progress and allow cancellation, regeneration, relinking, and explicit cleanup.

## Codec research

The requested candidates are **DNxHR SQ** and **ProRes 422**. Compare these with lower-bandwidth editing profiles such as DNxHR LB / ProRes Proxy and, if useful, a compressed preview option. These are candidates, not an approved codec choice.

Evaluate:

- Windows Electron playback support and any additional decoder/player dependency.
- Resolve compatibility where users choose to reuse generated proxies there.
- Seek responsiveness, reverse navigation, frame stepping, and 4x/8x playback.
- Small game text and scene-identification quality at 1080p.
- Generation time, GPU/CPU contention, storage consumed per hour, and disk bandwidth.
- Color/range metadata, source frame rate, variable-frame-rate behavior, timestamps, and source-to-proxy frame mapping.
- Audio-track routing and synchronization, including microphone-note streams.
- Runtime packaging and redistribution requirements.

## Acceptance criteria for a future implementation

- [ ] Publish a measured codec recommendation using representative gameplay recordings.
- [ ] No proxy is created until enabled by the user.
- [ ] Custom and default proxy locations work without moving original footage.
- [ ] Source and proxy navigation agree at representative frames, cut boundaries, and markers.
- [ ] Exports always use original video and the intended game-audio stream.
- [ ] Missing, cancelled, or stale proxies fall back to the original without losing edits.
- [ ] Cleanup correctly handles proxies containing microphone audio after source retirement, honoring the transcript/notes-only retention policy.

## Priority

Deferred feature request. Complete the original-media cutting and review workflow first. Codec research should precede development when this feature is scheduled.
