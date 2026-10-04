# M3 review — 0.4.11

October 3, 2026. One item: the speech setup panel becomes a single speech engine (first stage of
VC-114), from Connor's M327 feedback that the two-setup switch was bizarre. No other behavior
changes. M3 remains open.

## M328 — One speech engine (VC-114 stage 1)

Open **Transcript → Speech engine** (the gear button).

- [ ] One card shows the engine in use: **Virtual Cut speech engine** or **Your own Python
      installation**, a status (**Ready**, **Files missing** or **Not installed**), where it
      lives and **Open folder**. "In use", "Other setup" and **Switch to … setup** are gone.
- [ ] **Download speech engine…** (or **Download a new copy…** when one is installed) asks where
      to put it and shows sizes; nothing downloads until **Download and install**. A download
      that passes its check is used straight away, with no separate **Use this setup** step.
- [ ] If a downloaded engine was replaced and is still on disk, a box offers **Delete previous
      engine (… GB)**. It only ever deletes a folder Virtual Cut downloaded, never your own
      installation or the engine in use.
- [ ] **Advanced: use my own Python installation** holds the Python, libraries, model and GPU
      runtime choices. It opens by itself when your own installation is in use. Switching
      between the downloaded engine and your own installation is here, and each button names
      what it returns to (**Use the downloaded engine again** / **Use my own installation
      again**).
- [ ] **Recognition device**, the NVIDIA option, the help links and **Sources, licenses and
      storage** are all still available.

Decisions (October 3): keep one engine, keeping the old one only until you delete it; keep your
own installation under Advanced, open automatically when it is in use (a Python on PATH alone
cannot say where the model is, so the app does not scan for it); use a checked download
automatically. VC-113 (listing older installs for cleanup) is covered by the delete option.

## Evidence

Native checks cover automatic use after a download, keeping only a working previous engine,
deleting the previous downloaded engine with its size, and refusing to delete your own
installation, a folder without Virtual Cut's install receipt, or the engine in use. The desktop
check covers the single card, Advanced opening by itself, both switch buttons, the delete offer,
missing files noticed on focus, and 900 and 500 px layouts.

Commit `9694245`. Full desktop suite passed, 49 of 49 checks:
`G:\Claude\Virtual Cut\test-runs\run-ofaRV4`.

Build: `G:\Claude\Virtual Cut\builds\Virtual-Cut-0.4.11-win-x64-2026-10-04T06-01-24-374Z\Virtual Cut.exe`.
Packaged engine, transcript UI and smoke checks passed:
`G:\Claude\Virtual Cut\packaged-checks\run-rxe3KY\report.json`.
