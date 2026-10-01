import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type { ResolveHelperStatus } from '../../electron/project-contracts';
import { Button, Modal } from './ui';
import s from './Workflow.module.css';

const labels = {
  missing: 'Not installed',
  installed: 'Installed · current version',
  outdated: 'Installed · update available',
  unmanaged: 'Matching helper · not registered by this app',
  customized: 'Customized or unrecognized helper · preserved',
};
export function HandoffPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<ResolveHelperStatus>();
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [removing, setRemoving] = useState(false);
  useEffect(() => {
    let active = true;
    window.dispatchEvent(new Event('virtual-cut-pause-workspace'));
    void window
      .virtualCut!.project.resolveHelperStatus()
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function act(action: 'install' | 'remove' | 'refresh' | 'reveal') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const api = window.virtualCut!.project;
      if (action === 'install') {
        await api.installResolveHelper();
        setNotice(
          'Installed. If the Utility menu has not refreshed, save your Resolve work and restart Resolve.',
        );
      }
      if (action === 'remove') {
        await api.removeResolveHelper();
        setRemoving(false);
        setNotice(
          'Removed the app-owned helper. Backups and other scripts remain in place. Restart Resolve if its menu still shows the helper.',
        );
      }
      if (action === 'reveal') await api.revealResolveHelper();
      setStatus(await api.resolveHelperStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(await window.virtualCut!.project.resolveHelperStatus().catch(() => undefined));
    } finally {
      setBusy(false);
    }
  }
  const owned = status && ['installed', 'outdated'].includes(status.state);
  return (
    <Modal title="Handoff to Resolve" onClose={onClose}>
      <p>Bring finished videos, chapter markers, multiline marker notes and colors into Resolve.</p>
      <section className={s.handoffStatus} aria-label="Resolve helper">
        <h3>Metadata helper</h3>
        <p role="status">
          {status
            ? labels[status.state]
            : busy
              ? 'Checking installation…'
              : 'Installation status unavailable'}
        </p>
        {status && <p className={s.handoffPath}>{status.file}</p>}
        <div className={s.tools}>
          <Button
            primary
            disabled={
              busy || !status || status.state === 'customized' || status.state === 'installed'
            }
            onClick={() => void act('install')}
          >
            {status?.state === 'outdated'
              ? 'Update Resolve metadata helper…'
              : 'Install Resolve metadata helper…'}
          </Button>
          <Button
            disabled={busy || !status || status.state === 'missing'}
            onClick={() => void act('reveal')}
          >
            <FolderOpen size={15} />
            Open helper location
          </Button>
          <Button disabled={busy} onClick={() => void act('refresh')}>
            Refresh status
          </Button>
          {owned && (
            <Button disabled={busy} onClick={() => setRemoving(true)}>
              Remove helper…
            </Button>
          )}
        </div>
        {removing && (
          <div role="group" aria-label="Confirm helper removal">
            <p>
              Remove only the installed Virtual Cut helper and its ownership record? Your videos,
              Resolve projects, other scripts and saved helper backups remain in place.
            </p>
            <div className={s.tools}>
              <Button disabled={busy} onClick={() => setRemoving(false)}>
                Keep helper
              </Button>
              <Button disabled={busy} onClick={() => void act('remove')}>
                Remove installed helper
              </Button>
            </div>
          </div>
        )}
        {status && ['customized', 'unmanaged'].includes(status.state) && (
          <p className={s.muted}>
            {status.state === 'customized'
              ? 'This file has personal changes or unknown ownership. Move or rename it yourself before installing; this app will preserve it.'
              : 'Installing registers this identical helper so this app can manage it. Removal stays unavailable until then.'}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
      </section>
      <h3>Transfer markers</h3>
      <ol className={s.handoffSteps}>
        <li>
          Keep each finished video with its adjacent <strong>.vcut.json</strong> companion. Import
          the video into Resolve's Media Pool.
        </li>
        <li>
          Select the imported videos in the Media Pool. Open{' '}
          <strong>Workspace → Scripts → Utility → Virtual Cut metadata</strong>.
        </li>
        <li>
          Choose <strong>Check selected clips</strong> to inspect the read-only plan. Then choose{' '}
          <strong>Apply marker metadata</strong> to transfer matching marker names, colors and
          notes.
        </li>
        <li>
          Inspect the Media Pool markers before adding clips to a new timeline. Rerunning the helper
          preserves matching markers and reports conflicts with your changes.
        </li>
      </ol>
      <p className={s.muted}>
        Installing the helper does not edit a Resolve project. Chapter names can appear on ordinary
        video import; the companion and helper supply marker notes and colors. Existing timeline
        instances may need separate review. Clip notes, recording context and folder intent remain
        in the companion and Library. This handoff does not build bins or timelines.
      </p>
      <p className={s.muted}>
        The helper needs Resolve's Utility scripting and Python support. Our current live validation
        used Resolve Studio 21.1; other installations still need a compatibility check.
      </p>
    </Modal>
  );
}
