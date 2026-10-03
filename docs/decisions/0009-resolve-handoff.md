# 0009. Explicit Resolve helper for marker metadata; transcript import stays manual

- Status: Accepted (October 1, 2026; transcript findings October 3)
- Sources: [filing and Library — Resolve marker metadata](../filing-and-library.md#resolve-marker-metadata), [Resolve transcript handoff research](../research/resolve-transcript-handoff.md), [library and Resolve handoff research](../research/library-and-resolve-handoff.md)

## Context

Ordinary Resolve import reads embedded chapter names and times, but not marker colors, multiline notes or ranges. Connor also wants searchable transcripts in Resolve without retranscribing there.

## Decision

- Embed chapter names/times in exported files, and keep the full annotations in the portable `.vcut.json` companion.
- Transfer colors, notes and range durations through an **explicit, user-run Resolve Utility script** (installed from the Handoff page). It checks before applying, matches clips by verified identity, avoids duplicates, and protects later user edits.
- Native Resolve transcript reuse is supported **manually** through the Transcription window's Import Subtitles with a clip-matched SRT. The inspected 21.1.1 scripting API has no transcript import method, so automatic batch attachment is not promised.
- Do not write Resolve's private project data or generate a second transcript as a workaround.

## Consequences

- VC-94 produces clip-matched SRT and richer companion data; native attachment remains under VC-40.
- Recheck the Resolve API when the installed version changes.
- Selects/string-outs and direct timeline creation remain Later.
