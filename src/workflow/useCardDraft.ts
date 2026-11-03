import { useEffect, useRef, useState } from 'react';

/**
 * A proposal card's unsaved edits with their own undo (VC-155): the edits are not project changes
 * until the proposal is accepted, so the editor's Undo can't reach them. Typing into one field is
 * one step; each nudge or other change is another.
 */
export function useCardDraft<T extends object>() {
  const [draft, set] = useState<T>({} as T);
  const history = useRef<T[]>([]);
  const lastKey = useRef<string>('');
  const setDraft = (next: T) => {
    const changed = Object.keys(next).filter((k) => next[k as keyof T] !== draft[k as keyof T]);
    const key = changed.length === 1 ? changed[0] : '';
    const typing =
      key !== '' && key === lastKey.current && typeof next[key as keyof T] === 'string';
    if (!typing) history.current.push(draft);
    lastKey.current = key;
    set(next);
  };
  const undo = () => {
    const previous = history.current.pop();
    lastKey.current = '';
    if (previous) set(previous);
    return !!previous;
  };
  const reset = () => {
    history.current = [];
    lastKey.current = '';
    set({} as T);
  };
  return { draft, setDraft, undo, reset };
}

/** A proposal preview dropped on the main timeline (VC-184): the card and its new times. */
export interface CardAdjust {
  card: string;
  at: { start: number; end?: number };
}

/**
 * Hands this card a drop on its timeline preview once, as a nudge would set its times. A card
 * mounted after the drop ignores it.
 */
export function useCardAdjust(
  id: string,
  adjust: CardAdjust | undefined,
  apply: (at: CardAdjust['at']) => void,
) {
  const seen = useRef(adjust);
  useEffect(() => {
    if (!adjust || adjust === seen.current) return;
    seen.current = adjust;
    if (adjust.card === id) apply(adjust.at);
  });
}
