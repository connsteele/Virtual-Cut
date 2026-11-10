/**
 * What's new (VC-242): the release notes built into each version, newest first. The bottom bar's
 * version number opens them in the app, and agent apps read them through `get_whats_new`. Every
 * delivered version needs a finished entry (`npm run deliver` checks it).
 *
 * Write product language only: this file ships in a public repository. No board links, ticket
 * ids, personal names, paths or file names from anyone's computer. Text may use `backticks` for
 * tool and field names and settings; nothing else is formatted.
 *
 * Keep this file free of imports and non-erasable TypeScript, so the delivery script can read it
 * with Node's type stripping before anything is built.
 */
export interface AgentNotes {
  /**
   * Tools and fields added or changed, each named in `backticks`. Empty when nothing changed:
   * the window and get_whats_new then say "No tool changes", so an agent knows nothing was missed.
   * A check fails when a tool the server offers is named in no version's list.
   */
  tools: string[];
  /** What an agent should do differently from now on. */
  doNow?: string[];
  /** What isn't there yet, so an agent doesn't go looking for it. */
  gaps?: string[];
  /** The intent guide version this release ships. */
  intentGuide: number;
}
export interface ReleaseNote {
  /** x.y.z, without a test build's -N label. */
  version: string;
  /** When the version was delivered, as YYYY-MM-DD. */
  date: string;
  title: string;
  /** A few plain bullets for the user. */
  user: string[];
  agents: AgentNotes;
  /** Draft notes written before delivery. Delivery refuses a version whose notes are a draft. */
  draft?: boolean;
}

/** Tools agents had before the first version with notes (0.4.26). */
export const toolsBeforeNotes = [
  'get_current_view',
  'get_project_summary',
  'get_context',
  'get_transcript',
  'get_visual_events',
  'get_screen_text',
  'get_annotations',
  'get_intent_guide',
  'submit_proposals',
  'get_proposal_decisions',
  'get_batch_record',
];

export const releaseNotes: ReleaseNote[] = [
  {
    version: '0.4.30',
    date: '2026-11-09',
    title: 'Draft: work from the first batch, faster scrubbing and this window',
    draft: true,
    user: [
      'Scrubbing keeps up on 4K recordings: exact frames on slow drags, keyframes on fast ones. Settings has `Fastest scrubbing`.',
      'Give a clip a color in Cut; the Resolve helper sets it on the clip in Resolve.',
      'Markers stay inside their own clip in Resolve; stubs from the neighbouring clip are gone.',
      'Every chosen SRT is written, and a clip with no speech gets an empty one.',
      'Importing no longer makes a whole-recording clip; you or the agent cut every clip.',
      'What’s new: click the version number in the bottom bar.',
    ],
    agents: {
      tools: [
        'New `get_whats_new`: these notes for every version since this app last read them, or since `since`.',
        'New `propose_changes`: edits to markers and clips already in the project (name, position or range, trim, marker color, clip color, note), shown to the user as before and after.',
        'New `amend_proposal`: revises one of your own pending cards in place, keeping its versions. Decided, withdrawn and other apps’ cards can’t be amended.',
        '`submit_proposals`: clip ranges take `clip_color`, the Resolve clip color for the clip accepting makes (Resolve’s clip color names, not the marker colors).',
        '`get_annotations` reports each clip’s `clipColor`, and `get_proposal_decisions` the clip color kept.',
      ],
      doNow: [
        'Recordings start with no clips. Propose a clip range for what to keep before any split: a split can’t be accepted on a recording with no clips.',
        'Fix items the user already accepted with `propose_changes`, rather than asking the user to edit them.',
        'Tweak a pending card with `amend_proposal` instead of withdrawing it and proposing again.',
        'Clip companions carry only the markers inside that clip, and each SRT names its transcript (mic, game or both); an empty one means no dialogue.',
      ],
      gaps: ['No tool removes a marker or clip. Propose a change, or ask the user.'],
      intentGuide: 5,
    },
  },
  {
    version: '0.4.29',
    date: '2026-11-06',
    title: 'Fast playback without echo beside the Transcript window',
    user: [
      '2x and 4x play at full speed with the Transcript window open.',
      'The sound no longer repeats like an echo at speed: when the picture stalls, the sound waits instead of replaying a slice.',
    ],
    agents: { tools: [], intentGuide: 4 },
  },
  {
    version: '0.4.28',
    date: '2026-11-06',
    title: 'Agents withdraw proposals and suggest marker colors',
    user: [
      'Proposal cards show the color an agent suggested for a marker, range marker or clip range; Edit changes it.',
      'Cards an agent withdraws leave the Transcript window and stay in the batch record as withdrawn by the agent.',
      'The Transcript window’s counts update as proposals arrive or leave.',
    ],
    agents: {
      tools: [
        'New `withdraw_proposals`: takes back your own proposals still waiting for review. Accepted or rejected ones can’t be withdrawn.',
        '`submit_proposals`: markers, range markers and clip ranges take `color`, one of Resolve’s 16 marker colors. `get_proposal_decisions` reports the color proposed and the color kept.',
      ],
      doNow: [
        'Take back your own pending proposals with `withdraw_proposals` instead of asking the user to reject them.',
        'Give markers the color from the batch brief’s color key; without one a marker is Blue.',
      ],
      gaps: [
        'A clip range’s `color` is its marker color. Clips can’t carry a Resolve clip color yet.',
        'A pending card can’t be changed in place: withdraw it and propose again.',
      ],
      intentGuide: 4,
    },
  },
  {
    version: '0.4.27',
    date: '2026-11-06',
    title: 'Ready for the first real batch',
    user: [
      'Double-clicking a word with Follow playback on opens the editor on that word.',
      'With SRT subtitles chosen, export and filing also write a `.timecode.srt` copy when the video carries a start timecode.',
      'The Resolve helper sets each matching clip’s Resolve transcript from its game dialogue export (Resolve Studio 21.1.2 or later), only on clips that have none.',
    ],
    agents: { tools: [], intentGuide: 4 },
  },
  {
    version: '0.4.26',
    date: '2026-11-05',
    title: 'Agents can look at pictures, and names spelled the game’s way',
    user: [
      'An `Allow pictures` switch in the Agent panel lets agent apps see moments of a recording. It starts off, and Activity shows how many pictures each call sent.',
      'A game’s names and terms get a Heard as list (Cai heard as Kai), applied to its transcripts as ordinary, undoable corrections.',
    ],
    agents: {
      tools: [
        'New `look`: a strip of small tiles across a range, 720p or 1080p frames, or a full-detail crop, several moments in one call and at most about 8,000 image tokens a call, while `Allow pictures` is on.',
      ],
      doNow: [
        'Look when a picture would make the work better, and ask for several moments in one call.',
        'Transcripts now spell the game’s names its way (from its Heard as list); use those spellings in titles.',
      ],
      gaps: [
        'Pictures are refused while the user has `Allow pictures` off; work from transcripts, picture events and screen text then.',
      ],
      intentGuide: 4,
    },
  },
];

/** The release a version belongs to: a test build's "0.4.30-71" reads the 0.4.30 notes. */
export function releaseOf(version: string) {
  return /^(\d+\.\d+\.\d+)/.exec(version.trim())?.[1] ?? '';
}

/** Compares two x.y.z versions (test-build labels are ignored): negative when a is older. */
export function compareVersions(a: string, b: string) {
  const parts = (v: string) => releaseOf(v).split('.').map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

/** Notes newer than `since` (all of them without it), up to `current`, newest first. */
export function notesSince(current: string, since?: string, notes = releaseNotes) {
  return notes
    .filter((n) => compareVersions(n.version, current) <= 0)
    .filter((n) => !since || compareVersions(n.version, since) > 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** The intent guide line: whether this version changed the guide since the version before it. */
export function intentGuideLine(note: ReleaseNote, notes = releaseNotes) {
  const before = notes
    .filter((n) => compareVersions(n.version, note.version) < 0)
    .sort((a, b) => compareVersions(b.version, a.version))[0];
  const changed = !before || before.agents.intentGuide !== note.agents.intentGuide;
  return changed && before
    ? `Version ${note.agents.intentGuide}: read \`get_intent_guide\` again.`
    : `Version ${note.agents.intentGuide}${before ? ', unchanged' : ''}.`;
}

/** Tools a list names in `backticks` anywhere in the notes' tool lists. */
export function toolsNamed(notes = releaseNotes) {
  const named = new Set<string>(toolsBeforeNotes);
  for (const n of notes)
    for (const line of n.agents.tools)
      for (const m of line.matchAll(/`([a-z_]+)`/g)) if (m[1]) named.add(m[1]);
  return named;
}

/** Why a version can't be delivered with these notes, or '' when its entry is ready. */
export function releaseNotesProblem(version: string, notes = releaseNotes) {
  const release = releaseOf(version);
  const entry = notes.find((n) => n.version === release);
  if (!entry) return `electron/release-notes.ts has no entry for ${release || version}.`;
  if (entry.draft) return `The ${release} entry in electron/release-notes.ts is still a draft.`;
  if (!entry.title.trim() || !entry.user.length || !entry.agents)
    return `The ${release} entry needs a title, user notes and agent notes.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date))
    return `The ${release} entry needs a YYYY-MM-DD date.`;
  return '';
}

const draftNote = (version: string) =>
  `Draft notes: they may change before ${version} is delivered. Every delivered version's notes are final.`;

/**
 * What `get_whats_new` answers: the whole notes of every version after `from`, up to the running
 * one, newest first. `basis` says where `from` came from.
 */
export function agentNotes(
  current: string,
  from: string | undefined,
  basis: 'since' | 'last read' | 'paired' | 'all',
  notes = releaseNotes,
) {
  const versions = notesSince(current, from, notes).map((n) => ({
    version: n.version,
    date: n.date,
    title: n.title,
    status: n.draft ? draftNote(n.version) : 'Final.',
    forAgents: {
      tools: n.agents.tools.length ? n.agents.tools : ['No tool changes.'],
      ...(n.agents.doNow?.length ? { doDifferentlyNow: n.agents.doNow } : {}),
      ...(n.agents.gaps?.length ? { knownGaps: n.agents.gaps } : {}),
      intentGuide: intentGuideLine(n, notes),
    },
    forTheUser: n.user,
  }));
  return {
    running: current,
    since: from ?? null,
    basis,
    versions,
    ...(versions.length
      ? {}
      : { note: `Nothing new since ${from}. Virtual Cut ${current} has no newer notes.` }),
  };
}

/**
 * The start of the server instructions when an agent app has notes it hasn't read (VC-242), or
 * '' when it has read them all.
 */
export function unreadNotice(current: string, from: string | undefined, notes = releaseNotes) {
  const versions = notesSince(current, from, notes).map((n) => n.version);
  if (!versions.length) return '';
  const range =
    versions.length === 1 ? versions[0] : `${versions[versions.length - 1]} to ${versions[0]}`;
  return (
    `Virtual Cut is at ${current}, and this app has not read the release notes for ${range}. ` +
    'Call get_whats_new before you start: tools and behaviour may have changed.'
  );
}
