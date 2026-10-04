import { useEffect, useState } from 'react';
import type { DiagnosticSummary } from '../../electron/diagnostic-contracts';
import { Button, Modal } from './ui';
import s from './Workflow.module.css';
import { background } from './background';
export function DiagnosticsPanel({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<DiagnosticSummary | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    void window
      .virtualCut!.diagnostics.summary()
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch(() => {
        if (alive) setMessage('Diagnostics are unavailable.');
      });
    return () => {
      alive = false;
    };
  }, []);
  async function act(kind: 'copy' | 'openLogs' | 'export') {
    try {
      const result = await window.virtualCut!.diagnostics[kind]();
      setMessage(
        kind === 'copy'
          ? 'Diagnostics copied.'
          : kind === 'export'
            ? result
              ? 'Diagnostic report saved.'
              : ''
            : 'Logs opened.',
      );
    } catch {
      setMessage(
        'Could not complete that action. Check the folder is writable and choose a new filename.',
      );
    }
  }
  return (
    <Modal title="Diagnostics" onClose={onClose}>
      <p>
        Recent activity and failures stay on this computer. Text logs exclude personal paths, media,
        notes and transcripts. Nothing is uploaded.
      </p>
      <p className={s.muted}>
        Up to five 1 MB log files are kept. Playback logs state changes, not every frame or seek.
      </p>
      <p className={s.muted}>
        Native crash reports stay in the crashes subfolder and may contain memory data. They are
        never uploaded or included in Copy diagnostics or Save diagnostic report. At startup, older
        dumps are trimmed to five files, 128 MB and seven days; newly written dumps wait until a
        later launch. An unfinished session can also mean a forced close or shutdown; it does not
        identify the cause.
      </p>
      {report && (
        <p>
          {report.logging
            ? 'Local logging available'
            : 'Log storage unavailable; recent events are held in memory'}{' '}
          · {report.dropped} events omitted this session
        </p>
      )}
      <div className={s.toolbar}>
        <Button onClick={() => background(act('copy'))}>Copy diagnostics</Button>
        <Button onClick={() => background(act('openLogs'))}>Open logs</Button>
        <Button onClick={() => background(act('export'))}>Save diagnostic report…</Button>
      </div>
      {message && <p role="status">{message}</p>}
      <details>
        <summary>Report preview</summary>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {report?.text || 'Loading…'}
        </pre>
      </details>
    </Modal>
  );
}
