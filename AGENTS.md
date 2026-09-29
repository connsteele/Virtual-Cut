# Virtual Cut development

Read `README.md`, `docs/design-decisions.md`, and `docs/foundation.md` before changing the app. `docs/layout-concepts.md` describes the UI alternatives.

## Stack and organization

- Use React, TypeScript, Vite, **CSS Modules**, and npm, following the owner's Footage Organizer and Odin Project experience. Do not introduce Tailwind or a component framework without a concrete need and discussion.
- Keep global CSS limited to resets, shared theme variables, base typography, and focus behavior. Component/layout styles belong in `.module.css` files.
- Prefer recognizable components, hooks, typed contracts, and small service functions. Add routing, storage, HTTP endpoints, or state libraries when a real feature requires them.
- Electron main owns native operations. The renderer stays sandboxed with context isolation, no Node integration, and a narrow preload API. Never expose arbitrary shell commands, unrestricted filesystem reads, or raw IPC to the renderer.
- Keep media processing and local speech recognition outside the UI process. The foundation does not implement them.

## Product preferences

- Windows and Resolve first; native title bar; Virtual Legacy teal `#04635F`; persistent bottom page navigation inspired by Resolve.
- Clearly distinguish working controls from placeholders. Do not invent footage, progress, or agent responses.
- Preserve Footage Organizer's contextual markers, original names, review state, and reviewed move queue when migrating that workflow.
- Keep reusable app behavior independent of personal drive letters and game/project names. Local launch instructions may describe the workstation explicitly.
- Consult the design decisions before implementing cutting, timestamp propagation, mic removal, or transcription.

## Verification and storage

- Run `npm run build` and `npm run lint` for code changes. Use `npm run test:smoke` for Electron startup, preload, navigation, or shell behavior changes. Use focused checks for the actual risk.
- Verify meaningful UI changes in the Electron window, including a compact window and keyboard focus. Use disposable profiles for automated checks.
- Do not test against original footage. Choosing a project folder must not scan, import, move, or modify media at this foundation stage.
- Honor the active user's storage preferences for downloads, caches, screenshots, test profiles, and packaging intermediates. On Connor's workstation those belong on G:. Keep the app's ordinary small profile/settings in its normal location.
- Never commit node_modules, local profiles, media, personal notes, or build output. Preserve existing documentation and user changes.
