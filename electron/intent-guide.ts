import { parseTaggedNotes, type IntentTag } from './intent-notes.js';
import { proposalDecision, proposalIntents, rejectReasonLabel } from './proposal-edits.js';
import { changesSinceAccepting, type LaterChange } from './batch-record.js';
import { rejectReasons, type RejectReason } from './transcript-contracts.js';
import { AgentReadError, findRecording, type AgentReadSource } from './agent-tools.js';

/**
 * The intent guide (VC-155, v2 VC-187, v3 VC-191, v4 VC-172, v5 VC-224, v6 general only): what a creator means by free mic speech, what to propose
 * when there is none, and how an agent turns it into proposals. It ships with Virtual Cut and is
 * versioned, so every agent reads the same instructions; the user's own labelled examples and
 * habits come with it from their data. docs/intent-guide.md is the readable copy and must match.
 */
export const intentGuideVersion = '6';

/**
 * v4 (VC-172): the lessons' sentences about the look tool. Agents read them only while Allow
 * pictures is on (one switch for every paired app); with it off they read the guide without them.
 */
export const lookLessons = [
  // Accepted as S12-GUIDE with "Connor"; the guide says "the creator" everywhere else.
  "Look whenever seeing the picture would make your work better: a more accurate trim or Split, a marker on the right moment, a name or detail the text can't settle, a pattern across scenes, or something the creator asked you to find. Picture events, screen text and transcripts are the quick way to find where to look.",
  'When you have several moments to check, look at them together in one call. Start with a strip, and ask for a 720p frame, a 1080p frame or a crop where you need detail.',
  'When a picture decided a proposal, say so in its reason.',
] as const;

export const intentGuide = {
  version: intentGuideVersion,
  purpose:
    'The creator talks into the microphone while playing. Apart from a few spoken commands, ' +
    'that speech is free: it says what they want marked, noted or cut, or gives context for the ' +
    'video. Work out what each mic line is for and propose it with submit_proposals. Mic speech ' +
    'is optional evidence, never a requirement: some sessions have no commentary, and then the ' +
    'game alone says what to propose. Every proposal is reviewed by the creator; nothing is ' +
    'applied until they accept it.',
  intents: [
    {
      tag: 'marker',
      meaning: 'Something worth finding again at this moment: a reaction, a good line, a play.',
      propose:
        'A marker at the moment it refers to, often the game line or action just before the ' +
        'speech, with a short title and a note. A part of one continuous scene is a range marker ' +
        '(end_seconds), not a clip range.',
    },
    {
      tag: 'general',
      meaning:
        'Context about the clip or the video: what is happening, what this part is for, the ' +
        "creator's take. It informs names and other proposals.",
      propose:
        'Usually no proposal of its own. Use it for titles, notes, clip names, and for composite ' +
        'notes. Propose a marker or note only when the line also asks to keep the moment.',
    },
    {
      tag: 'notion',
      meaning: 'A thought for the video notes: an opinion, a theme, an observation to write up.',
      propose:
        'A timed note, or a marker with a note when there is a clear moment, with the notion ' +
        'intent and a notion target: new, expands an existing note, or duplicate of one. ' +
        "Existing notes are this project's notes and the video's notes page in Notion. Virtual " +
        'Cut has no Notion link yet, so check the Notion page only when you can read it ' +
        'yourself, and say which you checked. The note keeps its time and recording so it links ' +
        'back to the footage.',
    },
    {
      tag: 'edit',
      meaning: 'An editing instruction, such as "cut before this transition".',
      propose:
        'Clip ranges near where the instruction points, not at the moment it was said, with the ' +
        'boundary where it asks for a cut. Say in the reason where it was placed and why. Inside ' +
        'one continuous scene, propose a range marker rather than a clip range.',
    },
  ] satisfies { tag: IntentTag; meaning: string; propose: string }[],
  commands: [
    'Split (or Cut) is a spoken command: the app already offers it as a Split cue. Keep a Split ' +
      'where it was said unless a black screen ends within 5 s before it. Propose a cut up to ' +
      "12 s back only when what's said shows the call came late, and say why. That time is " +
      'where the clip boundary goes: propose the clip ranges on either side of it and cite the ' +
      'cue line.',
    'Clip start/in and Clip end/out are commands too and pair into a clip range.',
    'Marker, Mark and Note are no longer needed as cue words, but older recordings use them. A ' +
      'line that starts with one is still free speech to interpret; rework the cue with refines ' +
      'rather than proposing a second marker beside it.',
  ],
  rules: [
    'A line can carry several intents; give all of them in intents.',
    'Read the game dialogue around each mic line (get_transcript with role "game"): it usually ' +
      'says what just happened, fixes misheard names, and is the best source for a note.',
    'Cite the mic line and the game lines you used as evidence.',
    'Cut one clip per coherent activity or scene, such as character creation, a mission or a ' +
      'conversation, and give it an overall name. Split only where the activity or scene ' +
      'really changes, and trim only real fat: menus, loading, dead air and repeats. Trimming ' +
      'that fat is expected on every recording. Inside a clip, the structure goes in range ' +
      'markers. For example, character creation is one clip with a range marker for each tab.',
    'Import makes no clip, and a recording with no clip exports nothing. Propose at least one ' +
      "named clip range on every recording, trimmed to what's worth keeping, even when the rest " +
      'of the pass is markers. If all of it is worth keeping, propose one clip over the whole ' +
      'recording. Where footage should become two clips, propose both clip ranges, each with ' +
      'its name and its in and out, rather than a split. A spoken Split cue marks a place where ' +
      'the creator wants a clip boundary: propose the clip ranges on either side of it and cite ' +
      'the cue line.',
    'Several clip ranges on one recording are fine: each becomes its own exported file, named ' +
      "after its clip. Leave the trimmed fat between them as gaps. Don't overlap clips unless " +
      'the creator asks for it, or the footage really belongs to more than one clip; then say ' +
      'why in the reason.',
    'No mic, or a silent mic: mic speech is optional evidence, never a requirement. Some ' +
      'sessions are recorded just to relax, with no commentary. When there is no mic track, or ' +
      'it is silent, say so first in your summary ("No commentary on this recording; proposals ' +
      'come from the game alone") and propose from the game: game dialogue, scene changes, ' +
      'menus and battles. Never read silence as "nothing worth keeping".',
    'Recurring moments (MVP screen, level-up, rewards, victory poses): propose clips for the ' +
      'first few instances in a game, so the edit has variations to choose from. After that, ' +
      'propose a point marker at most, or nothing. How many is your call: enough for a real ' +
      'choice, and fewer when the instances look the same. To see what earlier batches of the ' +
      'game already have, read get_annotations for each of those batches: their clips, ' +
      "markers, range markers and notes. That is one call per batch, so don't read earlier " +
      'batches\' transcripts just to count. Anything said on the mic, such as "clip this ' +
      'one", overrides this.',
    'Skip coughs, false starts ("never mind"), filler and lines the recognizer invented over noise.',
    'Mic lines about one idea across a session can add up to one composite note: propose a ' +
      'single note with the notion intent and cite every supporting line.',
    'Use the game vocabulary and glossary from get_context for names.',
    'Keep titles under 100 characters and plain; no tags or braces in titles. Title a range ' +
      'marker or clip range by the topic it covers, in words you would search for later, such ' +
      'as "Bonus Talents", and call out firsts, such as "First Relay Jump". Name both the same ' +
      'way, since a proposal can be accepted as either. Put the specifics in the note.',
    'A clip name becomes the exported file name, so it follows Windows rules: 1 to 180 ' +
      'characters, none of \\ / : * ? " < > |, no leading or trailing spaces, no trailing dot, ' +
      'and not a reserved name such as CON or NUL. Use a dash where you would reach for a ' +
      'colon, as in "Prologue - Find the Beacon". The fileNames section lists what to use ' +
      'instead of each character.',
    "Write a note as short lines that start with Scene: (what's on screen), Me: (the " +
      "creator's point, in the first person) and Fact: (a checked fact), using only the lines " +
      "that apply. Don't make a marker for the creator just talking to themselves.",
    'When the creator states a fact on the mic, such as a stat, a lore point or a release ' +
      'detail, check it against the game dialogue, the screen text and what you know of the ' +
      'game. Add a Fact: line only when they got it wrong, or when there is something key to ' +
      'add. When the claim holds, leave the Fact: line out.',
    'Start a range at the on-screen event it covers, such as the first frame of a cutscene, ' +
      'not at the mic line about it. Before you call a span fat, check what it is: ' +
      'get_visual_events shows where the picture goes black, freezes or fades, and a black ' +
      'span can be a loading screen, a fade inside a scene or the scene itself. When pictures ' +
      'are allowed, look at it.',
    'To change one of your own cards before the creator decides, use amend_proposal. ' +
      "Don't withdraw it and propose again. To change a marker or clip that already exists " +
      '(its name, position or range, color, Resolve clip color, note, or a trim), use ' +
      'propose_changes: each change is a card showing before and after, and nothing changes ' +
      'until the creator accepts.',
    "Learn from the creator's examples and decisions below: what they accepted, moved, retitled " +
      'or rejected, why when they said (why), and what they changed after accepting (later). ' +
      'A reject for the wrong moment means the idea was right but the time was not.',
  ],
  // v6: one guide for every game. Rules for a single game live in its brief and context.
  gameRules:
    'This guide is the same for every game. Rules for one game, such as what its marker colors ' +
    "mean or how its menus work, come from that game's brief and context (get_context), which " +
    "the creator edits per game, or from the creator's Notion pages for the game when you can " +
    'read them. Follow them there; when you learn something that holds for one game only, ' +
    'suggest it to the creator for the brief rather than applying it everywhere.',
  // v3 (VC-191): screen text through MCP; the second is decision D6's held sentence.
  lessons: [
    'Screen text is raw: every piece of text the screen showed, from dialogue to menus, tooltips and damage numbers. Use where and how long it stayed up to judge what it is.',
    'Spell a name only as it was seen written on screen (get_screen_text) or as it appears in the game vocabulary. Otherwise mark it unsure.',
  ] as string[],
  // v5 (VC-224, M452): what to use instead of each character Windows file names can't hold.
  fileNames: {
    rule:
      'Clip names become file names. Replace each character below, keep names 1 to 180 ' +
      'characters with no leading or trailing spaces and no trailing dot, and avoid the names ' +
      'Windows reserves: CON, PRN, AUX, NUL, COM1 to COM9 and LPT1 to LPT9.',
    avoid: [
      { characters: ':', use: ' - ' },
      { characters: '/ \\', use: ' - ', or: 'the word "and"' },
      { characters: '?', use: 'leave it out' },
      { characters: '*', use: 'leave it out' },
      { characters: '"', use: "'" },
      { characters: '< >', use: '( )' },
      { characters: '|', use: ' - ' },
      { characters: 'tabs, new lines and other control characters', use: 'a space' },
    ],
  },
  pass: [
    'get_current_view or get_project_summary: find the recording.',
    'get_context: game, vocabulary, brief and glossary.',
    'get_intent_guide with the recording_id: this guide, examples and habits.',
    'get_transcript role "mic", all pages; then role "game" around each mic line. With no mic ' +
      'transcript, or only silence, read role "game" in full instead.',
    'get_annotations for the recording: skip what is already marked or decided.',
    'Check which recordings have no clip yet; each one gets a clip range.',
    'submit_proposals in batches of up to 50, then tell the creator to review the cards in the ' +
      'transcript window.',
    'To fix a pending card, amend it; to fix something already in the project, propose a ' +
      'change.',
    'Later, get_proposal_decisions shows what they accepted, changed or rejected.',
  ],
};

/** The guide while Allow pictures is on: the lessons add lookLessons. */
const withPictures = {
  ...intentGuide,
  lessons: [...intentGuide.lessons, ...lookLessons],
};

export interface IntentExample {
  from: 'tagged notes' | 'decision';
  recording: string;
  time: number;
  said: string;
  intents: IntentTag[];
  command?: string;
  context?: string;
  outcome?: string;
  /** The creator's reason for the decision, in their words or as the reason they tapped. */
  why?: string;
  /** What they changed later to what accepting made, such as "marker given an end". */
  later?: string;
}

const itemChange = (c: LaterChange) => {
  if (c.removed) return `${c.item} removed`;
  const bits = [
    c.changed?.start && `moved ${signedSeconds(c.changed.start.to - c.changed.start.from)}`,
    c.changed?.end &&
      (c.changed.end.from === undefined
        ? 'given an end'
        : c.changed.end.to === undefined
          ? 'end cleared'
          : `end moved ${signedSeconds(c.changed.end.to - c.changed.end.from)}`),
    c.changed?.name && `renamed "${c.changed.name.to}"`,
    c.changed?.note && 'note edited',
  ].filter(Boolean);
  return `${c.splitClip ? 'clip it split' : c.item} ${bits.join(', ')}`;
};
const signedSeconds = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n * 100) / 100} s`;

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The guide plus the user's own layer: labelled lines from tagged notes beside other recordings
 * (never the one being worked on, so the answers are not given away) and decisions on earlier
 * agent proposals, with a short profile of their habits.
 */
export function intentGuideAnswer(
  source: AgentReadSource,
  input: { recording_id?: string; max_examples?: number; pictures?: boolean } = {},
) {
  const current = input.recording_id ? findRecording(source, input.recording_id) : undefined;
  const max = input.max_examples ?? 40;
  if (!Number.isInteger(max) || max < 0 || max > 200)
    throw new AgentReadError('max_examples: give a whole number from 0 to 200.');
  const examples: IntentExample[] = [];
  let lines = 0,
    cueWords = 0;
  const counts: Record<IntentTag, number> = { marker: 0, general: 0, notion: 0, edit: 0 };
  for (const r of source.model.recordings) {
    if (r.id === current?.id || r.sample) continue;
    const text = source.taggedNotes?.(r.id);
    if (!text) continue;
    for (const e of parseTaggedNotes(text).entries) {
      if (e.ignore || (!e.tags.length && !e.command)) continue;
      lines++;
      if (e.cueWord) cueWords++;
      for (const t of e.tags) counts[t]++;
      examples.push({
        from: 'tagged notes',
        recording: r.title,
        time: round(e.at),
        said: e.said.slice(0, 600),
        intents: e.tags,
        ...(e.command ? { command: e.command } : {}),
        ...(e.context.length ? { context: e.context.join(' / ').slice(0, 600) } : {}),
      });
    }
  }
  const titles = new Map(source.model.recordings.map((r) => [r.id, r.title]));
  const reasons = Object.fromEntries(rejectReasons.map((r) => [r, 0])) as Record<
    RejectReason,
    number
  >;
  for (const p of source.proposals?.list() || []) {
    const d = proposalDecision(source.model.cueDecisions || [], p.id);
    if (!d || !titles.has(p.sourceId)) continue;
    const mic = p.evidence.find((e) => e.role === 'mic');
    const moved = d.appliedTime != null ? round(d.appliedTime - p.time) : 0;
    const why = d.why?.reason
      ? rejectReasonLabel[d.why.reason].toLowerCase() + (d.why.note ? `: ${d.why.note}` : '')
      : d.why?.note;
    if (d.why?.reason) reasons[d.why.reason]++;
    const later = changesSinceAccepting(source.model, p, d).map(itemChange).join('; ');
    examples.push({
      from: 'decision',
      recording: titles.get(p.sourceId)!,
      time: round(p.time),
      said: (mic?.quote || p.refines?.text || '').slice(0, 600),
      intents: proposalIntents(p),
      outcome:
        d.status === 'rejected'
          ? `rejected ${p.kind === 'cut' ? 'split' : p.kind} "${p.title}"`
          : `accepted ${p.kind === 'cut' ? 'split' : p.kind}` +
            (moved ? `, moved ${moved > 0 ? '+' : ''}${moved} s` : '') +
            (d.title != null && d.title !== p.title && p.kind !== 'cut'
              ? `, retitled "${p.title}" → "${d.title}"`
              : ` "${d.title ?? p.title}"`) +
            (d.kindChange ? `, kept as ${d.kindChange.to.replace('-', ' ')}` : ''),
      ...(why ? { why } : {}),
      ...(later ? { later } : {}),
    });
  }
  // Decisions first (they say what the creator actually kept), then the tagged lines.
  examples.sort((a, b) => Number(b.from === 'decision') - Number(a.from === 'decision'));
  const decided = examples.filter((e) => e.from === 'decision');
  return {
    guide: input.pictures ? withPictures : intentGuide,
    profile: {
      taggedLines: lines,
      intents: counts,
      cueWordShare: lines ? round(cueWords / lines) : undefined,
      decisions: {
        accepted: decided.filter((e) => e.outcome!.startsWith('accepted')).length,
        rejected: decided.filter((e) => e.outcome!.startsWith('rejected')).length,
        moved: decided.filter((e) => /moved/.test(e.outcome!)).length,
        rejectReasons: reasons,
        changedAfterAccepting: decided.filter((e) => e.later).length,
      },
      notes:
        lines && cueWords / lines < 0.2
          ? ['Rarely uses cue words: read free speech for intent rather than waiting for one.']
          : [],
    },
    examples: examples.slice(0, max),
    moreExamples: Math.max(0, examples.length - max),
    projectRevision: source.revision,
  };
}
