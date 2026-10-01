import { useEffect, useState } from 'react';
import type { DestinationPlan, DestinationFolders } from '../../electron/review-plan';
import { nameProblem } from '../../electron/review-plan';
import type { Model } from './model';
import { Button, Field, Modal } from './ui';
import s from './Workflow.module.css';

export function DestinationPicker({
  projectId,
  model,
  clips,
  onClose,
  onApply,
}: {
  projectId: string;
  model: Model;
  clips: string[];
  onClose: () => void;
  onApply: (folder: string) => void;
}) {
  const [folder, setFolder] = useState(model.clips.find((c) => c.id === clips[0])?.folder || '');
  const [listing, setListing] = useState<DestinationFolders | null>(null);
  const [error, setError] = useState('');
  const [child, setChild] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    let alive = true;
    setListing(null);
    setError('');
    void window
      .virtualCut!.project.destinationFolders(projectId, folder)
      .then((r) => {
        if (alive) setListing(r);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [projectId, folder]);
  const children = [
    ...new Set([
      ...(listing?.children || []),
      ...model.folders
        .filter((p) => p.startsWith(folder ? folder + '/' : '') && p !== folder)
        .map(
          (p) =>
            (folder ? folder + '/' : '') + p.slice(folder ? folder.length + 1 : 0).split('/')[0],
        ),
    ]),
  ].sort();
  const problem = child ? nameProblem(child) : undefined;
  const target = folder + (child ? (folder ? '/' : '') + child : '');
  return (
    <Modal
      title={`Destination for ${clips.length} clip${clips.length === 1 ? '' : 's'}`}
      onClose={onClose}
    >
      <p className={s.muted}>
        Choose within the project destination. New folders stay planned until filing.
      </p>
      <div className={s.toolbar}>
        <Button
          onClick={() => {
            setFolder('');
            setChild('');
          }}
        >
          Destination root
        </Button>
        <Button
          disabled={!folder}
          onClick={() => {
            setFolder(folder.split('/').slice(0, -1).join('/'));
            setChild('');
          }}
        >
          Up one folder
        </Button>
      </div>
      <Field label="Find a child folder">
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </Field>
      <div className={s.folderList} aria-label="Destination folders">
        {children
          .filter((p) => p.toLowerCase().includes(query.toLowerCase()))
          .map((p) => (
            <Button
              key={p}
              onClick={() => {
                setFolder(p);
                setChild('');
              }}
            >
              {p.split('/').at(-1)}
              {!listing?.children.includes(p) && ' · planned'}
            </Button>
          ))}
        {listing && !children.length && <span className={s.muted}>No child folders</span>}
      </div>
      <Field label="New child folder (optional)">
        <input value={child} onChange={(e) => setChild(e.target.value)} />
      </Field>
      <p style={{ overflowWrap: 'anywhere' }}>
        {listing?.root}
        {target ? '\\' + target.replaceAll('/', '\\') : ''}
      </p>
      {(error || problem) && (
        <p role="alert" className={s.error}>
          {error || problem}
        </p>
      )}
      <Button primary disabled={!listing || !!error || !!problem} onClick={() => onApply(target)}>
        Assign folder
      </Button>
    </Modal>
  );
}

export function DestinationPlanPanel({
  plan,
  model,
  error,
  checking,
  onRefresh,
  onEdit,
  onClose,
}: {
  plan: DestinationPlan | null;
  model: Model;
  error: string;
  checking: boolean;
  onRefresh: () => void;
  onEdit: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Destination plan" onClose={onClose}>
      <p>
        Check proposed filenames and folders before accepting. This check creates no folders and
        moves no files. Targets will be checked again when filing is implemented.
      </p>
      <Button disabled={checking} onClick={onRefresh}>
        {checking ? 'Checking…' : 'Check again'}
      </Button>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {plan && (
        <div className={s.saveTableWrap}>
          <table className={s.saveTable} aria-label="Destination plan">
            <thead>
              <tr>
                <th>Clip / intended file</th>
                <th>Result</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {plan.rows.map((row) => (
                <tr key={row.clipId}>
                  <td>
                    <strong>{model.clips.find((c) => c.id === row.clipId)?.name}</strong>
                    <small style={{ display: 'block', overflowWrap: 'anywhere' }}>
                      {row.path || 'No valid filename'}
                    </small>
                  </td>
                  <td>
                    {row.issues.length
                      ? row.issues.map((issue) => (
                          <p key={issue} className={s.error}>
                            {issue}
                          </p>
                        ))
                      : 'Ready to review'}
                  </td>
                  <td>
                    <Button onClick={() => onEdit(row.clipId)}>Review clip</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={s.muted}>
        Uses the source container by default. Duplicate targets are checked across all project
        batches, including held clips. Existing files are never overwritten.
      </p>
    </Modal>
  );
}
