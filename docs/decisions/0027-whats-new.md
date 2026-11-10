# 0027. What's new: release notes built into each version, for the user and for agents

- Status: Proposed
- Sources: VC-242 and the What's new prototype Connor accepted on 2026-11-09 (version number
  opens the window, no "Virtual Cut" in the label, not in Settings)

## Context

An agent app reused across batches had no way to learn what changed since the version it last
used: the changelog and review pages are written for the user, agents can't read the repository,
and the agent connection reported only the version number. The user had no in-app view of what
changed either.

## Decision

- **One notes file, one entry per version.** `electron/release-notes.ts` holds, newest first, a
  title, a date, a few plain bullets for the user and For agents notes in four groups: **Tools**
  (each new or changed tool and field by name; "No tool changes." when there are none), **Do
  differently now**, **Known gaps** and the **Intent guide** version (said as changed or
  unchanged). A check fails when a tool the server offers is named in no version's notes, so no
  tool ships unmentioned. Product language only, because the repository is public. A test build such as
  0.4.30-71 reads its release's entry (0.4.30). An entry may be marked as a draft before
  delivery.
- **Delivery refuses a version without finished notes.** `npm run deliver` checks the entry
  before anything is built and stops when it is missing or still a draft.
- **The version number opens What's new.** The bottom bar shows only the number. It is a button
  that opens What's new in the app's usual dialog: per version, newest first, For you and For
  agents lists (a **Show agent notes** switch hides the agent lists), with a **Paired agents**
  box saying what each paired app last read. Settings doesn't change.
- **A dot and one pop-up after an update.** The profile remembers the release on which the window
  was last opened and the release whose pop-up was shown (`whats-new.json` in the user profile).
  After an update the number shows a dot until the window is opened, and a pop-up offers "See
  what's new" once; it never takes focus. A new profile has nothing to announce; a profile used
  by an earlier version (it has diagnostics sessions) sees the current release as new.
- **`get_whats_new` for agents.** A read-only tool, available without an open project, returns
  the whole notes (the For agents groups, the user notes, and whether they are final or a draft
  that may change before delivery) of every version after the one this paired app last read (remembered per
  pairing), else after the version it was paired on, else all of them; `since` reads after a
  given version instead. Each call records the running release as read. When a paired app has
  unread notes, the server instructions for its connection start by naming the versions and
  asking it to call `get_whats_new` first. Like every tool, it returns no paths or media
  ([0014](0014-agent-access-boundary.md)).

## Consequences

- Every delivery writes a What's new entry beside the changelog entry; the changelog stays the
  long history for the user and the notes stay short.
- Pairings made before this version have no paired version, so their first `get_whats_new`
  returns every entry the app carries (from 0.4.26).
- The notes ship in the app, so changing them needs a new build.
