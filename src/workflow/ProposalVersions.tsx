import type { ReactNode } from 'react';
import type { AgentProposal, ProposalValues } from '../../electron/proposal-contracts';
import { formatTimecode } from './transcriptTime';
import { changeChip, ColorSwatch, fieldLabel, SectionHead } from './ProposalParts';
import s from './TranscriptWindow.module.css';

/**
 * An amended proposal's history (VC-204): what the newest amend changed, as a before-and-after
 * table, and every version newest first with its changes as chips and the agent's reason.
 */
const same = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) < 0.0005
    : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** How long ago, for the Amended line and the Versions list. */
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  if (s < 90) return '1 min ago';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 5400) return '1 h ago';
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** The current proposal as a version. */
export const currentValues = (p: AgentProposal): ProposalValues => ({
  time: p.time,
  end: p.end,
  title: p.title,
  text: p.text,
  names: p.names,
  color: p.color,
  clipColor: p.clipColor,
  edit: p.edit,
  reason: p.reason,
});

interface Row {
  key: string;
  label: string;
  from: unknown;
  to: unknown;
  chip: ReactNode;
  value: (v: unknown) => ReactNode;
}
const timeValue = (v: unknown) =>
  v == null ? (
    <span className={s.pcSame}>none</span>
  ) : (
    <span className={s.pcTableMono}>{formatTimecode(v as number)}</span>
  );
const textValue = (v: unknown) => (v ? String(v) : <span className={s.pcSame}>(empty)</span>);

/** What differs between two versions of one proposal, field by field. */
function diff(p: AgentProposal, a: ProposalValues, b: ProposalValues): Row[] {
  if (p.kind === 'edit' && a.edit && b.edit) {
    const target = b.edit.target;
    const from = { ...a.edit.seen, ...a.edit.set },
      to = { ...b.edit.seen, ...b.edit.set };
    return (['name', 'time', 'end', 'color', 'note'] as const)
      .filter((f) => (f in a.edit!.set || f in b.edit!.set) && !same(from[f], to[f]))
      .map((f) => ({
        key: f,
        label: fieldLabel(target, f),
        from: from[f],
        to: to[f],
        chip: changeChip(target, f, from[f], to[f]),
        value: (v) =>
          f === 'color' ? (
            <ColorSwatch kind={target === 'clip' ? 'clip' : 'marker'} color={v as string | null} />
          ) : f === 'time' || f === 'end' ? (
            timeValue(v)
          ) : (
            textValue(v)
          ),
      }));
  }
  const clip = p.kind === 'clip';
  const rows: Row[] = [];
  const add = (key: string, label: string, from: unknown, to: unknown, row: Partial<Row>) => {
    if (!same(from, to)) rows.push({ key, label, from, to, chip: label, value: textValue, ...row });
  };
  add('title', 'Name', a.title, b.title, {});
  add('time', clip ? 'Start' : 'Time', a.time, b.time, {
    chip: `${clip ? 'Start' : 'Time'} ${signed(b.time - a.time)}`,
    value: timeValue,
  });
  add('end', 'End', a.end, b.end, {
    chip:
      a.end == null
        ? `End added at ${formatTimecode(b.end!)}`
        : b.end == null
          ? 'End removed'
          : `End ${signed(b.end - a.end)}`,
    value: timeValue,
  });
  add('clipColor', 'Clip color', a.clipColor, b.clipColor, {
    chip: changeChip(
      'clip',
      'color',
      a.clipColor ?? null,
      b.clipColor ?? null,
      'clip',
      'Clip color',
    ),
    value: (v) => <ColorSwatch kind="clip" color={v as string | null} />,
  });
  add('color', clip ? 'Marker color' : 'Color', a.color ?? 'Blue', b.color ?? 'Blue', {
    chip: changeChip(
      'marker',
      'color',
      a.color ?? 'Blue',
      b.color ?? 'Blue',
      'marker',
      clip ? 'Marker color' : 'Color',
    ),
    value: (v) => <ColorSwatch kind="marker" color={v as string} />,
  });
  add('text', 'Note', a.text, b.text, {});
  add(
    'names',
    'Clip names',
    a.names && `${a.names.first} | ${a.names.second}`,
    b.names && `${b.names.first} | ${b.names.second}`,
    {},
  );
  return rows;
}
const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(1)} s`;

/** The newest amend's changes as chips, for line 3 of a closed card. */
export function amendChips(p: AgentProposal): ReactNode[] {
  const versions = p.versions ?? [];
  if (!versions.length) return [];
  return diff(p, versions.at(-1)!.values, currentValues(p)).map((r) => r.chip);
}

export function ProposalVersions({ proposal: p }: { proposal: AgentProposal }) {
  const versions = p.versions ?? [];
  if (!versions.length) return null;
  const n = versions.length + 1;
  const previous = versions.at(-1)!.values;
  const rows = diff(p, previous, currentValues(p));
  const all = [
    ...versions.map((v) => ({ at: v.at, reason: v.reason, values: v.values })),
    { at: p.amended?.at ?? p.submitted, reason: p.amended?.reason, values: currentValues(p) },
  ];
  // Fields the newest amend left alone, named once.
  const unchanged =
    p.kind === 'edit'
      ? []
      : ['name', 'time', 'note'].filter(
          (k) => !rows.some((r) => r.key === (k === 'name' ? 'title' : k === 'note' ? 'text' : k)),
        );
  return (
    <>
      {p.kind !== 'edit' && (
        <>
          <SectionHead tone="amended">Changes</SectionHead>
          <div className={s.pcTable} data-tone="amended" role="table" aria-label={`Amend ${p.id}`}>
            <div className={s.pcTableHead} role="columnheader" />
            <div className={s.pcTableHead} role="columnheader">
              Before · v{n - 1}
            </div>
            <div className={s.pcTableHead} role="columnheader">
              After · v{n}
            </div>
            {rows.flatMap((r) => [
              <div key={`${r.key}:f`} className={s.pcTableField}>
                {r.label}
              </div>,
              <div key={`${r.key}:b`} className={s.pcTableBefore}>
                {r.value(r.from)}
              </div>,
              <div key={`${r.key}:a`} className={s.pcTableAfter} data-changed="true">
                {r.value(r.to)}
              </div>,
            ])}
          </div>
          {unchanged.length > 0 && (
            <p className={s.pcSame}>Stays the same: {unchanged.join(', ')}</p>
          )}
        </>
      )}
      <SectionHead tone="amended">Versions</SectionHead>
      <div className={s.pcVersions} data-proposal-versions={p.id}>
        {all
          .map((v, i) => ({ ...v, number: i + 1, older: all[i - 1] }))
          .reverse()
          .map((v) => (
            <div key={v.number} className={s.pcVersion} data-version={v.number}>
              <b>v{v.number}</b>
              {v.older ? (
                <span>
                  <span className={s.pcChips} data-tone="amended">
                    {diff(p, v.older.values, v.values).map((r) => (
                      <span key={r.key} className={s.pcChangeChip}>
                        {r.chip}
                      </span>
                    ))}
                  </span>
                </span>
              ) : (
                <span>
                  Submitted: “{v.values.title}” at {formatTimecode(v.values.time)}
                  {v.values.end != null ? ` – ${formatTimecode(v.values.end)}` : ''}
                </span>
              )}
              <span className={s.pcVersionWhen}>{ago(v.at)}</span>
              {v.reason && <span className={s.pcVersionWhy}>Agent: “{v.reason}”</span>}
            </div>
          ))}
      </div>
    </>
  );
}
