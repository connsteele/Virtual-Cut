import styles from '../App.module.css';
import { classNames } from '../classNames';
import { ArrowUpRight, Check } from 'lucide-react';
import { layouts, type LayoutId } from '../workspace';
import { Dialog } from './Dialog';

export function LayoutPicker({
  selected,
  onSelect,
  onClose,
}: {
  selected: LayoutId;
  onSelect: (layout: LayoutId) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="Find your working space."
      eyebrow="THREE DIRECTIONS, ONE WORKSPACE"
      onClose={onClose}
    >
      <p className={styles['dialog-description']}>
        Try a different arrangement. Your project and page stay with you.
      </p>
      <div className={styles['layout-options']} role="group" aria-label="Workspace layout">
        {layouts.map((layout) => (
          <button
            key={layout.id}
            className={classNames(
              styles['layout-option'],
              selected === layout.id && styles.selected,
            )}
            aria-pressed={selected === layout.id}
            aria-label={`${layout.name} layout`}
            onClick={() => {
              onSelect(layout.id);
              onClose();
            }}
          >
            <div
              className={classNames(
                styles['layout-diagram'],
                layout.id !== 'studio' && styles[`diagram-${layout.id}`],
              )}
              aria-hidden="true"
            >
              <span className={styles['diagram-top']} />
              <span className={styles['diagram-sources']} />
              <span className={styles['diagram-viewer']}>
                <span />
              </span>
              <span className={styles['diagram-context']} />
              <span className={styles['diagram-timeline']} />
              <span className={styles['diagram-bottom']}>
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
            </div>
            <p className={styles['eyebrow']}>{layout.eyebrow}</p>
            <div className={styles['layout-option-title']}>
              <h3>{layout.name}</h3>
              {selected === layout.id ? <Check size={18} /> : <ArrowUpRight size={17} />}
            </div>
            <p>{layout.description}</p>
            <span className={styles['layout-tradeoff']}>{layout.tradeoff}</span>
          </button>
        ))}
      </div>
      <p className={styles['dialog-footnote']}>
        Studio is the starting layout. These concepts share the same page navigation and tools.
      </p>
    </Dialog>
  );
}
