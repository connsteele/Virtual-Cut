import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Dialog } from '../components/Dialog';
import s from './Workflow.module.css';
export function Button({
  children,
  primary = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      {...props}
      title={props.title ?? props['aria-label']}
      className={[s.button, primary ? s.primary : '', props.className || ''].join(' ')}
    >
      {children}
    </button>
  );
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={s.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog title={title} eyebrow="VIRTUAL CUT" onClose={onClose} className={s.modal}>
      {children}
    </Dialog>
  );
}
export function Thumbnail({ src, alt }: { src: string; alt: string }) {
  return src ? (
    <img
      draggable={false}
      className={s.thumb}
      src={src}
      alt={alt}
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden';
      }}
    />
  ) : (
    <span className={s.noThumb}>Video</span>
  );
}
