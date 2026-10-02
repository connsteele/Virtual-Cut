import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ProjectStorageUsage } from '../../electron/project-contracts';
import { Button } from './ui';
import s from './Workflow.module.css';

export function storageSize(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = bytes > 0 ? Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 2 : 0 })} ${units[unit]}`;
}

export function ProjectStorage({ id }: { id: string }) {
  const [usage, setUsage] = useState<ProjectStorageUsage>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    window.virtualCut!.project.storageUsage(id).then(
      (value) => {
        if (active) {
          setUsage(value);
          setError('');
          setBusy(false);
        }
      },
      (e) => {
        if (active) {
          setError(e instanceof Error ? e.message : String(e));
          setBusy(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [id, refresh]);
  const generated = usage?.rows.filter((row) => row.id !== 'sources') ?? [];
  const source = usage?.rows.find((row) => row.id === 'sources');
  const unavailable = usage?.rows.reduce((sum, row) => sum + row.unavailable, 0) ?? 0;
  return (
    <section className={s.projectStorage} aria-label="Project storage" aria-busy={busy}>
      <div className={s.tools}>
        <h4>Storage</h4>
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setRefresh((n) => n + 1);
          }}
        >
          <RefreshCw size={14} /> Refresh storage
        </Button>
      </div>
      {busy && <p role="status">Measuring file sizes…</p>}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {usage && (
        <>
          <dl className={s.storageRows}>
            {generated.map((row) => (
              <div key={row.id}>
                <dt>
                  {row.label} <span className={s.muted}>({row.files})</span>
                  {!!row.unavailable && <small> · {row.unavailable} unavailable</small>}
                </dt>
                <dd>{storageSize(row.bytes)}</dd>
              </div>
            ))}
            <div className={s.storageTotal}>
              <dt>Total measured, excluding source footage</dt>
              <dd>{storageSize(generated.reduce((sum, row) => sum + row.bytes, 0))}</dd>
            </div>
            {source && (
              <div>
                <dt>
                  {source.label} <span className={s.muted}>({source.files})</span>
                  {!!source.unavailable && <small> · {source.unavailable} unavailable</small>}
                </dt>
                <dd>{storageSize(source.bytes)}</dd>
              </div>
            )}
          </dl>
          <p className={s.muted}>
            Measured {new Date(usage.measuredAt).toLocaleTimeString()}. File sizes use 1,024-byte
            units. Shared files count once. The cache and save folders may include retained or
            shared files; these totals are not a cleanup estimate. Finished videos and companions
            are always kept.
          </p>
          <p className={s.muted}>
            Filmstrips live in memory. Older thumbnail files can still occupy cache space. Only
            recorded source/output paths and files directly in the save/cache folders are measured.
          </p>
          {!!unavailable && (
            <p role="status">
              {unavailable} files could not be measured. Totals exclude them; reconnect unavailable
              drives and refresh.
            </p>
          )}
          {!!usage.issues.length && (
            <details>
              <summary>Unmeasured locations ({usage.issues.length})</summary>
              <ul className={s.deletionFiles}>
                {usage.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

export function CleanupFiles({
  items,
}: {
  items: { path: string; group: string; detail: string }[];
}) {
  const groups = new Map<string, typeof items>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  return (
    <div className={s.cleanupGroups}>
      {Array.from(groups, ([group, files]) =>
        files.length > 1 ? (
          <details key={group}>
            <summary>
              {group} ({files.length})
            </summary>
            <ul className={s.deletionFiles}>
              {files.map((f) => (
                <li key={f.path}>
                  {f.path}
                  <small>{f.detail}</small>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <div key={group} className={s.cleanupSingle}>
            <strong>{group}</strong>
            <span>{files[0].path}</span>
            <small>{files[0].detail}</small>
          </div>
        ),
      )}
    </div>
  );
}
