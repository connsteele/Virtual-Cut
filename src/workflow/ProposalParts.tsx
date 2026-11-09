import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Film, MessageSquareText, MoveHorizontal, Pencil, Scissors } from 'lucide-react';
import { clipColors, markerColors } from '../../electron/workflow-types';
import type { EditFields } from '../../electron/proposal-contracts';
import { formatTimecode } from './transcriptTime';
import s from './TranscriptWindow.module.css';

/**
 * Small parts of the proposal cards (VC-204): the kind icons, color swatches and picker, the
 * change chips and the centered section headers.
 */
export type CardIconKind = 'marker' | 'range' | 'clip' | 'split' | 'note' | 'notion';
const iconNames: Record<CardIconKind, string> = {
  marker: 'Marker',
  range: 'Range marker',
  clip: 'Clip range',
  split: 'Split',
  note: 'Timed note',
  notion: 'Notion note',
};
const iconProps = { size: 15, strokeWidth: 2, 'aria-hidden': true } as const;
/** The marker diamond, drawn like the markers on the timeline. */
function Diamond() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden="true">
      <path d="M12 4.5 19.5 12 12 19.5 4.5 12Z" fill="currentColor" />
    </svg>
  );
}
/** Notion notes: an N in a rounded square, in the lucide line style. */
function NotionN() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M9 16.5V7.5l6 9V7.5" />
    </svg>
  );
}
/** A card's kind icon; a change card adds a small pencil to its corner. */
export function KindIcon({ kind, change = false }: { kind: CardIconKind; change?: boolean }) {
  const glyph =
    kind === 'marker' ? (
      <Diamond />
    ) : kind === 'range' ? (
      <MoveHorizontal {...iconProps} />
    ) : kind === 'clip' ? (
      <Film {...iconProps} />
    ) : kind === 'split' ? (
      <Scissors {...iconProps} />
    ) : kind === 'note' ? (
      <MessageSquareText {...iconProps} />
    ) : (
      <NotionN />
    );
  return (
    <span
      className={`${s.pcIcon}${change ? ` ${s.pcIconChange}` : ''}`}
      data-card-icon={kind}
      title={change ? `Change to a ${iconNames[kind].toLowerCase()}` : iconNames[kind]}
    >
      {glyph}
      {change && (
        <span className={s.pcIconBadge}>
          <Pencil size={9} strokeWidth={2.5} aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

export type SwatchKind = 'marker' | 'clip';
/** A color with its name: a diamond for marker colors, a square for Resolve clip colors. */
export function ColorSwatch({
  kind,
  color,
  none = 'No clip color',
  title,
  suffix,
}: {
  kind: SwatchKind;
  color: string | null | undefined;
  none?: string;
  title?: string;
  suffix?: string;
}) {
  const hex = color
    ? kind === 'clip'
      ? clipColors[color as keyof typeof clipColors]
      : markerColors[color as keyof typeof markerColors]
    : undefined;
  return (
    <span
      className={s.pcColor}
      data-proposal-color={color ?? 'none'}
      data-color-kind={kind}
      title={title}
    >
      <span
        className={`${kind === 'clip' ? s.pcClipDot : s.pcColorDot}${hex ? '' : ` ${s.pcNoColor}`}`}
        style={hex ? { background: hex } : undefined}
      />
      {color ?? none}
      {suffix}
    </span>
  );
}
/** A color change, old → new, both with swatches. */
export function ColorChange({
  kind,
  from,
  to,
}: {
  kind: SwatchKind;
  from: string | null | undefined;
  to: string | null | undefined;
}) {
  return (
    <span className={s.pcColorChange}>
      <ColorSwatch kind={kind} color={from} none="None" />
      <span className={s.pcArrow}>→</span>
      <ColorSwatch kind={kind} color={to} none="None" />
    </span>
  );
}

/**
 * A color picker with the swatch before every name (VC-204): marker colors as diamonds, clip
 * colors as squares with "No clip color" first. Arrow keys move, a letter jumps to the next color
 * starting with it, Enter picks and Esc closes.
 */
export function ColorPicker({
  kind,
  value,
  onChange,
  label,
  title,
}: {
  kind: SwatchKind;
  value: string | null;
  onChange: (color: string | null) => void;
  label: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [toLeft, setToLeft] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const options: (string | null)[] =
    kind === 'clip' ? [null, ...Object.keys(clipColors)] : Object.keys(markerColors);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !list.current) return;
    // Open toward the side with room, so the list never runs off the window.
    const r = list.current.getBoundingClientRect();
    if (r.right > document.documentElement.clientWidth - 8) setToLeft(true);
    const current = list.current.querySelector<HTMLElement>('[aria-selected="true"]');
    (current ?? list.current.querySelector<HTMLElement>('[role="option"]'))?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    setToLeft(false);
    root.current?.querySelector<HTMLElement>('button')?.focus();
  };
  const pick = (color: string | null) => {
    onChange(color);
    close();
  };
  const keys = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (!open) {
      // Letters never reach the card (A accepts, R rejects there); Esc still leaves editing.
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        setOpen(true);
        e.preventDefault();
        e.stopPropagation();
      } else if (/^[a-z]$/i.test(e.key)) e.stopPropagation();
      return;
    }
    e.stopPropagation();
    const opts = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = opts.indexOf(document.activeElement as HTMLElement);
    const move = { ArrowDown: 2, ArrowUp: -2, ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (move) opts[Math.max(0, Math.min(opts.length - 1, at + move))]?.focus();
    else if (e.key === 'Home') opts[0]?.focus();
    else if (e.key === 'End') opts.at(-1)?.focus();
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') {
      setOpen(false);
      return;
    } else if (/^[a-z]$/i.test(e.key) && !e.ctrlKey && !e.metaKey) {
      const k = e.key.toLowerCase();
      for (let i = 1; i <= opts.length; i++) {
        const o = opts[(at + i) % opts.length];
        if ((o.dataset.color || 'none').toLowerCase().startsWith(k)) {
          o.focus();
          break;
        }
      }
    } else return;
    e.preventDefault();
  };
  return (
    <span ref={root} className={s.cpk} onKeyDown={keys}>
      <button
        type="button"
        className={s.cpkButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${value ?? 'none'}`}
        title={title}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <ColorSwatch kind={kind} color={value} />
        <span className={s.cpkCaret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={list}
          className={`${s.cpkList}${toLeft ? ` ${s.cpkLeft}` : ''}`}
          role="listbox"
          aria-label={label}
        >
          {options.map((color) => (
            <button
              key={color ?? 'none'}
              type="button"
              role="option"
              tabIndex={-1}
              data-color={color ?? ''}
              aria-selected={color === value}
              className={s.cpkOption}
              onClick={() => pick(color)}
            >
              <ColorSwatch kind={kind} color={color} />
              {color === value && <span className={s.cpkCheck}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export type ChipTone = 'changes' | 'amended' | 'kept';
/** One line of change chips: "Changes", "Amended 1 min ago" or "Kept", then a chip per field. */
export function Chips({
  tone,
  label,
  chips,
  after,
}: {
  tone: ChipTone;
  label: ReactNode;
  chips: ReactNode[];
  after?: ReactNode;
}) {
  return (
    <span className={s.pcChips} data-tone={tone} data-proposal-chips={tone}>
      <span className={s.pcChipsLabel}>{label}</span>
      {chips.map((c, i) => (
        <span key={i} className={s.pcChangeChip}>
          {c}
        </span>
      ))}
      {after}
    </span>
  );
}
/** A centered header on the card's separator line, over the table or list below it. */
export function SectionHead({ children, tone }: { children: ReactNode; tone?: 'amended' }) {
  return (
    <div className={s.pcSecHead} data-tone={tone}>
      {children}
    </div>
  );
}

type Field = keyof EditFields;
/** A field's name, the same on its chip and its table row. */
export function fieldLabel(target: 'marker' | 'clip', f: Field) {
  if (f === 'time') return target === 'clip' ? 'Start' : 'Time';
  if (f === 'color') return target === 'clip' ? 'Clip color' : 'Color';
  return { name: 'Name', end: 'End', note: 'Note' }[f];
}
const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(1)} s`;
/** One chip for a field that changes from `from` to `to` (VC-204). */
export function changeChip(
  target: 'marker' | 'clip',
  f: Field,
  from: EditFields[Field],
  to: EditFields[Field],
  swatch: SwatchKind = target === 'clip' ? 'clip' : 'marker',
  label = fieldLabel(target, f),
): ReactNode {
  if (f === 'color')
    return (
      <>
        {label} <ColorChange kind={swatch} from={from as string | null} to={to as string | null} />
      </>
    );
  if (f === 'end' && from == null) return `End added at ${formatTimecode(to as number)}`;
  if (f === 'end' && to == null) return 'End removed';
  if ((f === 'time' || f === 'end') && typeof from === 'number' && typeof to === 'number')
    return `${label} ${signed(to - from)}`;
  return label;
}
