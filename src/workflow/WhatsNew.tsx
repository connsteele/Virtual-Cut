import { Fragment, useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import type { AgentClient } from '../../electron/agent-contracts';
import type { WhatsNewState } from '../../electron/contracts';
import { compareVersions, notesSince, type ReleaseNote } from '../../electron/release-notes';
import { Button } from './ui';
import s from './WhatsNew.module.css';

const agentNotesKey = 'virtual-cut.whats-new.agent-notes';
const time = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const day = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** Note text: `backticks` mark tool names and settings; nothing else is formatted. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text
        .split('`')
        .map((part, i) =>
          i % 2 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>,
        )}
    </>
  );
}

function showAgentNotes() {
  try {
    return localStorage.getItem(agentNotesKey) !== 'false';
  } catch {
    return true;
  }
}

/** What a paired app has read, as the Paired agents box says it. */
function readState(c: AgentClient, release: string) {
  if (c.notesRead && compareVersions(c.notesRead, release) >= 0)
    return {
      current: true,
      text: `Read ${release} notes${c.notesReadAt ? ` · ${time(c.notesReadAt)}` : ''}`,
    };
  if (c.notesRead)
    return { current: false, text: `Last read ${c.notesRead} · hasn't read ${release} yet` };
  if (c.pairedVersion && compareVersions(c.pairedVersion, release) >= 0)
    return { current: true, text: `Paired on ${release}, nothing new since` };
  if (c.pairedVersion)
    return { current: false, text: `Paired on ${c.pairedVersion} · hasn't read ${release} yet` };
  return { current: false, text: "Hasn't read any notes yet" };
}

function PairedAgents({ release }: { release: string }) {
  const api = window.virtualCut?.agent;
  const [clients, setClients] = useState<AgentClient[] | null>(null);
  useEffect(() => {
    if (!api) return;
    let alive = true;
    const refresh = () =>
      void api
        .state()
        .then((value) => alive && setClients(value.clients))
        .catch(() => alive && setClients([]));
    refresh();
    const stop = api.onChanged(refresh);
    return () => {
      alive = false;
      stop();
    };
  }, [api]);
  return (
    <section className={s.agents} aria-label="Paired agents" data-paired-agents>
      <h3>Paired agents</h3>
      {clients === null ? null : clients.length ? (
        <ul>
          {clients.map((c) => {
            const read = readState(c, release);
            return (
              <li key={c.id}>
                <strong>{c.name}</strong>
                <span className={s.project}>{c.projectName}</span>
                <span className={read.current ? s.current : s.behind} data-read-state>
                  {read.text}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={s.muted}>No agent app is paired. Pair one under Agent in a project.</p>
      )}
      <p className={s.muted}>
        Agent apps read the For agents notes with <code>get_whats_new</code>.
      </p>
    </section>
  );
}

function Version({
  note,
  open,
  isNew,
  agents,
}: {
  note: ReleaseNote;
  open: boolean;
  isNew: boolean;
  agents: boolean;
}) {
  return (
    <details className={s.version} open={open} data-version={note.version}>
      <summary>
        <span className={s.number}>{note.version}</span>
        <span className={s.title}>{note.title}</span>
        <span className={s.date}>{day(note.date)}</span>
        {(isNew || note.draft) && (
          <span className={s.tags}>
            {isNew && <span className={s.newTag}>New since you last looked</span>}
            {note.draft && <span className={s.draftTag}>Draft notes</span>}
          </span>
        )}
      </summary>
      <div className={agents ? s.body : `${s.body} ${s.solo}`}>
        <div>
          <h4>For you</h4>
          <ul>
            {note.user.map((line) => (
              <li key={line}>
                <Rich text={line} />
              </li>
            ))}
          </ul>
        </div>
        {agents && (
          <div className={s.forAgents} data-agent-notes>
            <h4>
              <Bot size={13} aria-hidden /> For agents
            </h4>
            <ul>
              {note.agents.map((line) => (
                <li key={line}>
                  <Rich text={line} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * What's new (VC-242): the notes built into this version and the ones before it, newest first.
 * `lastOpened` is the release on which the window was opened before this time.
 */
export function WhatsNewContent({
  version,
  release,
  lastOpened,
}: {
  version: string;
  release: string;
  lastOpened?: string;
}) {
  const [agents, setAgents] = useState(showAgentNotes);
  const notes = notesSince(release);
  const isNew = (n: ReleaseNote) => !!lastOpened && compareVersions(n.version, lastOpened) > 0;
  return (
    <div className={s.content} data-whats-new>
      <div className={s.head}>
        <p>
          You’re on <strong>{version}</strong>
        </p>
        <label>
          <input
            type="checkbox"
            checked={agents}
            onChange={(e) => {
              setAgents(e.target.checked);
              try {
                localStorage.setItem(agentNotesKey, String(e.target.checked));
              } catch {
                /* Unsaved: the choice lasts until the window closes. */
              }
            }}
          />
          Show agent notes
        </label>
      </div>
      {agents && <PairedAgents release={release} />}
      <div className={s.versions}>
        {notes.map((n, i) => (
          <Version
            key={n.version}
            note={n}
            open={i === 0 || isNew(n)}
            isNew={isNew(n)}
            agents={agents}
          />
        ))}
      </div>
      <p className={s.muted}>
        Notes start at {notes[notes.length - 1]?.version}. Earlier versions are in the project’s
        changelog.
      </p>
    </div>
  );
}

/** The one-time pop-up after an update (VC-242). It never takes focus. */
export function WhatsNewPopup({
  state,
  onOpen,
  onLater,
}: {
  state: WhatsNewState;
  onOpen: () => void;
  onLater: () => void;
}) {
  const note = notesSince(state.release)[0];
  return (
    <div
      className={s.popup}
      role="status"
      aria-label="Virtual Cut was updated"
      data-whats-new-popup
    >
      <strong>Virtual Cut updated to {state.version}</strong>
      {note && <p>{note.title}. Paired agents read the same notes.</p>}
      <div className={s.actions}>
        <Button onClick={onLater}>Later</Button>
        <Button primary onClick={onOpen}>
          See what’s new
        </Button>
      </div>
    </div>
  );
}
