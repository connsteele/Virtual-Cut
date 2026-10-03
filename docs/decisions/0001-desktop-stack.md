# 0001. Electron desktop app with React, TypeScript, Vite and CSS Modules

- Status: Accepted (September 28–29, 2026)
- Sources: [design decisions — Confirmed by Connor](../design-decisions.md#confirmed-by-connor), [AGENTS.md](../../AGENTS.md), [foundation](../foundation.md#stack-and-boundaries)

## Context

Virtual Cut replaces several tools (LosslessCut, a marker-embedding script and Footage Organizer) with one Windows application aimed at a DaVinci Resolve workflow. Connor already works in React, TypeScript, HTML and CSS from Footage Organizer and The Odin Project.

## Decision

Package the whole application in Electron. Use React, TypeScript, Vite, **CSS Modules** and npm, with shared CSS variables, ordinary components/hooks and explicit service boundaries. Global CSS is limited to resets, theme variables, base typography and focus behavior. Heavy media work runs in native workers such as FFmpeg rather than in the UI.

## Alternatives considered

Tailwind, component frameworks, routing, state libraries and an HTTP backend were deliberately not introduced. They may be added only when a concrete feature needs them and after discussion. Express remains the familiar choice if a later feature truly requires an HTTP service.

## Consequences

- Chromium supplies original-media playback (including AV1); codec support follows Electron's player.
- New dependencies need a stated reason.
- Windows and Resolve come first; the brand accent is Virtual Legacy teal `#04635F` with a persistent bottom page strip inspired by Resolve.
