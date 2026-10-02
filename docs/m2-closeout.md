# Milestone 2 closeout — October 2, 2026

## Accepted scope

Version 0.3.23 completes the local first-production-batch workflow: persistent projects and batches, Cut clips and point/range markers, snapping, compact saves and session Undo, reviewed destinations and acceptance, verified filing, completed Library playback/relink, and explicit Resolve metadata handoff. Project deletion protects originals, completed videos and companions. Cleanup grouping and on-demand storage were accepted in M285/M286.

Connor's VC-26 representative batch passed save/reopen, completed playback and Resolve handoff; Cut felt good. M281–M286 accepted the subsequent refinements. This acceptance does not imply that every historical manual checkbox was performed.

## Validation policy

Use meaningful behavior and failure checks with measured module floors. Overall coverage is a useful trend, not a release target to maximize. Keep untouched executable application files in the denominator. Preserve tests for source/output protection, saves/recovery, packet and annotation timing, reviewed acceptance and destination safety as later features are added.

The closeout adds deletion scenarios for foreign/corrupt/future-version saves, pending database writes, changed project identity, unavailable peer projects and a project reached through a junction. Storage checks require honest incomplete/linked-folder reporting. No application code or user-visible behavior changes in this closeout; the accepted 0.3.23 package remains the delivery.

## Explicit follow-ups

- **VC-49, Baseline:** first hosted Windows CI run after authorized publication. Local success does not prove hosted prerequisites. Remains open.
- **VC-33, Later:** older M212 MP4/MKV tail/audio presentation and separate clip-context observations. Ordinary chapter import carries names/times; colors, multiline marker notes and ranges use the explicit helper. Clip context stays in companion/Library, and existing timeline instances are not rewritten.
- **VC-41, Later:** rare natural demuxer read failure. Recovery and diagnostic capture are tested; the original trigger is not established. Investigate if it recurs, without requiring a forced recurrence for M2 acceptance.
- Older M254 viewer/typing, M249 production reopen/new-timeline, M217 statistics and O01–O05 recipes remain in the review history. Automated/live generated-media evidence is identified separately; unchecked manual boxes stay unchecked.
- Optional Storage scrolling, broader Library parity/latency, M3 audio intelligence, M4 agents and M5 connections/glossary are outside this closeout.

## Evidence

Current coverage and gate results are recorded in [coverage](coverage.md). The maintained inventory and invocation instructions are in [testing](testing.md). Closeout artifacts live under `G:\GPT\Work\virtual-cut\m2-closeout`; delivery evidence remains `G:\GPT\Work\virtual-cut\review-0.3.23\verification-summary.json`.

The full coverage run uses generated media and isolated projects/profiles. Coverage instrumentation is absent from the delivered app and its runtime is not a playback-performance benchmark. Local commits remain unpublished.
