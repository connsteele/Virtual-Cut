import { parseTaggedNotes, type IntentTag } from './intent-notes.js';
import { proposalDecision, proposalIntents } from './proposal-edits.js';
import { AgentReadError, findRecording, type AgentReadSource } from './agent-tools.js';

/**
 * The mic intent guide (VC-155): what a creator means by free mic speech, and how an agent turns
 * it into proposals. It ships with Virtual Cut and is versioned, so every agent reads the same
 * instructions; the user's own labelled examples and habits come with it from their data.
 * docs/intent-guide.md is the readable copy and must match.
 */
export const intentGuideVersion = '1';

export const intentGuide = {
  version: intentGuideVersion,
  purpose:
    'The creator talks into the microphone while playing. Apart from a few spoken commands, ' +
    'that speech is free: it says what they want marked, noted or cut, or gives context for the ' +
    'video. Work out what each mic line is for and propose it with submit_proposals. Every ' +
    'proposal is reviewed by the creator; nothing is applied until they accept it.',
  intents: [
    {
      tag: 'marker',
      meaning: 'Something worth finding again at this moment: a reaction, a good line, a play.',
      propose:
        'A marker at the moment it refers to, often the game line or action just before the ' +
        'speech, with a short title and a note. Use a range marker (end_seconds) to label part ' +
        'of a continuous scene instead of cutting it.',
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
        'intent and a notion target: new, expands an existing note, or duplicate of one. The ' +
        'note keeps its time and recording so it links back to the footage.',
    },
    {
      tag: 'edit',
      meaning: 'An editing instruction, such as "cut before this transition".',
      propose:
        'A split or clip range near where the instruction points, not at the moment it was said. ' +
        'Say in the reason where it was placed and why.',
    },
  ] satisfies { tag: IntentTag; meaning: string; propose: string }[],
  commands: [
    'Split (or Cut) is a spoken command: the app already offers it as a Split cue. When the ' +
      'creator means the scene change, the cut usually belongs where a black or loading screen ' +
      'ends a few seconds before the word. To move it or name the clips, propose a split with ' +
      'refines pointing at the cue line; the creator sees one card with the cue as heard and ' +
      'your changes.',
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
    'Skip coughs, false starts ("never mind"), filler and lines the recognizer invented over noise.',
    'Mic lines about one idea across a session can add up to one composite note: propose a ' +
      'single note with the notion intent and cite every supporting line.',
    'Use the game vocabulary and glossary from get_context for names.',
    'Keep titles under 100 characters and plain; no tags or braces in titles.',
    "Learn from the creator's examples and decisions below: what they accepted, moved, retitled " +
      'or rejected.',
  ],
  pass: [
    'get_current_view or get_project_summary: find the recording.',
    'get_context: game, vocabulary, brief and glossary.',
    'get_intent_guide with the recording_id: this guide, examples and habits.',
    'get_transcript role "mic", all pages; then role "game" around each mic line.',
    'get_annotations for the recording: skip what is already marked or decided.',
    'submit_proposals in batches of up to 50, then tell the creator to review the cards in the ' +
      'transcript window.',
    'Later, get_proposal_decisions shows what they accepted, changed or rejected.',
  ],
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
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The guide plus the user's own layer: labelled lines from tagged notes beside other recordings
 * (never the one being worked on, so the answers are not given away) and decisions on earlier
 * agent proposals, with a short profile of their habits.
 */
export function intentGuideAnswer(
  source: AgentReadSource,
  input: { recording_id?: string; max_examples?: number } = {},
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
  for (const p of source.proposals?.list() || []) {
    const d = proposalDecision(source.model.cueDecisions || [], p.id);
    if (!d || !titles.has(p.sourceId)) continue;
    const mic = p.evidence.find((e) => e.role === 'mic');
    const moved = d.appliedTime != null ? round(d.appliedTime - p.time) : 0;
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
              : ` "${d.title ?? p.title}"`),
    });
  }
  // Decisions first (they say what the creator actually kept), then the tagged lines.
  examples.sort((a, b) => Number(b.from === 'decision') - Number(a.from === 'decision'));
  const decided = examples.filter((e) => e.from === 'decision');
  return {
    guide: intentGuide,
    profile: {
      taggedLines: lines,
      intents: counts,
      cueWordShare: lines ? round(cueWords / lines) : undefined,
      decisions: {
        accepted: decided.filter((e) => e.outcome!.startsWith('accepted')).length,
        rejected: decided.filter((e) => e.outcome!.startsWith('rejected')).length,
        moved: decided.filter((e) => /moved/.test(e.outcome!)).length,
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
