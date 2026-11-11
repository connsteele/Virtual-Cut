export type Category = 'Character' | 'Combat' | 'Mechanic' | 'Story' | 'Context';
export const colors: Record<Category, string> = {
  Character: '#c2a1e8',
  Combat: '#ed918a',
  Mechanic: '#e3c17e',
  Story: '#89b9ee',
  Context: '#b1bdbb',
};
// Names/order match Resolve's MarkerColor API. Categories remain independent.
export const markerColors = {
  Blue: '#3f80d6',
  Cyan: '#26bfd0',
  Green: '#47ad57',
  Yellow: '#e7d746',
  Red: '#dc4b4b',
  Pink: '#e58fb9',
  Purple: '#964ac3',
  Fuchsia: '#d44db4',
  Rose: '#d98e9e',
  Lavender: '#b6a1db',
  Sky: '#93c8e6',
  Mint: '#98d5bd',
  Lemon: '#ece49d',
  Sand: '#d6c299',
  Cocoa: '#987862',
  Cream: '#e6ddc2',
} as const;
export type MarkerColor = keyof typeof markerColors;
export function markerColorName(marker: Marker): MarkerColor {
  if (marker.color && Object.hasOwn(markerColors, marker.color)) return marker.color;
  // Keep legacy category meanings; new markers explicitly start Blue.
  return (
    (
      {
        Character: 'Lavender',
        Combat: 'Red',
        Mechanic: 'Yellow',
        Story: 'Blue',
        Context: 'Blue',
      } as const
    )[marker.category] || 'Blue'
  );
}
export function markerColor(marker: Marker) {
  return markerColors[markerColorName(marker)];
}
// Names/order match Resolve's ClipColor API, which differs from its marker colors.
// The hex values approximate Resolve's swatches for display only.
export const clipColors = {
  Orange: '#e8862a',
  Apricot: '#f3a65a',
  Yellow: '#e2c13b',
  Lime: '#9fc63f',
  Olive: '#5f9a3a',
  Green: '#3fa86b',
  Teal: '#2fa3a3',
  Navy: '#2e5b9e',
  Blue: '#4a8fd8',
  Purple: '#8a56c2',
  Violet: '#c156c9',
  Pink: '#e2669c',
  Tan: '#c9a880',
  Beige: '#e0cfae',
  Brown: '#9a6a3e',
  Chocolate: '#6e4a32',
} as const;
export type ClipColor = keyof typeof clipColors;
export function isClipColor(value: unknown): value is ClipColor {
  return typeof value === 'string' && Object.hasOwn(clipColors, value);
}
export interface Marker {
  id: string;
  time: number;
  /** Exclusive source end; absent for a point marker. */
  end?: number;
  name: string;
  category: Category;
  topic: string;
  note?: string;
  color?: MarkerColor;
}
export interface Clip {
  id: string;
  rid: string;
  name: string;
  start: number;
  end: number;
  folder: string;
  include: boolean;
  accepted?: boolean;
  /** Native signature of the exact accepted content. Never a filing receipt. */
  acceptedKey?: string;
  held?: boolean;
  filed?: boolean;
  note?: string;
  holdReason?: string;
  originalName?: string;
  originalFolder?: string;
  /** Optional Resolve clip color (VC-207); absent means Resolve's default. */
  color?: ClipColor;
  /**
   * Spans cut out of the middle of the clip, in source time, sorted and apart (VC-212). The clip
   * still exports as one file; absent when it has none.
   */
  gaps?: ClipGap[];
}
/** A span cut out of a clip (VC-212). Never touches the clip's start or end. */
export interface ClipGap {
  id: string;
  start: number;
  end: number;
}
export interface Recording {
  /** Read-only completed output; playback uses its embedded game audio. */
  retained?: boolean;
  id: string;
  title: string;
  url: string;
  poster: string;
  frames: string[];
  base: number;
  duration: number;
  fps?: number;
  /**
   * Keyframe and per-frame timestamps. Project models never persist these (schema 5
   * keeps them in the frame_indexes table); the renderer attaches them on demand, and
   * sample and completed-output recordings carry them directly.
   */
  keys?: number[];
  /** Number of indexed keyframes and frames, kept in the model when the arrays are not. */
  keyCount?: number;
  frameCount?: number;
  position: number;
  sample: boolean;
  context: string;
  pinned?: string;
  fullResolution?: boolean;
  width?: number;
  height?: number;
  codec?: string;
  batchIds?: string[];
  sourcePath?: string;
  availability?: 'ready' | 'pending' | 'missing' | 'changed' | 'failed';
  error?: string;
  timeBase?: string;
  sourceStart?: number;
  captureTime?: string;
  sourceModified?: number;
  importedAt?: number;
  chapterSource?: { id: string; start: number; name: string }[];
  frameTimes?: number[];
  audioTracks?: AudioTrack[];
  gameTrack?: number | null;
  micTrack?: number | null;
  monitor?: 'game' | 'mic' | 'both';
  importAudio?: import('./project-contracts.js').ImportAudio;
  audioWarning?: string;
  /** The recording's playback proxy as of this snapshot (Sprint 15). Worked out from the
   * native record each time, never saved in the model. */
  proxy?: import('./proxy-record.js').RecordingProxy;
}
export interface AudioTrack {
  index: number;
  codec: string;
  channels: number;
  title: string;
  language: string;
  offset: number;
  duration?: number;
  previewUrl?: string;
  waveform?: { peaks: number[]; duration: number };
}
export interface Term {
  id: string;
  name: string;
  kind: string;
  aliases: string;
  definition: string;
  pronunciation: string;
  group?: string;
  image?: string;
}
export interface Link {
  from: string;
  to: string;
  label: string;
}
export interface Note {
  sourceId?: string;
  time?: number;
  transcriptId?: string;
  segmentIds?: number[];
  id: string;
  title: string;
  text: string;
  url: string;
}
export interface Entry {
  id: string;
  rid: string;
  cid?: string;
  name: string;
  start: number;
  end: number;
}
export interface Target {
  id: string;
  name: string;
  duration: number;
  items: Entry[];
}
export interface Model {
  transcriptEdits?: import('./transcript-contracts.js').TranscriptEdit[];
  /** Short microphone lines with no speech, left out of the transcript (VC-166). */
  droppedLines?: import('./transcript-contracts.js').DroppedLine[];
  /** Words restored from a heard-as correction; a later apply leaves them as heard (VC-194). */
  heardAsKept?: string[];
  cueDecisions?: import('./transcript-contracts.js').CueDecision[];
  contexts?: import('./project-context.js').CreativeContext[];
  selectedRecordingId?: string;
  /** The viewer's Original/Proxy switch for the whole project (VC-238). Absent means Proxy: a
   * recording without a usable proxy shows its original either way. Navigation, like the
   * selected recording: saved with the project, never an undo step. */
  viewerSource?: 'original' | 'proxy';
  recordings: Recording[];
  clips: Clip[];
  markers: Record<string, Marker[]>;
  terms: Term[];
  links: Link[];
  notes: Note[];
  sequence: Entry[];
  targets: Target[];
  folders: string[];
  markerBaseline?: Record<string, Marker[]>;
  uiRevision?: number;
  scratchpad?: string;
}
