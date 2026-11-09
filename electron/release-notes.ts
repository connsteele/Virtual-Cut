/**
 * What's new (VC-242): the release notes built into each version, newest first. The bottom bar's
 * version number opens them in the app, and agent apps read the For agents lists through
 * `get_whats_new`. Every delivered version needs an entry (`npm run deliver` checks it).
 *
 * Write product language only: this file ships in a public repository. No board links, ticket
 * ids, personal names, paths or file names from anyone's computer. Text may use `backticks` for
 * tool names and settings; nothing else is formatted.
 *
 * Keep this file free of imports and non-erasable TypeScript, so the delivery script can read it
 * with Node's type stripping before anything is built.
 */
export interface ReleaseNote {
  /** x.y.z, without a test build's -N label. */
  version: string;
  /** When the version was delivered, as YYYY-MM-DD. */
  date: string;
  title: string;
  /** A few plain bullets for the user. */
  user: string[];
  /**
   * For agents: tools added or changed, behaviour an agent meets, the intent guide version.
   * Say "No tool changes." when there are none, so an agent knows it was not missed.
   */
  agents: string[];
  /** Draft notes written before delivery. Delivery refuses a version whose notes are a draft. */
  draft?: boolean;
}

export const releaseNotes: ReleaseNote[] = [
  {
    version: '0.4.30',
    date: '2026-11-09',
    title: 'Draft: work from the first batch, faster scrubbing and this window',
    draft: true,
    user: [
      'Draft notes, rewritten when 0.4.30 is delivered.',
      'Scrubbing keeps up on 4K recordings: exact frames on slow drags, keyframes on fast ones. Settings has `Fastest scrubbing`.',
      'Give a clip a color in Cut; the Resolve helper sets it on the clip in Resolve.',
      'Markers stay inside their own clip in Resolve; stubs from the neighbouring clip are gone.',
      'Every chosen SRT is written, and a clip with no speech gets an empty one.',
      'Importing no longer makes a whole-recording clip; you or the agent cut every clip.',
      'What’s new: click the version number in the bottom bar.',
    ],
    agents: [
      'Draft notes, rewritten when 0.4.30 is delivered.',
      'New tool `get_whats_new`: these notes for every version since this app last read them.',
      'Recordings start with no clips. Propose a clip range before any split.',
      '`propose_changes` proposes edits to markers and clips that already exist (name, position, trim, color, clip color, note), shown as before and after.',
      '`amend_proposal` revises one of your own pending cards in place.',
      'Clip companions carry only the markers inside that clip.',
      'Each SRT names its transcript (mic, game or both); an empty one means no dialogue.',
    ],
  },
  {
    version: '0.4.29',
    date: '2026-11-06',
    title: 'Fast playback without echo beside the Transcript window',
    user: [
      '2x and 4x play at full speed with the Transcript window open.',
      'The sound no longer repeats like an echo at speed: when the picture stalls, the sound waits instead of replaying a slice.',
    ],
    agents: ['No tool changes.'],
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
    agents: [
      'New tool `withdraw_proposals`: takes back your own proposals still waiting for review. Accepted or rejected ones can’t be withdrawn.',
      'Marker, range marker and clip range proposals can carry one of Resolve’s 16 marker colors (`color`). `get_proposal_decisions` reports the color proposed and the color kept.',
    ],
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
    agents: ['No tool changes.'],
  },
  {
    version: '0.4.26',
    date: '2026-11-05',
    title: 'Agents can look at pictures, and names spelled the game’s way',
    user: [
      'An `Allow pictures` switch in the Agent panel lets agent apps see moments of a recording. It starts off, and Activity shows how many pictures each call sent.',
      'A game’s names and terms get a Heard as list (Cai heard as Kai), applied to its transcripts as ordinary, undoable corrections.',
    ],
    agents: [
      'New tool `look`: a strip of small tiles across a range, 720p or 1080p frames, or a full-detail crop, several moments in one call and at most about 8,000 image tokens a call, while `Allow pictures` is on.',
      'Intent guide version 4: look when a picture would make the work better, and ask for several moments in one call.',
      'Transcripts follow the game’s spelling from its Heard as list.',
    ],
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

/** Why a version can't be delivered with these notes, or '' when its entry is ready. */
export function releaseNotesProblem(version: string, notes = releaseNotes) {
  const release = releaseOf(version);
  const entry = notes.find((n) => n.version === release);
  if (!entry) return `electron/release-notes.ts has no entry for ${release || version}.`;
  if (entry.draft) return `The ${release} entry in electron/release-notes.ts is still a draft.`;
  if (!entry.title.trim() || !entry.user.length || !entry.agents.length)
    return `The ${release} entry needs a title, user notes and a For agents list.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date))
    return `The ${release} entry needs a YYYY-MM-DD date.`;
  return '';
}

/**
 * What `get_whats_new` answers: the For agents lists of every version after `from`, up to the
 * running one, newest first. `basis` says where `from` came from.
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
    agents: n.agents,
    ...(n.draft ? { draft: true } : {}),
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
