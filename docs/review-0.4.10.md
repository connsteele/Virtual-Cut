# M3 review — 0.4.10

October 3, 2026. One item: speech setup files that are moved or deleted outside the app (VC-90
follow-up), from Connor's report after 0.4.8. No other behavior changes. M3 remains open.

## M327 — Setup files removed outside the app (VC-90)

Open **Transcript → Local transcription setup**. Rename folders rather than deleting them, so
you can put them back.

- [ ] If a setup you deleted earlier is still listed, its row says **files not found**, a red
      note names the missing file (for example "The speech model was not found in …"), and the
      GPU line no longer claims a ready GPU.
- [ ] With the Transcript window open, rename a setup's `model` folder in Explorer, then click
      back into the Transcript window. The panel updates without reopening it. Rename the folder
      back and click in again; the setup returns to normal.
- [ ] While the setup in use is missing files, **Start transcription** stays disabled and the
      same reason appears under it.
- [ ] A setup with missing files cannot be switched to (its **Switch to …** button is disabled).
      Switching away from a missing setup still works, and the message says you can't switch
      back to it.

What changed: the app checked the setup files once, when the Transcript window opened, and kept
an earlier GPU result. Files deleted in Explorer afterwards went unnoticed, a downloaded setup
that was deleted before activation still offered **Use this setup**, and switching to a missing
setup was allowed. Now the window rechecks whenever it regains focus, a GPU result is never kept
for missing files, a deleted download is reported as missing (and recovers if its files return),
and transcription requests name the missing file.

## Evidence

Native checks cover the missing-file reason for each part (Python, speech libraries, model), a
first setup versus a removed one, the GPU result not surviving deletion, refusing to switch to a
missing setup, and a checked download deleted before and after activation, including after
reopening. Run against the 0.4.9 code, the new native checks fail. The desktop check deletes the
model of the setup in use while the Transcript window is open, then confirms the row, the red
note, the disabled switch and the switch-back message after a focus change.

Commit `0557597`. Full desktop suite passed, 49 of 49 checks:
`G:\Claude\Virtual Cut\test-runs\run-mGXqCI`.

Build: `G:\Claude\Virtual Cut\builds\Virtual-Cut-0.4.10-win-x64-2026-10-04T04-51-32-747Z\Virtual Cut.exe`.
Packaged setup, transcript UI and smoke checks passed:
`G:\Claude\Virtual Cut\packaged-checks\run-Fd2VYF\report.json`.
