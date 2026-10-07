import { useEffect, useState } from 'react';
import type { AgentAccessState, AgentPairing } from '../../electron/agent-contracts';
import { Button, Field } from './ui';
import { background } from './background';
import s from './AgentAccess.module.css';

const time = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Agent access (VC-160): the switch, paired agent apps and what each one read or proposed. */
export function AgentAccess({ project }: { project?: { id: string; name: string } }) {
  const api = window.virtualCut?.agent;
  const [state, setState] = useState<AgentAccessState | null>(null);
  const [name, setName] = useState('Claude Code');
  const [pairing, setPairing] = useState<AgentPairing | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!api) return;
    let alive = true;
    const refresh = () =>
      void api
        .state()
        .then((value) => alive && setState(value))
        .catch(() => alive && setMessage('Agent access is unavailable.'));
    refresh();
    const stop = api.onChanged(refresh);
    return () => {
      alive = false;
      stop();
    };
  }, [api]);
  if (!api) return <p>Agent access needs the desktop app.</p>;
  async function act(work: () => Promise<void>) {
    setMessage('');
    try {
      await work();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : String(e),
      );
    }
  }
  const clients = state?.clients.filter((c) => !project || c.projectId === project.id) || [];
  const others = (state?.clients.length || 0) - clients.length;
  return (
    <div className={s.panel} data-agent-access>
      <p>
        Agent apps such as Claude Code or Claude Desktop can read the open project through MCP and
        propose markers, notes, splits and clips. Proposals wait on cue cards in the transcript
        window; nothing changes until you accept one. Every call is listed below.
      </p>
      <label className={s.switch}>
        <input
          type="checkbox"
          checked={!!state?.enabled}
          disabled={!state}
          onChange={(e) => {
            const enabled = e.target.checked;
            background(act(async () => setState(await api.setEnabled(enabled))));
          }}
        />
        Allow agent apps to connect
      </label>
      {state?.enabled && (
        <p className={s.muted} role="status">
          {state.listening ? 'Waiting for paired agent apps.' : state.message}
        </p>
      )}
      <h3>Pair an agent app</h3>
      {project ? (
        <>
          <Field label="Agent app">
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button
            onClick={() =>
              background(
                act(async () => {
                  setPairing(await api.pair(project.id, name));
                }),
              )
            }
          >
            Pair with {project.name}
          </Button>
        </>
      ) : (
        <p className={s.muted}>Open a project to pair an agent app with it.</p>
      )}
      {pairing && (
        <div className={s.pairing} data-agent-pairing>
          <p>
            Paired <strong>{pairing.client.name}</strong>. Copy one of these into the agent app now;
            the pairing code is shown only once.
          </p>
          <span className={s.label}>Claude Code (run once in a terminal)</span>
          <pre data-config="claude-code">{pairing.claudeCode}</pre>
          <Button onClick={() => background(act(() => api.copy(pairing.claudeCode)))}>
            Copy command
          </Button>
          <span className={s.label}>Claude Desktop (claude_desktop_config.json)</span>
          <pre data-config="claude-desktop">{pairing.claudeDesktop}</pre>
          <Button onClick={() => background(act(() => api.copy(pairing.claudeDesktop)))}>
            Copy settings
          </Button>
          <Button onClick={() => setPairing(null)}>Done</Button>
        </div>
      )}
      {message && <p role="alert">{message}</p>}
      <h3>Paired apps</h3>
      {clients.length ? (
        <ul className={s.list}>
          {clients.map((c) => (
            <li key={c.id}>
              <span>
                <strong>{c.name}</strong>
                {c.connected && <span className={s.live}> · connected</span>}
                <br />
                <span className={s.muted}>
                  Paired {time(c.paired)}
                  {c.lastUsed ? ` · last read ${time(c.lastUsed)}` : ''}
                </span>
              </span>
              <Button
                aria-label={`Revoke ${c.name}`}
                onClick={() => background(act(async () => setState(await api.revoke(c.id))))}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={s.muted}>None for this project.</p>
      )}
      {others > 0 && (
        <p className={s.muted}>
          {others} more paired with other projects; they can read only while their project is open.
        </p>
      )}
      <h3>Activity</h3>
      {state?.activity.length ? (
        <ol className={s.activity} data-agent-activity>
          {state.activity.slice(0, 100).map((a, i) => (
            <li key={a.at + i} className={a.outcome === 'refused' ? s.refused : undefined}>
              <span className={s.muted}>
                {time(a.at)} · {a.clientName}
              </span>
              <span>
                {a.summary}
                {a.outcome === 'refused'
                  ? ' (refused)'
                  : a.outcome === 'proposed'
                    ? ' · waiting in the transcript window'
                    : ''}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={s.muted}>No calls yet.</p>
      )}
    </div>
  );
}
