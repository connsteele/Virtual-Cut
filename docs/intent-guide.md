# Intent guide (version 6)

Agents read this guide through the MCP tool `get_intent_guide`, together with the user's own
labelled examples, earlier decisions and habits. The text agents receive is in
`electron/intent-guide.ts`; keep this page in step with it and raise `intentGuideVersion` when the
meaning changes.

## Purpose

The creator talks into the microphone while playing. Apart from a few spoken commands, that speech
is free: it says what they want marked, noted or cut, or gives context for the video. The agent
works out what each mic line is for and proposes it with `submit_proposals`. Mic speech is optional
evidence, never a requirement: some sessions have no commentary, and then the game alone says what
to propose. Every proposal is reviewed in the transcript window; nothing is applied until the
creator accepts it.

## Intents

| Intent  | Meaning                                                                    | Proposal                                                                                                                                                                                                                             |
| ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| marker  | Something worth finding again at this moment: a reaction, a line, a play.  | A marker at the moment it refers to (often the game line just before), with a title and note. A range marker labels part of a continuous scene.                                                                                      |
| general | Context about the clip or video: what is happening, what this part is for. | Usually none of its own. Feeds titles, notes, clip names and composite notes.                                                                                                                                                        |
| notion  | A thought for the video notes: an opinion, a theme, an observation.        | A timed note, or a marker with a note, with a Notion target: new, expands an existing note, or duplicate of one. Existing notes are this project's notes and the video's Notion notes page, checked only when the agent can read it. |
| edit    | An editing instruction, such as "cut before this transition".              | Clip ranges where the instruction points, not where it was said, with the boundary where it asks for a cut.                                                                                                                          |

A line can carry several intents.

## Spoken commands

- **Split** (or Cut) is a command; the app offers it as a Split cue. Keep a Split where it was said
  unless a black screen ends within 5 s before it. Propose a cut up to 12 s back only when what's
  said shows the call came late, and say why (decision D6, October 10, 2026). That time is where
  the clip boundary goes: since version 5 the agent proposes the clip ranges on either side of it
  and cites the cue line, rather than a split.
- **Clip start/in** and **Clip end/out** pair into a clip range.
- **Marker**, **Mark** and **Note** are no longer needed as cue words. Older recordings use them;
  the line is still free speech to interpret, and an agent reworks the cue rather than adding a
  second marker beside it.

## Rules

- The pass also checks which recordings have no clip yet (each gets a clip range) and fixes
  pending cards with `amend_proposal` and existing items with `propose_changes`.
- Read the game dialogue around each mic line: it says what just happened, fixes misheard names
  and is the best source for a note. Cite the mic and game lines used.
- Skip coughs, false starts ("never mind"), filler and lines invented over noise.
- Lines about one idea across a session can add up to one composite note: a single note with the
  notion intent that cites every supporting line.
- **Clips (version 5).** One clip per coherent activity or scene, with an overall name. Split
  only where the activity or scene really changes, and trim only real fat (menus, loading, dead
  air, repeats); trimming is expected on every recording. Inside a clip, the structure goes in
  range markers: character creation is one clip with a range marker for each tab. A part of one
  continuous scene is a range marker, not a clip range.
- **Every recording gets a clip (version 5).** Import makes no clip, and a recording with no clip
  exports nothing. The agent proposes at least one named clip range on every recording, one over
  the whole recording when all of it is worth keeping. Where footage should become two clips it
  proposes both clip ranges rather than a split; a spoken Split marks where the boundary goes.
- Several clip ranges on one recording are fine; each exports as its own file. Clips overlap only
  when the creator asks or the footage really belongs to more than one, and the reason says why.
- **No mic, or a silent mic.** Some sessions are recorded just to relax, with no commentary. The
  agent says so first in its summary ("No commentary on this recording; proposals come from the
  game alone") and proposes from the game: game dialogue, scene changes, menus and battles. Silence
  never means "nothing worth keeping".
- **Recurring moments** (MVP screen, level-up, rewards, victory poses): clips for the first few
  instances in a game, so the edit has variations; after that a point marker at most, or nothing.
  How many is the agent's call (version 5 dropped the fixed 3). It sees what earlier batches of
  the game already have with one `get_annotations` call per batch (clips, markers, range markers
  and notes), never by reading their transcripts. Anything said on the mic, such as "clip this
  one", overrides this.
- Use the game vocabulary and glossary for names. Keep titles plain and under 100 characters.
  Range markers and clip ranges are titled the same way, by a searchable topic ("Bonus Talents"),
  calling out firsts ("First Relay Jump"), since a proposal can be accepted as either.
- **Clip names are file names (version 5):** Windows rules, 1 to 180 characters; see File names.
- **Notes (version 5):** short `Scene:` / `Me:` (first person) / `Fact:` lines, only the ones that
  apply. No marker for the creator just talking to themselves.
- **Fact-check on-mic claims (version 5):** a `Fact:` line only when the creator got it wrong or
  there is something key to add.
- **Watch before writing (version 5):** a range starts at the on-screen event, not the mic line.
  Before calling a span fat, check it with `get_visual_events` (and look, when pictures are
  allowed): black can be a loading screen, a fade or the scene itself.
- **Fixing proposals (version 5):** `amend_proposal` changes the agent's own pending card in
  place; `propose_changes` proposes before-and-after changes to markers and clips that already
  exist. No withdraw-and-resubmit.
- Learn from the creator's examples and decisions: what they accepted, moved, retitled or
  rejected, why when they said, and what they changed after accepting. A reject for the wrong
  moment means the idea was right but the time was not.

## Lessons, the same for every game

Since version 6 the guide is general only: there are no per-game sections. Rules for one game,
such as what its marker colors mean, live in that game's brief and context, which the creator
edits per game and agents read with `get_context`, or in the creator's Notion pages for the
game when the agent can read them. When an agent learns something that holds
for one game only, it suggests it for the brief rather than applying it everywhere
(`gameRules` in the guide).

Lessons (version 3, VC-191):

- Screen text is raw: every piece of text the screen showed, from dialogue to menus, tooltips and damage numbers. Use where and how long it stayed up to judge what it is.
- Spell a name only as it was seen written on screen (get_screen_text) or as it appears in the game vocabulary. Otherwise mark it unsure. (decision D6, held until screen text reached agents)

While Allow pictures is on (version 4, VC-172), the lessons add these; while it is off, agents
read the guide without them:

- Look whenever seeing the picture would make your work better: a more accurate trim or Split, a marker on the right moment, a name or detail the text can't settle, a pattern across scenes, or something the creator asked you to find. Picture events, screen text and transcripts are the quick way to find where to look.
- When you have several moments to check, look at them together in one call. Start with a strip, and ask for a 720p frame, a 1080p frame or a crop where you need detail.
- When a picture decided a proposal, say so in its reason.

## File names

Version 5 (M452) gives agents a `fileNames` section, since clip names become file names:

| Avoid                               | Use instead              |
| ----------------------------------- | ------------------------ |
| `:`                                 | `-` (space, dash, space) |
| `/` and `\`                         | `-`, or the word "and"   |
| `?`                                 | leave it out             |
| `*`                                 | leave it out             |
| `"`                                 | `'`                      |
| `<` and `>`                         | `(` and `)`              |
| `\|`                                | `-`                      |
| tabs, new lines, control characters | a space                  |

Names are 1 to 180 characters, with no leading or trailing spaces, no trailing dot, and none of
the names Windows reserves (CON, PRN, AUX, NUL, COM1 to COM9, LPT1 to LPT9). These match what
Review checks.

## The user's layer

`get_intent_guide` adds, from the open project:

- **Tagged notes:** a `.txt` beside a recording's file, in the format described in
  `electron/intent-notes.ts`. Notes of the recording being worked on are left out, so they can
  serve as ground truth for `scripts/intent-score.mjs`.
- **Decisions:** every accepted, moved, retitled or rejected agent proposal, with the creator's
  reason when they gave one (`why`: Wrong moment, Not needed, Wrong intent, Other with a line, or a
  line about an accept) and what they changed later to what accepting made (`later`: moved,
  renamed, given an end, removed).
- **Profile:** how often each intent is tagged, how often cue words are used, and decision counts,
  including each reject reason and how many accepts were changed later.
