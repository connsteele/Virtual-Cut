import { Clapperboard, Film, FolderOpen, GalleryVerticalEnd, ListVideo, Send } from 'lucide-react';

export type PageId = 'media' | 'cut' | 'review' | 'library' | 'selects' | 'handoff';
export type LayoutId = 'studio' | 'library' | 'focus';

export const pages = [
  {
    id: 'media',
    label: 'Media',
    icon: FolderOpen,
    phase: 'Bring footage into your project',
    future: 'Source folders, recording details, and audio-track roles will live here.',
  },
  {
    id: 'cut',
    label: 'Cut',
    icon: Clapperboard,
    phase: 'Your next cut starts here',
    future:
      'A space for selecting ranges, placing markers, and keeping your intent alongside the footage.',
  },
  {
    id: 'review',
    label: 'Review',
    icon: Film,
    phase: 'A place to review every detail',
    future:
      'Your clips, notes, names, and suggested folders will come together for a final human review.',
  },
  {
    id: 'library',
    label: 'Library',
    icon: GalleryVerticalEnd,
    phase: 'Build a library you can return to',
    future: 'Approved footage will stay connected to its markers, notes, and original context.',
  },
  {
    id: 'selects',
    label: 'Selects',
    icon: ListVideo,
    phase: 'Start with the moments that matter',
    future: 'Later, collect clip ranges into ordered selects and string-outs for Resolve.',
  },
  {
    id: 'handoff',
    label: 'Handoff',
    icon: Send,
    phase: 'Continue in Resolve',
    future: 'Transfer finished videos and their marker metadata.',
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
