import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import s from './TranscriptWindow.module.css';

/**
 * A correction typed straight into the transcript line, like Resolve (VC-114 stage 2b):
 * Enter saves, Escape cancels. The original recognition is never replaced; saving the original
 * text again restores it.
 */
export function TranscriptInlineEdit({
  initial,
  phrase,
  disabled,
  onSave,
  onCancel,
}: {
  initial: string;
  phrase: boolean;
  disabled: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial.trim());
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  const props = {
    ref: field,
    value: text,
    disabled,
    maxLength: 10000,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (text.trim()) onSave(text);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    },
  };
  return phrase ? (
    <textarea {...props} className={s.inlinePhrase} aria-label="Correct phrase" rows={2} />
  ) : (
    <input
      {...props}
      className={s.inlineWord}
      aria-label="Correct word"
      // Grows with the text so the line barely moves while typing.
      size={Math.max(4, text.length + 1)}
    />
  );
}
