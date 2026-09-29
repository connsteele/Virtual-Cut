import { Clapperboard, Film, FolderOpen, GalleryVerticalEnd, ListVideo } from 'lucide-react';

export type PageId = 'media' | 'cut' | 'review' | 'library' | 'selects';
export type LayoutId = 'studio' | 'library' | 'focus';

export const pages = [
  {
    id: 'media',
    label: 'Media',
    icon: FolderOpen,
    description: 'The starting point for every recording.',
    phase: 'Bring footage into your project',
    future: 'Source folders, recording details, and audio-track roles will live here.',
  },
  {
    id: 'cut',
    label: 'Cut',
    icon: Clapperboard,
    description: 'Find the moment. Keep the context.',
    phase: 'Your next cut starts here',
    future:
      'A space for selecting ranges, placing markers, and keeping your intent alongside the footage.',
  },
  {
    id: 'review',
    label: 'Review',
    icon: Film,
    description: 'Give every clip a second look.',
    phase: 'A place to review every detail',
    future:
      'Your clips, notes, names, and suggested folders will come together for a final human review.',
  },
  {
    id: 'library',
    label: 'Library',
    icon: GalleryVerticalEnd,
    description: 'The right footage, ready when you need it.',
    phase: 'Build a library you can return to',
    future: 'Approved footage will stay connected to its markers, notes, and original context.',
  },
  {
    id: 'selects',
    label: 'Selects',
    icon: ListVideo,
    description: 'Bring your strongest moments together.',
    phase: 'Start with the moments that matter',
    future: 'Later, collect clip ranges into ordered selects and string-outs for Resolve.',
  },
] as const;

export const layouts: {
  id: LayoutId;
  name: string;
  eyebrow: string;
  description: string;
  tradeoff: string;
}[] = [
  {
    id: 'studio',
    name: 'Studio',
    eyebrow: 'CUT & MARK UP',
    description: 'Sources on the left. Footage in the center. Context close at hand.',
    tradeoff: 'A familiar editing workspace with room for a timeline.',
  },
  {
    id: 'library',
    name: 'Library',
    eyebrow: 'BROWSE & REVIEW',
    description: 'Give your footage collection more room, with a preview beside it.',
    tradeoff: 'More space for batches; a smaller viewing area.',
  },
  {
    id: 'focus',
    name: 'Focus',
    eyebrow: 'WATCH & THINK',
    description: 'A generous viewer with side panels tucked away until you need them.',
    tradeoff: 'More room to watch; less batch context on screen.',
  },
];

export interface Preferences {
  layout: LayoutId;
  page: PageId;
}

export const preferenceKey = 'virtual-cut.workspace.v1';

export function readPreferences(): Preferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(preferenceKey) ?? 'null');
    if (saved && typeof saved === 'object') {
      const value = saved as Record<string, unknown>;
      return {
        layout: layouts.some((layout) => layout.id === value.layout)
          ? (value.layout as LayoutId)
          : 'studio',
        page: pages.some((page) => page.id === value.page) ? (value.page as PageId) : 'cut',
      };
    }
  } catch {
    /* A damaged or unavailable preference store must not prevent startup. */
  }
  return { layout: 'studio', page: 'cut' };
}
