import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { FolderTree, Images, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from './ui';
import s from './Workflow.module.css';

const key = 'virtual-cut.media-panels';
const defaults = { folders: 220, browser: 520 };
type Widths = typeof defaults;
type Visible = { folders: boolean; browser: boolean };
function readVisibility(): Visible {
  try {
    const value = JSON.parse(localStorage.getItem(key + '.visible') || 'null');
    if (typeof value?.folders === 'boolean' && typeof value?.browser === 'boolean') return value;
    const visible = localStorage.getItem(key + '.collapsed') !== 'true';
    return { folders: visible, browser: visible };
  } catch {
    return { folders: true, browser: true };
  }
}
function read(): Widths {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value && Number.isFinite(value.folders) && Number.isFinite(value.browser)
      ? value
      : defaults;
  } catch {
    return defaults;
  }
}
function fit(value: Widths, width: number, visible: Visible): Widths {
  // Reserve enough viewer width to avoid wrapping transport/audio into so many
  // rows that they consume the video height in a compact window.
  const available = width - 32 - 520 - (visible.folders ? 4 : 0) - (visible.browser ? 4 : 0);
  const folders = visible.folders
    ? Math.max(145, Math.min(value.folders, 520, available - (visible.browser ? 180 : 0)))
    : value.folders;
  const browser = visible.browser
    ? Math.max(180, Math.min(value.browser, 900, available - (visible.folders ? folders : 0)))
    : value.browser;
  return { folders, browser };
}
export function MediaLayout({
  folders,
  browser,
  children,
}: {
  folders: ReactNode;
  browser: ReactNode;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1280);
  const [preferred, setPreferred] = useState(read);
  const [visible, setVisible] = useState(readVisibility);
  const drag = useRef<{ x: number; before: Widths; part: keyof Widths } | null>(null);
  const sizes = fit(preferred, width, visible);
  const changeVisibility = (next: Visible) => {
    setVisible(next);
    localStorage.setItem(key + '.visible', JSON.stringify(next));
  };
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const persist = (next: Widths) => {
    setPreferred(next);
    localStorage.setItem(key, JSON.stringify(next));
  };
  const separator = (part: keyof Widths, label: string) => (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      aria-valuemin={part === 'folders' ? 145 : 180}
      aria-valuemax={part === 'folders' ? 520 : 900}
      aria-valuenow={Math.round(sizes[part])}
      className={s.mediaDivider}
      data-panel={part}
      title={`${label}. Drag or use Left/Right. Double-click to reset.`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, before: sizes, part };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d?.part === part)
          setPreferred(
            fit({ ...d.before, [part]: d.before[part] + e.clientX - d.x }, width, visible),
          );
      }}
      onPointerUp={() => {
        if (drag.current) persist(sizes);
        drag.current = null;
      }}
      onPointerCancel={() => {
        if (drag.current) setPreferred(drag.current.before);
        drag.current = null;
      }}
      onDoubleClick={() => persist(fit({ ...sizes, [part]: defaults[part] }, width, visible))}
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        persist(
          fit(
            {
              ...sizes,
              [part]: sizes[part] + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 50 : 20),
            },
            width,
            visible,
          ),
        );
      }}
    />
  );
  return (
    <div
      ref={root}
      className={s.mediaSplit}
      style={{
        gridTemplateColumns: `32px ${visible.folders ? `${sizes.folders}px 4px ` : ''}${visible.browser ? `${sizes.browser}px 4px ` : ''}minmax(0, 1fr)`,
      }}
    >
      <div className={s.mediaPanelControls} role="group" aria-label="Media panels">
        <Button
          aria-label={visible.folders || visible.browser ? 'Hide both panels' : 'Show both panels'}
          onClick={() =>
            changeVisibility({
              folders: !(visible.folders || visible.browser),
              browser: !(visible.folders || visible.browser),
            })
          }
        >
          {visible.folders || visible.browser ? (
            <PanelLeftClose size={16} />
          ) : (
            <PanelLeftOpen size={16} />
          )}
        </Button>

        <Button
          aria-label={visible.folders ? 'Hide folders' : 'Show folders'}
          aria-expanded={visible.folders}
          aria-controls="source-folders-panel"
          onClick={() => changeVisibility({ ...visible, folders: !visible.folders })}
        >
          <FolderTree size={16} />
        </Button>
        <Button
          aria-label={visible.browser ? 'Hide media pool' : 'Show media pool'}
          aria-expanded={visible.browser}
          aria-controls="media-pool-panel"
          onClick={() => changeVisibility({ ...visible, browser: !visible.browser })}
        >
          <Images size={16} />
        </Button>
      </div>
      {visible.folders && (
        <aside id="source-folders-panel" className={s.rail}>
          <h3>Folders</h3>
          {folders}
        </aside>
      )}
      {visible.folders && separator('folders', 'Resize source folders')}
      {visible.browser && (
        <div id="media-pool-panel" className={s.mediaBrowser}>
          {browser}
        </div>
      )}
      {visible.browser && separator('browser', 'Resize media browser')}
      <div className={s.mediaPreview}>{children}</div>
    </div>
  );
}
