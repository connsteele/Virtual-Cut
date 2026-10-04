# M3 review — 0.4.12

October 4, 2026. Two items to check: the transcript now follows a pause or seek made right after
playback (M329), and J/L gain a 6× step with preview audio (M330). Everything else in this build
is engineering with no visible change. M3 remains open.

## M329 — Transcript follows a pause or seek right after playback

Open a recording that has a transcript, open the **Transcript** window and turn on **Follow
playback**.

- [ ] While playing, click the ruler several transcript pages ahead, then press **K** straight
      away. The transcript shows the page and highlights the word at the clicked position.
- [ ] While paused, press **KF ▶** (next keyframe) several times quickly. The transcript ends
      on the final position, not one step behind.
- [ ] Normal playback still follows smoothly across page boundaries, as accepted in M321.

What changed: the app sends the transcript at most one position every 120 ms. Before, an update
arriving within 120 ms of the previous one was dropped, so a pause or seek right after playback
could leave the transcript on the previous page. Now the latest position is always delivered,
still at most once per 120 ms. Found when the faster test suite started failing the
transcript review check; the check now sends positions back to back and fails on the old logic.

## M330 — 6× forward and reverse (VC-48)

- [ ] From pause, **L** steps **1× → 2× → 4× → 6× → 8× → 16×**, and the status reads
      **6× forward** at the new step.
- [ ] Preview audio plays at 6× (pitch preserved). At 8× and 16× the audio area says **Audio
      paused while scanning**.
- [ ] **J** uses the same steps for reverse: **1× / 2× / 4× / 6× / 8× / 16× reverse scan**.
- [ ] The **J** and **L** tooltips list 6×, and the L tooltip says audio pauses above 6×.
- [ ] Listen at 6× on Game, Mic and Combined. Is sped-up speech useful? If not, audio can stop
      above 4× again with 6× kept silent.

Measured on a copied 4K60 AV1 session: 144 frames painted per second at exactly 6.0×, no gap over
25 ms, the GPU decoder 48% busy. The transport check confirms audio plays at 1–6× with zero
corrections and pauses at 8× and 16×. Reverse gained 6× because J and L share one step list; that
is a one-line revert if you prefer reverse at 1/2/4/8/16. Report:
[Playback, rewind and proxies investigation](https://app.notion.com/p/3ef7c5227a808187849fff70e338c284).

## Engineering with no visible change

- **Faster test suite:** the desktop suite takes about 6 minutes instead of 28. Hidden test windows
  now produce frames, so automated clicks no longer wait a second each. Assertions are unchanged.
- **Media tools start directly on Windows:** FFmpeg and FFprobe no longer start through a guardian
  process (about 38 ms and 40 MB saved per call). Windows still stops them if the app exits or
  crashes; `export-native-checks.mjs` fails if a tool outlives the app.
- **Study tools (test-only):** playback speed, H.264 proxy and reverse frame-cache studies, and the
  spoken-cue accuracy scorer.

## Evidence

Commits since 0.4.11: `6437ab1` and `4ffa06d` (test speed and the position fix), `b600763`
(direct media-tool launch), `9f0fe91` and `f1a2650` (cue scorer), `718a3ce` (studies), `b8fcfea`
(6×), plus this delivery commit.

- Full desktop suite on 0.4.12: 49 of 49 passed in 5 min 55 s:
  `G:\Claude\Virtual Cut\evidence\0.4.12\suite\run-0iJwLT`.
- Build: `G:\Claude\Virtual Cut\builds\Virtual-Cut-0.4.12-win-x64-2026-10-04T21-03-09-002Z\Virtual Cut.exe`.
- Packaged checks with the build's bundled FFmpeg all passed: export (tool lifetime: stopped with
  its parent), playback UI with the 6× steps, transcript review including the position test,
  transcription UI and smoke: `G:\Claude\Virtual Cut\evidence\0.4.12\packaged\run-Z5ZElY`.
- Packaged transport check: preview audio plays at 1×, 2×, 4× and 6× with zero corrections and
  pauses at 8× and 16×; 16× falls back to scanning:
  `G:\Claude\Virtual Cut\evidence\0.4.12\transport\regression-C3anMv`.
