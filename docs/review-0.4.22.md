# M4 review — 0.4.22

October 16, 2026. Sprint 8, review tools ahead of real batches: pending proposals preview on the
Cut timeline, an agent's clip range or range marker can be accepted as the other kind, and the
Transcript window reads mic and game lines together. Each ticket was reviewed and accepted in its
own thread on a small test build; this delivery puts the three together.

## M357 — Proposals on the timeline (VC-170)

Accepted on 0.4.22-26 after five review rounds (0.4.22-21 to -26).

- Every pending proposal for the recording on screen, spoken or from an agent, shows dimmed on
  the Cut timeline in its proposer's colour: a striped band in the ruler for range markers and
  clip ranges, a marker shape in the ruler for markers (outlined for notes), and a line through
  the track for Splits, with a count such as "3 proposals waiting".
- Hovering a card, or picking it (a click on the card or its time code, or Tab, N or P; Esc lets
  it go), brings its preview to full strength and names it. A pick pans a zoomed view to it
  without moving the playhead; hovering never moves the view.
- A spoken Split's line sits on its black-screen snap (VC-165) once that is measured.
- Accepted and rejected proposals drop off the preview. The previews are read-only.

## M354 — Accept as the other range kind (VC-186)

Accepted on 0.4.22-12. Connor's M354 note made it work both ways.

- An agent's clip range offers **Accept as clip** (A) and **Accept as range marker** (M); an
  agent's range marker offers **Accept as range marker** (A) and **Accept as clip** (C). The
  span, name and note carry over, and Reopen takes it back like any accept.
- The decision keeps `kindChange` (`clip-range` ↔ `range-marker`), and `get_proposal_decisions`
  and the batch record show it as the agent's suggestion accepted as the other kind.

## M360 — Mic and game together (VC-185)

Accepted on 0.4.22-31.

- The transcript picker gains **Both · Microphone and game**: mic and game phrases interleaved in
  time order, each with a coloured edge and a Mic or Game label, with proposal cards between
  them where they sit on the mic transcript.
- The window opens on Both while the recording has pending proposals, otherwise on Microphone.
- Editing a line corrects its own transcript; search, Original and the filter chips cover both.
  Storage stays one transcript per role.

## Evidence

Branch `sprint-8` from `m4-agents-mcp` (`c2a372a`), one ticket branch each, merged with
`--no-ff` after Connor accepted it: VC-170 (`2729970`), VC-186 (`7ea1bf5`), VC-185 (`dc97501`).
`cfd7ed5` fixes two desktop checks after the first two merges: `proposal-preview-ui` clicks the
renamed accept, and `split-snap-ui` retries its source renames while the file is still held
after import. Produced with `node scripts/deliver.mjs --version 0.4.22`.

- Timeline previews: `proposal-previews.test.mjs`; `proposal-preview-ui.mjs` (kinds, geometry,
  colours, click-through, hover, picking, Esc, panning, compact window, accept, reject, reopen,
  Undo); `split-snap-ui.mjs` checks the Split preview on the snap.
- Accept as the other kind: `agent-proposals.test.mjs` (both directions, validation, batch
  record); `agent-proposals-ui.mjs` accepts both ways through the app.
- Mic and game together: `combined-transcript-ui.mjs` (interleaving, labels, editing each
  transcript, search, preview relay and N/P across game lines, compact screenshot).
- Ticket evidence: `G:\Claude\Virtual Cut\evidence\0.4.22\vc-170`, `\vc-186` and `\vc-185`.
  Delivery runs: `evidence\0.4.22\suite` and `\packaged`.
