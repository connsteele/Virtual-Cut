import { useEffect, useState } from 'react';
import type { AgentAccessState, AgentActivity, AgentPairing } from '../../electron/agent-contracts';
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
const tokens = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
const pictures = (n: number) => `${n} picture${n === 1 ? '' : 's'}`;
/** A picture call that was refused because Allow pictures is off (VC-195). */
const picturesRefused = (a: AgentActivity) => a.outcome === 'refused' && a.tool === 'look';

/**
 * Pictures each app received since local midnight (VC-195), from the activity record. The
 * record keeps the newest 300 calls, so a day with more calls than that counts only those.
 */
function picturesToday(activity: AgentActivity[], now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const totals = new Map<string, { images: number; imageTokens: number }>();
  for (const a of activity) {
    if (a.outcome === 'refused' || !a.images || Date.parse(a.at) < midnight) continue;
    const t = totals.get(a.clientId) || { images: 0, imageTokens: 0 };
    t.images += a.images;
    t.imageTokens += a.imageTokens || 0;
    totals.set(a.clientId, t);
  }
  return totals;
}

/** Agent access (VC-160): the switch, paired agent apps and what each one read or proposed. */
export function AgentAccess({ project }: { project?: { id: string; name: string } }) {
  const api = window.virtualCut?.agent;
  const [state, setState] = useState<AgentAccessState | null>(null);
  const [name, setName] = useState('Claude Code');
  const [pairing, setPairing] = useState<AgentPairing | null>(null);
  const [message, setMessage] = useState('');
  const [picturesNote, setPicturesNote] = useState('');
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
  const today = picturesToday(state?.activity || []);
  const picturesOn = !!state?.pictures;
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
      <div className={picturesOn ? `${s.pictures} ${s.on}` : s.pictures} data-agent-pictures>
        <button
          type="button"
          role="switch"
          className={s.toggle}
          aria-checked={picturesOn}
          aria-describedby="agent-pictures-where"
          disabled={!state}
          onClick={() => {
            const allowed = !picturesOn;
            background(
              act(async () => {
                setState(await api.setPictures(allowed));
                setPicturesNote(
                  allowed
                    ? 'On. The next look from any paired app can send pictures.'
                    : 'Off. The next look from any app is refused.',
                );
              }),
            );
          }}
        >
          <span className={s.track} aria-hidden="true" />
          Allow pictures
          <span className={s.state} aria-hidden="true">
            {picturesOn ? 'On' : 'Off'}
          </span>
        </button>
        <span className={s.where} id="agent-pictures-where">
          For every paired app. Pictures from your recordings go to each app’s AI provider and are
          kept under that provider’s data settings.
        </span>
        {picturesNote && (
          <span className={s.note} role="status">
            {picturesNote}
          </span>
        )}
      </div>
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
                {today.get(c.id) && (
                  <span className={s.today} data-pictures-today>
                    <br />
                    {`Pictures today: ${today.get(c.id)?.images} · ~${tokens(today.get(c.id)?.imageTokens || 0)} tokens`}
                  </span>
                )}
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
                {picturesRefused(a)
                  ? ' (refused: pictures are off)'
                  : a.outcome === 'refused'
                    ? ' (refused)'
                    : a.outcome === 'proposed'
                      ? ' · waiting in the transcript window'
                      : a.outcome === 'amended'
                        ? ' · the card changed in the transcript window'
                        : ''}
              </span>
              {!!a.images && a.outcome !== 'refused' && (
                <span className={s.picmeta}>
                  {pictures(a.images)} · ~{tokens(a.imageTokens || 0)} tokens
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className={s.muted}>No calls yet.</p>
      )}
    </div>
  );
}
