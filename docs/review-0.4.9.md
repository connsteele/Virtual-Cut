# M3 review — 0.4.9

October 3, 2026. One item: M320 local speech setup clarity (VC-90), from Connor's 0.4.8 notes.
No other behavior changes. M3 remains open.

## M320 — Local speech setup (VC-90)

Open **Transcript → Local transcription setup**.

- [ ] **In use** shows which setup transcription uses (Downloaded or Manual) and where it lives.
      **Open folder** opens that folder.
- [ ] **Other setup** shows the setup you can switch back to. Its button names the target
      (for example **Switch to manual setup**). After switching, the message says which setup is
      now used and that the other is kept; switch back the same way.
- [ ] **Choose folder for a new download…** opens beside your downloaded setup (or, on a first
      setup, in `%LOCALAPPDATA%\Virtual Cut`). Choosing a folder only shows sizes and free
      space; nothing downloads until **Download and install**.
- [ ] Optional: download into a disposable folder, **Use this setup**, then switch back.

What changed: before, the panel never said which setup was in use, **Restore previous setup**
actually swapped two setups while always saying "Previous setup restored", and the folder picker
opened wherever Windows last was. Downloads stay outside the app folder so every Virtual Cut
version shares one setup. Listing and cleaning up older installs is the separate VC-113.

Also fixed: switching setups while a download was only planned marked that folder ready, so the
panel offered **Use this setup** for a folder that was never downloaded.

## Evidence

Commit `032db5f`. Native checks cover location detection, look-alike paths, the default folder,
switch messages and the planned-state fix. The desktop check covers both rows, Open folder
(Explorer stubbed), switching both ways, where the picker starts, and 900/500 px layout.
Transcript UI, transcript review, crash diagnostics, shell smoke and the fast gate with lint
also passed: `G:\Claude\Virtual Cut\test-runs`.

Build: `G:\Claude\Virtual Cut\builds\Virtual-Cut-0.4.9-win-x64-2026-10-04T03-24-14-010Z\Virtual Cut.exe`.
Packaged setup, transcript UI and smoke checks passed:
`G:\Claude\Virtual Cut\packaged-checks\run-uPSLVN\report.json`.
