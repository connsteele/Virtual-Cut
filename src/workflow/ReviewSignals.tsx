import { reviewChanges, time, type Clip, type Model } from './model';
import { Button } from './ui';
import s from './Workflow.module.css';

export function ReviewSignals({
  model,
  clip,
  onInspect,
  onFolder,
}: {
  model: Model;
  clip: Clip;
  onInspect: (field: string) => void;
  onFolder: () => void;
}) {
  const changes = reviewChanges(model, clip);
  return (
    <div className={s.reviewSignals} aria-label="Review checklist">
      {changes.trim && (
        <Button
          title={`Trimmed source: ${time(clip.start)} → ${time(clip.end)}`}
          onClick={() => onInspect('')}
        >
          Trim
        </Button>
      )}
      {changes.name && (
        <Button title={`Original: ${clip.originalName}`} onClick={() => onInspect('name')}>
          Name
        </Button>
      )}
      {changes.move && (
        <Button title={`From: ${clip.originalFolder}`} onClick={onFolder}>
          Move
        </Button>
      )}
      {changes.markers > 0 && (
        <Button onClick={() => onInspect('markers')}>Markers · {changes.markers}</Button>
      )}
      {clip.note && <Button onClick={() => onInspect('note')}>Note</Button>}
      {!changes.trim && !changes.name && !changes.move && !changes.markers && !clip.note && (
        <span className={s.muted}>No proposed changes</span>
      )}
      {clip.filed ? (
        <span className={s.badge}>Done</span>
      ) : clip.held ? (
        <span className={s.holdBadge}>Held</span>
      ) : clip.accepted ? (
        <span className={s.badge}>Queued</span>
      ) : null}
    </div>
  );
}

export function HoldReason({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={s.holdReason}>
      <span>Held for</span>
      <select
        aria-label="Hold reason"
        value={
          ['Needs context', 'Check markers', 'Choose a folder', 'Check name', 'Other'].includes(
            value,
          )
            ? value
            : 'Other'
        }
        onChange={(e) => onChange(e.target.value)}
      >
        {['Needs context', 'Check markers', 'Choose a folder', 'Check name', 'Other'].map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
      <input
        aria-label="Hold details"
        placeholder="What needs another look?"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
