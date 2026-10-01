import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import s from './Workflow.module.css';

const key = 'virtual-cut.review-folder-width';
export function ReviewColumns({ folders, children }: { folders?: ReactNode; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [available, setAvailable] = useState(1000);
  const [preferred, setPreferred] = useState(() => Number(localStorage.getItem(key)) || 260);
  const maximum = Math.max(150, Math.min(520, available - 480));
  const width = Math.max(150, Math.min(maximum, preferred));
  const change = (value: number) => setPreferred(Math.max(150, Math.min(maximum, value)));
  const persist = () => localStorage.setItem(key, String(width));
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(root.current!);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className={s.reviewBody}>
      {folders && (
        <>
          <aside className={`${s.rail} ${s.reviewFolders}`} style={{ flex: `0 0 ${width}px` }}>
            {folders}
          </aside>
          <div
            role="separator"
            aria-label="Resize destination folders"
            aria-orientation="vertical"
            aria-valuemin={150}
            aria-valuemax={maximum}
            aria-valuenow={Math.round(width)}
            tabIndex={0}
            className={s.mediaDivider}
            title="Drag or use Left/Right to resize. Double-click to reset."
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, width };
            }}
            onPointerMove={(e) => {
              if (drag.current) change(drag.current.width + e.clientX - drag.current.x);
            }}
            onPointerUp={(e) => {
              drag.current = null;
              persist();
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              if (drag.current) change(drag.current.width);
              drag.current = null;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onDoubleClick={() => {
              change(260);
              localStorage.setItem(key, '260');
            }}
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
              e.preventDefault();
              e.stopPropagation();
              const value = Math.max(
                150,
                Math.min(
                  maximum,
                  width + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 50 : 20),
                ),
              );
              change(value);
              localStorage.setItem(key, String(value));
            }}
          />
        </>
      )}
      {children}
    </div>
  );
}
