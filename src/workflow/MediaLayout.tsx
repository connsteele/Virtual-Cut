import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import s from './Workflow.module.css';

const key = 'virtual-cut.media-panels';
const defaults = { folders: 175, browser: 430 };
type Widths = typeof defaults;
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
function fit(value: Widths, width: number): Widths {
  const folders = Math.max(145, Math.min(value.folders, 520, width - 180 - 320 - 12));
  const browser = Math.max(180, Math.min(value.browser, 900, width - folders - 320 - 12));
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
  const drag = useRef<{ x: number; before: Widths; part: keyof Widths } | null>(null);
  const sizes = fit(preferred, width);
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
          setPreferred(fit({ ...d.before, [part]: d.before[part] + e.clientX - d.x }, width));
      }}
      onPointerUp={() => {
        if (drag.current) persist(sizes);
        drag.current = null;
      }}
      onPointerCancel={() => {
        if (drag.current) setPreferred(drag.current.before);
        drag.current = null;
      }}
      onDoubleClick={() => persist(fit({ ...sizes, [part]: defaults[part] }, width))}
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
        gridTemplateColumns: `${sizes.folders}px 6px ${sizes.browser}px 6px minmax(0, 1fr)`,
      }}
    >
      <aside className={s.rail}>{folders}</aside>
      {separator('folders', 'Resize source folders')}
      <div className={s.mediaBrowser}>{browser}</div>
      {separator('browser', 'Resize media browser')}
      <div className={s.mediaPreview}>{children}</div>
    </div>
  );
}
