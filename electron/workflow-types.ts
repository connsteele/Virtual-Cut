export type Category = 'Character' | 'Combat' | 'Mechanic' | 'Story' | 'Context';
export const colors: Record<Category, string> = {
  Character: '#c2a1e8',
  Combat: '#ed918a',
  Mechanic: '#e3c17e',
  Story: '#89b9ee',
  Context: '#b1bdbb',
};
export interface Marker {
  id: string;
  time: number;
  name: string;
  category: Category;
  topic: string;
  note?: string;
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
  held?: boolean;
  filed?: boolean;
  note?: string;
  holdReason?: string;
  originalName?: string;
  originalFolder?: string;
}
export interface Recording {
  id: string;
  title: string;
  url: string;
  poster: string;
  frames: string[];
  base: number;
  duration: number;
  fps?: number;
  keys?: number[];
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
  chapterSource?: { id: string; start: number; name: string }[];
  frameTimes?: number[];
  audioTracks?: AudioTrack[];
  gameTrack?: number | null;
  micTrack?: number | null;
  monitor?: 'game' | 'mic' | 'both';
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
  selectedRecordingId?: string;
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
