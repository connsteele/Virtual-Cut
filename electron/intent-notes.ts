/**
 * Connor's tagged mic notes (VC-128, VC-155): a `.txt` beside each recording that lists what he
 * said into the microphone, when, and what he meant by it. They are the ground truth for scoring
 * proposals and the seed of the labelled examples agents read through `get_intent_guide`.
 *
 * Format, by example:
 *
 *     00:58:52            time as MM:SS:FF (frames, 60 fps unless "FPS: N" appears above)
 *     {marker, general}   intent tags; {maker} is read as {marker}
 *     It's nice that [small pause] Theodora and Cai get this reunion
 *
 * Text in [brackets] or (parentheses) is an annotation for the reader, not speech. A line that
 * starts with Split, Clip start/in or Clip end/out is a spoken command; for a Split the bracket
 * may say where the cut belongs ("around 4m 40s", "18s 4f", "at the scene change", "exactly
 * here"). An entry with no tags, command or cue word (a cough, "ignore this", ordinary talk) is
 * speech that must not become a proposal.
 */
export const intentTags = ['marker', 'general', 'notion', 'edit'] as const;
export type IntentTag = (typeof intentTags)[number];
export type SpokenCommand = 'split' | 'clip-start' | 'clip-end';
export interface SplitTarget {
  /** exact: where it was said; time: an absolute time given in the note; scene-change: the black or loading screen before it. */
  kind: 'exact' | 'time' | 'scene-change';
  time?: number;
}
export interface TaggedEntry {
  /** Seconds into the recording. */
  at: number;
  end?: number;
  /** The time as written in the note. */
  written: string;
  tags: IntentTag[];
  command?: SpokenCommand;
  /** A Marker/Mark/Note cue word said before free speech (old style, still understood). */
  cueWord?: 'marker' | 'note';
  /** What was said, annotations removed. */
  said: string;
  /** The annotations, in order. */
  context: string[];
  /** Speech that should produce no proposal. */
  ignore: boolean;
  splitAt?: SplitTarget;
}
export interface TaggedNotes {
  fps: number;
  micTrack: number;
  entries: TaggedEntry[];
}

const stamp = /^(\d{1,2}):(\d\d):(\d\d)(?:\s*-\s*(\d{1,2}):(\d\d):(\d\d))?$/;
const aliases: Record<string, IntentTag> = {
  marker: 'marker',
  maker: 'marker',
  mark: 'marker',
  general: 'general',
  notion: 'notion',
  edit: 'edit',
};

function annotations(text: string) {
  const context: string[] = [];
  // Brackets may nest braces ("{Cai's hand}") and span lines; braces that are not tag lists are
  // annotations too.
  const said = text
    .replace(/\[([^\]]*)\]?/g, (_, inner: string) => {
      context.push(inner.replace(/\s+/g, ' ').trim());
      return ' ';
    })
    .replace(/\(([^)]*)\)/g, (_, inner: string) => {
      context.push(inner.replace(/\s+/g, ' ').trim());
      return ' ';
    })
    .replace(/\{([^}]*)\}/g, (_, inner: string) => {
      context.push(inner.replace(/\s+/g, ' ').trim());
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { said, context: context.filter(Boolean) };
}

/** Where a spoken Split should cut, from its annotation. */
export function splitTarget(context: string[], fps = 60): SplitTarget | undefined {
  const text = context.join(' ').toLowerCase();
  if (!text) return undefined;
  const ms = /(\d+)\s*m\s*(\d+(?:\.\d+)?)\s*s\b/.exec(text);
  if (ms) return { kind: 'time', time: Number(ms[1]) * 60 + Number(ms[2]) };
  const sf = /(\d+(?:\.\d+)?)\s*s\s*(\d+)\s*f\b/.exec(text);
  if (sf) return { kind: 'time', time: Number(sf[1]) + Number(sf[2]) / fps };
  const s = /\b(?:around|at)\s+(\d+(?:\.\d+)?)\s*s\b/.exec(text);
  if (s) return { kind: 'time', time: Number(s[1]) };
  if (/\bexactly\b/.test(text)) return { kind: 'exact' };
  if (/black|loading|scene change|between (?:the )?scenes/.test(text))
    return { kind: 'scene-change' };
  return undefined;
}

export function parseTaggedNotes(text: string): TaggedNotes {
  const fps = Number(/FPS:\s*(\d+(?:\.\d+)?)/i.exec(text)?.[1] || 60);
  const micTrack = Number(/Mic track:\s*(\d+)/i.exec(text)?.[1] || 2);
  const seconds = (m: string, s: string, f: string) => Number(m) * 60 + Number(s) + Number(f) / fps;
  const lines = text.split(/\r?\n/);
  const starts: number[] = [];
  lines.forEach((l, i) => stamp.test(l.trim()) && starts.push(i));
  const entries = starts.map((line, n): TaggedEntry => {
    const m = stamp.exec(lines[line].trim())!;
    const body = lines.slice(line + 1, starts[n + 1] ?? lines.length).map((l) => l.trim());
    const tags: IntentTag[] = [];
    // A line made only of a {tag, tag} list carries the tags; any other braces are annotations.
    const rest = body.filter((l) => {
      const list = /^\{([^}]*)\}$/.exec(l);
      const names = list?.[1].split(/[,\s]+/).filter(Boolean) ?? [];
      if (!list || !names.length || !names.every((x) => aliases[x.toLowerCase()])) return true;
      for (const x of names) {
        const tag = aliases[x.toLowerCase()];
        if (!tags.includes(tag)) tags.push(tag);
      }
      return false;
    });
    const { said, context } = annotations(rest.filter(Boolean).join(' '));
    const lower = said.toLowerCase();
    // A tagged line is free speech even when it starts with a command word ("cut before this").
    const command: SpokenCommand | undefined = tags.length
      ? undefined
      : /^(?:split|cut)\b/.test(lower)
        ? 'split'
        : /^clip[\s-]+(?:start|in)\b/.test(lower)
          ? 'clip-start'
          : /^clip[\s-]+(?:end|out)\b/.test(lower)
            ? 'clip-end'
            : undefined;
    const cueWord = command
      ? undefined
      : /^(?:marker|mark)\b/.test(lower)
        ? 'marker'
        : /^note\b/.test(lower)
          ? 'note'
          : undefined;
    return {
      at: seconds(m[1], m[2], m[3]),
      ...(m[4] ? { end: seconds(m[4], m[5], m[6]) } : {}),
      written: lines[line].trim(),
      tags,
      ...(command ? { command } : {}),
      ...(cueWord ? { cueWord } : {}),
      said,
      context,
      ignore: !tags.length && !command && !cueWord,
      ...(command === 'split' ? { splitAt: splitTarget(context, fps) } : {}),
    };
  });
  return { fps, micTrack, entries };
}
