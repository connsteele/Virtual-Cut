import { useEffect, useState } from 'react';
import type { DiagnosticSummary } from '../../electron/diagnostic-contracts';
import { Button, Modal } from './ui';
import s from './Workflow.module.css';
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
        Recent activity and failures stay on this computer. Paths, media, notes and transcripts are
        excluded. Nothing is uploaded.
      </p>
      <p className={s.muted}>
        Up to five 1 MB log files are kept. Playback logs state changes, not every frame or seek.
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
        <Button onClick={() => void act('copy')}>Copy diagnostics</Button>
        <Button onClick={() => void act('openLogs')}>Open logs</Button>
        <Button onClick={() => void act('export')}>Save diagnostic report…</Button>
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
