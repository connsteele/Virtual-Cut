# M4 review — 0.4.19

October 7, 2026. Sprint 6: VC-155 (the proposal card for spoken cues and agent proposals, the
mic intent guide and the richer proposal shape) and VC-128 (scoring proposals and decisions
against tagged mic notes). Two checks, on the
[Virtual Cut Review board](https://claude.ai/artifact/HdJ3dXBscsVgiwtWiVATpT). The card follows
prototype rounds 1–6 (card PROTO-CARD). See [decision 0016](decisions/0016-mic-intents-and-proposal-card.md).

## M347 — One proposal card (VC-155)

- [ ] Spoken cues and agent proposals show the same card: who proposed it, kind and intents, with
      Accept, Reject, Details and Edit at the right; the name, then the time code.
- [ ] Details shows the note, the reason and the cited lines; Edit turns the name, time and note
      into fields in place with nudges and Playhead; Esc puts it back.
- [ ] Accepting or rejecting folds the card to one line with Reopen; Reopen takes back what
      accepting made.
- [ ] A proposal that reworks a spoken cue shows as one card tagged Spoken and Agent, with what was
      heard first and what changed.

## M348 — A mic intent pass on a real recording (VC-155, VC-128)

- [ ] With Cai Chapter 4 Battle in a project (its tagged notes beside it), ask Claude Code for a
      mic intent pass. Claude reads `get_intent_guide` first and proposes from your free speech.
- [ ] Decide the cards. Claude then scores the proposals and your decisions against your tagged
      notes with `scripts/intent-score.mjs`.

## Evidence

Commits since 0.4.18 on branch `m4-agents-mcp`, plus this delivery commit. Produced with
`npm run deliver -- --version 0.4.19`.

- Checks: `intent-score.test.mjs` (fast): the tagged-notes reader (tags, `{maker}`, times
  without a leading zero, split targets, ignored speech), per-intent scoring, split targets and
  false proposals, and the intent guide's examples and profile. `agent-proposals.test.mjs`
  (fast): several intents, Notion targets, range markers, reworking a spoken cue and settling it
  on accept, and reopening each kind. `agent-proposals-ui.mjs` (desktop and packaged): the guide
  over MCP, the Spoken + Agent card, in-place edit with nudges, accept, reject, Reopen, range
  marker reopen, decisions read back, Undo. `transcription-review-ui.mjs` and
  `transcription-ui-checks.mjs`: spoken cues on the card, Edit, keys, and Reopen of an accepted
  cue.
- Scoring baseline (VC-128, Cai Chapter 4, today's spoken Splits, no agent):
  `G:\Claude\Virtual Cut\intent-score\cai-ch4-spoken-splits-baseline\report.md`. 8 of 9 tagged
  Splits are heard; 2 of 9 cut where the note says (the two "exactly here" ones). The rest sit at
  the word, after the scene change the note asks for.
- Fast gate: `G:\Claude\Virtual Cut\evidence\0.4.19\fast\run-peKI44`.
- Full desktop suite with coverage (55/55, gates met):
  `G:\Claude\Virtual Cut\evidence\0.4.19\suite\run-o30XMM`.
- Build: `G:\Claude\Virtual Cut\builds\Virtual-Cut-0.4.19-win-x64-2026-10-07T06-10-11-636Z\Virtual Cut.exe`.
- Packaged checks (55/55): `G:\Claude\Virtual Cut\evidence\0.4.19\packaged\run-bvk6c3`; the
  packaged build's proposal cards are in `G:\Claude\Virtual Cut\evidence\0.4.19\screens`.
- Transport check: `G:\Claude\Virtual Cut\evidence\0.4.19\transport`.
