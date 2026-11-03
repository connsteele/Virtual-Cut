# M4 review — 0.4.23

November 3, 2026. Sprint 9, card edits and reasons before real batches, plus faster builds:
roomier nudges on proposal cards, draggable proposal edges on the timeline preview, a reason after
each decision, intent guide version 2, and TypeScript 7 with oxlint. Each ticket was reviewed and
accepted in its own thread on a small test build; this delivery puts the five together.

## Faster builds (VC-188)

Accepted 2026-11-02. No visible change.

- TypeScript 7.0.2 type-checks and builds; the coverage hooks keep `ts.transpileModule` from
  `@typescript/typescript6` until TypeScript 7.1 ships an API. `dist` and `dist-electron` are
  byte-identical to a build of `67a1093` (72 files).
- Type-aware oxlint replaces ESLint, with 89 of ESLint's 91 rules (the other two are syntax errors
  in ES modules and TypeScript), including the VC-102 promise rules. A seeded floating promise is
  still caught. The root `tsconfig.json` is a solution file so electron files lint with Node types.
- Prettier runs with `--cache`. The fast gate on Connor's PC went from about 22 s to about 6 s
  warm (build 5.7 → 1.5 s, lint 9.2 → 0.5 s, format 3.2 → 0.4 s).

## M361 — Nudge controls (VC-174)

Accepted on 0.4.23-22.

- Each time field fits the full ruler time at any length, compact window included.
- Nudges sit in one row under the field at button size: −1 s, −0.1 s, Playhead, +0.1 s, +1 s.
  With the field focused, ↑/↓ nudge 0.1 s and Shift+↑/↓ 1 s, one undo step each.
- A crosshair button beside each field jumps the viewer to the edited time before accepting. The
  field and button sit centred over their row, on Playhead.
- The card's timeline preview follows each nudge live.

## M362 — Drag a proposal's edges (VC-184)

Accepted on 0.4.23-25.

- Only the picked card's preview gets grips (hover never grabs): a range's start and end, or a
  marker's or Split's line. Drags snap like any edge in Cut, and the viewer follows the edge.
- Esc during a drag puts the edge and the playhead back. A drop sets the card's times like a
  nudge: the new times light up with the proposed ones beside them (**was …**), Ctrl+Z on the card
  undoes it, and accepting uses the new times.
- The batch record's final proposals carry `changed` (time, end, title, note against the
  proposal); `get_proposal_decisions` reports how far each edge moved.

## M363 — Reasons when you decide (VC-173)

Accepted on 0.4.23-27. Connor checked through Claude Code that an agent sees the reasons.

- The proposal decided last asks why on its folded line; skipping never blocks. A reject takes one
  tap: Wrong moment, Not needed, Wrong intent, or Other with a short line (keys 1–4). An accept
  shows what was kept or changed (intent, moved, retitled, kind change), with an optional line.
- The reason is saved on the decision as an undoable edit (no schema change).
  `get_proposal_decisions` and the batch record carry it as `why`, plus `afterAccepting`: later
  changes to what accepting made (moved, renamed, given an end, removed), linked to the proposal.
- The intent guide's examples carry the reason and later changes.

## M370, M371 — Intent guide v2 (VC-187)

Accepted 2026-11-03.

- `intentGuideVersion` 1 → 2; the page is now "Intent guide".
- A part of one continuous scene is a range marker, not a clip range.
- The Split rule: keep a Split where it was said unless a black screen ends within 5 s before it;
  reach up to 12 s back only for a late call, with a reason.
- No mic or a silent mic: say so first and propose from the game; silence never means "nothing
  worth keeping".
- Recurring moments (MVP screen, level-up, rewards): clips for the first few per batch (3 by
  default), then a point marker at most; words on the mic override the count.
- The guide keeps a general section only (Calling is on hiatus), and the spelling sentence waits
  for on-screen text through MCP (VC-141, VC-171).
- Agent test runs: Splits kept where said, 11 of 11; a run without the mic track said there was no
  commentary and proposed from the game.

## Evidence

Branch `sprint-9` from `m4-agents-mcp` (`67a1093`), one ticket branch each, merged with `--no-ff`
after Connor accepted it: VC-188 (`e8cff91`), VC-174 (`e81764f`), VC-187 (`3e79c4f`), VC-184
(`e77bd8f`), VC-173 (`76058e4`). After every merge the fast gate and the focused desktop checks of
all merged tickets passed (`test-runs\sprint-9\merge-*`). `2a6086c` fixes a race in
`speech-setup-ui` that the first delivery run hit: the check read the speech plan the instant
its button was clicked and saw the previous plan; it now waits for the new one. Produced with
`node scripts/deliver.mjs --version 0.4.23`.

- Nudges: `proposal-previews.test.mjs`; `agent-proposals-ui.mjs` (keys, row order and size, full
  time in a compact window, centring, jump); `proposal-preview-ui.mjs` (live move, Esc).
- Edge drag: `proposal-previews.test.mjs`, `batch-record.test.mjs` (`changed`);
  `proposal-preview-ui.mjs` (no grips on hover, Esc mid-drag, drop with was, snap, Split line,
  Ctrl+Z, accept uses dragged times, compact window).
- Reasons: `agent-proposals.test.mjs`, `batch-record.test.mjs`, `intent-score.test.mjs`;
  `agent-proposals-ui.mjs` (prompts, keys, compact screenshots).
- Intent guide: `intent-score.test.mjs` (sentences, sections, readable copy matches the version).
- Delivery: fast gate, desktop suite with coverage (542 s), Windows package and packaged checks
  passed. The transport check could not run: its 4K AV1 fixture and the media it was built from
  lived under `G:\GPT\Work\virtual-cut`, which was cleared in the October folder move. Moving
  that fixture into the workspace belongs with VC-190 (test defaults off `G:\GPT`).
- Ticket evidence: `W:\AI\Claude\Virtual Cut\evidence\0.4.23\vc-188`, `\vc-174`, `\vc-184`,
  `\vc-173` and `\vc-187` (agent runs in `vc-187\agent-runs\findings.md`). Delivery runs:
  `evidence\0.4.23\suite` and `\packaged`.
