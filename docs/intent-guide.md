# Intent guide (version 4)

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

| Intent  | Meaning                                                                    | Proposal                                                                                                                                        |
| ------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| marker  | Something worth finding again at this moment: a reaction, a line, a play.  | A marker at the moment it refers to (often the game line just before), with a title and note. A range marker labels part of a continuous scene. |
| general | Context about the clip or video: what is happening, what this part is for. | Usually none of its own. Feeds titles, notes, clip names and composite notes.                                                                   |
| notion  | A thought for the video notes: an opinion, a theme, an observation.        | A timed note, or a marker with a note, with a Notion target: new, expands an existing note, or duplicate of one.                                |
| edit    | An editing instruction, such as "cut before this transition".              | A split or clip range where the instruction points, not where it was said.                                                                      |

A line can carry several intents.

## Spoken commands

- **Split** (or Cut) is a command; the app offers it as a Split cue. Keep a Split where it was said
  unless a black screen ends within 5 s before it. Propose a cut up to 12 s back only when what's
  said shows the call came late, and say why (decision D6, October 10, 2026). An agent that moves
  it or names the clips proposes a split with `refines` pointing at the cue line, and the creator
  sees one card with the cue as heard and the agent's changes.
- **Clip start/in** and **Clip end/out** pair into a clip range.
- **Marker**, **Mark** and **Note** are no longer needed as cue words. Older recordings use them;
  the line is still free speech to interpret, and an agent reworks the cue rather than adding a
  second marker beside it.

## Rules

- Read the game dialogue around each mic line: it says what just happened, fixes misheard names
  and is the best source for a note. Cite the mic and game lines used.
- Skip coughs, false starts ("never mind"), filler and lines invented over noise.
- Lines about one idea across a session can add up to one composite note: a single note with the
  notion intent that cites every supporting line.
- A part of one continuous scene (a conversation, a cutscene, a battle that carries on) is a range
  marker, not a clip range: the creator keeps the scene as one clip and labels its parts.
- **No mic, or a silent mic.** Some sessions are recorded just to relax, with no commentary. The
  agent says so first in its summary ("No commentary on this recording; proposals come from the
  game alone") and proposes from the game: game dialogue, scene changes, menus and battles. Silence
  never means "nothing worth keeping".
- **Recurring moments** (MVP screen, level-up, rewards, victory poses): clips for the first few
  instances in a game, so the edit has variations; after that a point marker at most, or nothing.
  "First few" is 3 unless the game's section says otherwise, and counts within one batch for now.
  Anything said on the mic, such as "clip this one", overrides the count.
- Use the game vocabulary and glossary for names. Keep titles plain and under 100 characters.
- Learn from the creator's examples and decisions: what they accepted, moved, retitled or
  rejected, why when they said, and what they changed after accepting. A reject for the wrong
  moment means the idea was right but the time was not.

## Games

Lessons that hold for one game stay under that game's header so they don't leak into others. The
agent uses the section whose game matches `get_context`; the general section applies to every
game. A lesson moves to general only when it holds in a second game or the creator says so. A game
gets its own section when its footage comes through and it has lessons of its own.

| Section | Recurring moments clipped | Lessons                                                                                           |
| ------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| General | first 3                   | the two screen text sentences (version 3) and, with pictures on, three look sentences (version 4) |

General lessons, for every game (version 3, VC-191):

- Screen text is raw: every piece of text the screen showed, from dialogue to menus, tooltips and damage numbers. Use where and how long it stayed up to judge what it is, and learn each game's layout in its own section.
- Spell a name only as it was seen written on screen (get_screen_text) or as it appears in the game vocabulary. Otherwise mark it unsure. (decision D6, held until screen text reached agents)

With pictures allowed for the reading app (version 4, VC-172), the general section adds these;
an app with pictures off reads version 4 without them:

- Look whenever seeing the picture would make your work better: a more accurate trim or Split, a marker on the right moment, a name or detail the text can't settle, a pattern across scenes, or something the creator asked you to find. Picture events, screen text and transcripts are the quick way to find where to look.
- When you have several moments to check, look at them together in one call. Start with a strip, and ask for a 720p frame, a 1080p frame or a crop where you need detail.
- When a picture decided a proposal, say so in its reason.

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
