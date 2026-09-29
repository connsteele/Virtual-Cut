import folders from './sample-folders.json';
import demoRecordings from './demo-recordings.json';
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
}
export const uid = () => crypto.randomUUID();
export const time = (n: number) => {
  n = Math.max(0, Number.isFinite(n) ? n : 0);
  const h = Math.floor(n / 3600);
  return (
    (h ? String(h).padStart(2, '0') + ':' : '') +
    String(Math.floor(n / 60) % 60).padStart(2, '0') +
    ':' +
    (n % 60).toFixed(3).padStart(6, '0')
  );
};
export const short = (n: number) => time(n).slice(0, -4);
export const references = [
  {
    id: 'ref-cai',
    name: 'Cai unlocks Blaze Arts',
    image: '/demo/cai-blaze.jpg',
    path: 'Mechanics/Blaze Arts/FW A1 CH01 Cai unlocks Blaze Arts.mp4',
  },
  {
    id: 'ref-leda',
    name: 'Theodora: Dazzling Comet · Leda route',
    image: '/demo/leda-blaze.jpg',
    path: 'Mechanics/Blaze Arts/FW A2 CH03 Leda Theodora Blaze Art Dazzling Comet straight line multi kill.mp4',
  },
  {
    id: 'ref-dagsion',
    name: 'Cai explores Dagsion',
    image: '/demo/dagsion.jpg',
    path: 'General Gameplay/Dagsion/FW A1 CH03 Cai explores limited early Dagison city access.mp4',
  },
  {
    id: 'ref-support',
    name: 'Cai × Peter · C support',
    image: '/demo/cai-peter.jpg',
    path: 'Supports/FW Support Cai x Peter C.mp4',
  },
];
export function initialModel(): Model {
  const recordings: Recording[] = demoRecordings.map((r) => ({ ...r }));
  const clips: Clip[] = demoRecordings.map((r, i) => ({
    id: 'c' + (i + 1),
    rid: r.id,
    name: r.title,
    originalName: r.title,
    originalFolder: r.folder,
    start: 0,
    end: r.duration,
    folder: r.folder,
    include: true,
  }));
  const terms: Term[] = [
    [
      'Cai',
      'Character',
      'Friends with Peter and Tialla. Connected to Dagsion exploration and Blaze Arts.',
    ],
    ['Peter', 'Character', 'One of Cai’s friends; linked conversations and support footage.'],
    ['Tialla', 'Character', 'One of Cai’s friends; linked conversations and support footage.'],
    ['Castor', 'Character', 'Character reference for the conversation clips.'],
    ['Centurio', 'Character', 'Appears with Cai and Castor in the conversation footage.'],
    ['Bertrand', 'Character', 'Character reference for the first-impressions footage.'],
    ['Leda', 'Character', 'Links Leda’s route footage to shared mechanics and story themes.'],
    ['Dagsion', 'Location', 'Town exploration and related character footage.'],
    [
      'Blaze Arts',
      'Mechanic',
      'Shared mechanic connecting Cai and Leda’s route footage. Linked clips identify the actual performer.',
    ],
    ['Tutoring', 'Mechanic', 'Footage discussing tutoring and development.'],
    ['First impressions', 'Story', 'Early character observations collected for the review.'],
  ].map(([name, kind, definition]) => ({
    id: name,
    name,
    kind,
    definition,
    aliases: name === 'Dagsion' ? 'Dagison' : name === 'Blaze Arts' ? 'Blaze Art' : '',
    pronunciation: '',
    group: conceptGroup(name, kind),
    image: termImage(name),
  }));
  const markers: Model['markers'] = Object.fromEntries(
    demoRecordings.map((r) => [
      r.id,
      r.chapters.map((chapter, i) => ({
        id: r.id + '-chapter-' + i,
        time: chapter.time,
        name: chapter.name,
        category: r.category as Category,
        topic: r.topics[0],
      })),
    ]),
  );
  const sequence: Entry[] = [clips[0], clips[3]].map((c, i) => ({
    id: 'e' + (i + 1),
    cid: c.id,
    rid: c.rid,
    name: c.name,
    start: c.start,
    end: c.end,
  }));
  return {
    recordings,
    clips,
    terms,
    markers,
    markerBaseline: structuredClone(markers),
    uiRevision: 3,
    folders: [...new Set([...folders, ...clips.map((c) => c.folder)])],
    links: [
      ...[
        ['Cai', 'Peter', 'friend'],
        ['Cai', 'Tialla', 'friend'],
        ['Cai', 'Castor', 'conversation'],
        ['Cai', 'Centurio', 'conversation'],
        ['Cai', 'Tutoring', 'mechanic reference'],
        ['Cai', 'Bertrand', 'first impressions'],
        ['Cai', 'Dagsion', 'explores'],
        ['Cai', 'Blaze Arts', 'unlocks'],
        ['Leda', 'Blaze Arts', 'route examples'],
        ['Blaze Arts', 'ref-leda', 'shown in'],
        ['n1', 'c1', 'cites'],
        ['n2', 'c4', 'cites'],
      ].map(([from, to, label]) => ({ from, to, label })),
      ...demoRecordings.flatMap((r, i) =>
        r.topics.map((topic) => ({ from: topic, to: 'c' + (i + 1), label: 'footage' })),
      ),
    ],
    notes: [
      { id: 'n1', title: 'Cai and Peter support · demo note', text: '', url: '' },
      { id: 'n2', title: 'Blaze Arts · demo note', text: '', url: '' },
    ],
    sequence,
    targets: [
      {
        id: 'tl1',
        name: 'Character observations',
        duration: sequence[0].end,
        items: [{ ...sequence[0], id: 'old1' }],
      },
      { id: 'tl2', name: 'Mechanics selects', duration: 0, items: [] },
    ],
  };
}
export const modelKey = 'virtual-cut.workflow-preview.full-resolution.v1';
export function conceptGroup(name: string, kind: string): string {
  if (kind === 'Character') return 'Characters';
  if (kind === 'Location') return 'Locations';
  if (kind === 'Mechanic') return name === 'Blaze Arts' ? 'Mechanics/Combat' : 'Mechanics/Unique';
  return kind === 'Story' ? 'Story' : 'Other';
}
export function termImage(name: string): string {
  const images: Record<string, string> = {
    Cai: '/demo/full-r1-2.jpg',
    Peter: '/demo/full-r1-0.jpg',
    Tialla: '/demo/full-r2-0.jpg',
    Castor: '/demo/full-r6-0.jpg',
    Centurio: '/demo/full-r6-2.jpg',
    Leda: '/demo/leda-blaze.jpg',
    Dagsion: '/demo/full-r5-0.jpg',
    'Blaze Arts': '/demo/full-r4-0.jpg',
  };
  return images[name] || '';
}
export function migrateModel(saved: Model): Model {
  const seed = initialModel();
  const update = (saved.uiRevision || 0) < 3;
  return {
    ...saved,
    uiRevision: 3,
    recordings: saved.recordings.map((r) => {
      const fresh = seed.recordings.find((x) => x.id === r.id);
      return fresh ? { ...r, frames: fresh.frames } : r;
    }),
    clips: saved.clips.map((c) => ({
      ...c,
      originalName: c.originalName ?? seed.recordings.find((r) => r.id === c.rid)?.title ?? c.name,
      originalFolder:
        c.originalFolder ?? seed.clips.find((x) => x.rid === c.rid)?.folder ?? c.folder,
      include: true,
    })),
    markerBaseline: saved.markerBaseline ?? seed.markerBaseline,
    terms: [
      ...saved.terms.map((t) => ({
        ...t,
        group: t.group ?? conceptGroup(t.name, t.kind),
        image: t.image ?? termImage(t.name),
      })),
      ...(update && !saved.terms.some((t) => t.id === 'Centurio')
        ? seed.terms.filter((t) => t.id === 'Centurio')
        : []),
    ],
    links: [
      ...saved.links,
      ...(update
        ? seed.links.filter(
            (l) =>
              ['Centurio', 'Tutoring'].includes(l.to) &&
              !saved.links.some((x) => x.from === l.from && x.to === l.to),
          )
        : []),
    ],
  };
}
export function reviewChanges(model: Model, clip: Clip) {
  const within = (m: Marker) => m.time >= clip.start && m.time < clip.end;
  const before = (model.markerBaseline?.[clip.rid] || []).filter(within);
  const after = (model.markers[clip.rid] || []).filter(within);
  const ids = new Set([...before, ...after].map((m) => m.id));
  const markers = [...ids].filter(
    (id) =>
      JSON.stringify(before.find((m) => m.id === id)) !==
      JSON.stringify(after.find((m) => m.id === id)),
  ).length;
  return {
    name: clip.name !== (clip.originalName ?? clip.name),
    move: clip.folder !== (clip.originalFolder ?? clip.folder),
    markers,
  };
}
export function loadModel(): Model {
  try {
    const m = JSON.parse(localStorage.getItem(modelKey) || 'null');
    if (
      m?.version === 1 &&
      Array.isArray(m.data?.recordings) &&
      Array.isArray(m.data?.terms) &&
      Array.isArray(m.data?.clips)
    )
      return migrateModel(m.data as Model);
  } catch {
    /* Use the sample if saved preview data is unavailable. */
  }
  return initialModel();
}
export function storedModel(model: Model): string {
  const ids = new Set(model.recordings.filter((r) => r.sample).map((r) => r.id));
  return JSON.stringify({
    version: 1,
    data: {
      ...model,
      recordings: model.recordings
        .filter((r) => r.sample)
        .map((r) => ({ ...r, pinned: undefined })),
      clips: model.clips.filter((c) => ids.has(c.rid)),
      markers: Object.fromEntries(Object.entries(model.markers).filter(([id]) => ids.has(id))),
      sequence: model.sequence.filter((e) => ids.has(e.rid)),
      targets: model.targets.map((t) => ({ ...t, items: t.items.filter((e) => ids.has(e.rid)) })),
    },
  });
}
export function invalidate(c: Clip): Clip {
  return { ...c, accepted: false, filed: false };
}
