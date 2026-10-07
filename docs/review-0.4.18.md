# M4 review — 0.4.18

October 7, 2026. Sprint 5: VC-161 (agent proposals stored as candidates with provenance, and
their schemas) and VC-162 (`submit_proposals` onto the transcript window's cue card, and
`get_proposal_decisions` back). Two checks, on the
[Virtual Cut Review board](https://claude.ai/artifact/HdJ3dXBscsVgiwtWiVATpT). Opening a project
upgrades it to saved format 6 after a verified copy of the previous version.

## M345 — Claude proposes, you decide in the transcript window, Claude reads it back (VC-162)

- [ ] Re-register Claude Code with this build (the command is in the thread), open a Cai
      project, turn on agent access and open its mic transcript.
- [ ] Ask Claude to propose a marker and a split on that recording from what you said. Each
      shows as an Agent card between the phrases at its time, with Claude's reason and the mic
      line it used, and counts under Needs review. Nothing changes in Cut until you decide.
- [ ] Move the marker and change its title, then accept it; accept or reject the split. The
      cards decide exactly like spoken cues.
- [ ] Ask Claude what you decided: it reports accepted or rejected, the position you chose and
      how far you moved it, and the new title.

## M346 — Undo and the project upgrade (VC-161)

- [ ] Ctrl+Z in the editor after deciding a proposal: its card returns to Needs review.
- [ ] The first open of an existing project says it was upgraded; Save history lists the
      pre-upgrade copy.

## Evidence

Commits since 0.4.17 on branch `m4-agents-mcp`, plus this delivery commit. Produced with
`npm run deliver -- --version 0.4.18`.

- Checks: `agent-proposals.test.mjs` (fast): field-named refusals (outside the recording, clip
  ends, stale transcript, missing line, repeats, the 2,000 limit), the tool's JSON Schema,
  accepting each kind, moved and retitled read-back, decisions pass project validation.
  `project-recovery-checks.mjs` (native): v5 to v6 upgrade with its copy, all-or-nothing
  submissions, proposals outside Undo, restores keep proposals. `agent-proposals-ui.mjs`
  (desktop and packaged): submit over MCP, Agent cards in the transcript window, move, accept,
  split, reject, filter, decisions read back, Undo returns a decision to review, compact window.
