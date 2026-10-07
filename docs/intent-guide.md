# Mic intent guide (version 1)

Agents read this guide through the MCP tool `get_intent_guide`, together with the user's own
labelled examples, earlier decisions and habits. The text agents receive is in
`electron/intent-guide.ts`; keep this page in step with it and raise `intentGuideVersion` when the
meaning changes.

## Purpose

The creator talks into the microphone while playing. Apart from a few spoken commands, that speech
is free: it says what they want marked, noted or cut, or gives context for the video. The agent
works out what each mic line is for and proposes it with `submit_proposals`. Every proposal is
reviewed in the transcript window; nothing is applied until the creator accepts it.

## Intents

| Intent  | Meaning                                                                    | Proposal                                                                                                                                        |
| ------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| marker  | Something worth finding again at this moment: a reaction, a line, a play.  | A marker at the moment it refers to (often the game line just before), with a title and note. A range marker labels part of a continuous scene. |
| general | Context about the clip or video: what is happening, what this part is for. | Usually none of its own. Feeds titles, notes, clip names and composite notes.                                                                   |
| notion  | A thought for the video notes: an opinion, a theme, an observation.        | A timed note, or a marker with a note, with a Notion target: new, expands an existing note, or duplicate of one.                                |
| edit    | An editing instruction, such as "cut before this transition".              | A split or clip range where the instruction points, not where it was said.                                                                      |

A line can carry several intents.

## Spoken commands

- **Split** (or Cut) is a command; the app offers it as a Split cue. When the creator means the
  scene change, the cut usually belongs where a black or loading screen ends a few seconds before
  the word. An agent that moves it or names the clips proposes a split with `refines` pointing at
  the cue line, and the creator sees one card with the cue as heard and the agent's changes.
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
- Use the game vocabulary and glossary for names. Keep titles plain and under 100 characters.

## The user's layer

`get_intent_guide` adds, from the open project:

- **Tagged notes:** a `.txt` beside a recording's file, in the format described in
  `electron/intent-notes.ts`. Notes of the recording being worked on are left out, so they can
  serve as ground truth for `scripts/intent-score.mjs`.
- **Decisions:** every accepted, moved, retitled or rejected agent proposal.
- **Profile:** how often each intent is tagged, how often cue words are used, and decision counts.
