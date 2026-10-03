# 0002. Sandboxed renderer with a narrow typed preload; main owns native operations

- Status: Accepted (September 28, 2026)
- Sources: [AGENTS.md](../../AGENTS.md), [foundation — Stack and boundaries](../foundation.md#stack-and-boundaries)

## Context

The app reads and writes the user's original footage, finished clips and project files. A compromised or buggy renderer must not gain general filesystem or shell access.

## Decision

- The renderer runs sandboxed with context isolation and no Node integration. It talks to the desktop process only through `window.virtualCut`, a narrow preload API with typed contracts (`electron/contracts.ts`, `project-contracts.ts`, `transcript-contracts.ts`).
- Electron main owns native operations: dialogs, filesystem access, media tools and project storage. Never expose arbitrary shell commands, unrestricted filesystem reads or raw IPC to the renderer.
- Production assets load from a restricted `app://virtual-cut/` origin with a strict Content Security Policy. Video is served through opaque `media://video/<id>` URLs with byte-range support; only native pickers and project records grant them, so the renderer never handles source paths.
- New windows, external navigation, webviews and permission requests are denied. IPC handlers verify the sending window and page.
- Media processing and speech recognition run outside the UI process.

## Consequences

- Every new native capability needs an explicit, validated preload method rather than generic access.
- Automated checks use disposable profiles and hidden windows; tests must not depend on relaxed security settings.
