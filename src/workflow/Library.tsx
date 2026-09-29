import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ArrowLeft, BookOpen, Columns3, LayoutGrid, Network, Plus, Search } from 'lucide-react';
import { conceptGroup, references, uid, type Model, type Term, type Note } from './model';
import { Button, Field, Modal, Thumbnail } from './ui';
import s from './Workflow.module.css';
import { FolderGraph, type GraphNode as Node } from './FolderGraph';
export function Library({
  model: m,
  setModel,
  onOpen,
  onSelect,
  sample = true,
}: {
  model: Model;
  setModel: Dispatch<SetStateAction<Model>>;
  onOpen: (rid: string, time: number) => void;
  onSelect: (cid: string) => void;
  sample?: boolean;
}) {
  const [mode, setMode] = useState('Connections'),
    [view, setView] = useState('Graph'),
    [focus, setFocus] = useState('Cai'),
    [history, setHistory] = useState<string[]>([]),
    [depth, setDepth] = useState(1),
    [query, setQuery] = useState(''),
    [term, setTerm] = useState<Term | null>(null),
    [note, setNote] = useState<Note | null>(null),
    [linking, setLinking] = useState(false),
    [smart, setSmart] = useState(false);
  const nodes = useMemo(
    () =>
      [
        ...m.terms.map((t) => ({
          id: t.id,
          name: t.name,
          kind: t.kind,
          group: t.group || conceptGroup(t.name, t.kind),
          image: t.image,
        })),
        ...m.clips.map((c) => ({
          id: c.id,
          name: c.name,
          kind: 'Clip',
          group: 'Footage/' + c.folder,
          path: c.folder,
          rid: c.rid,
          time: c.start,
          image: m.recordings.find((r) => r.id === c.rid)?.poster,
        })),
        ...m.recordings.flatMap((r) =>
          (m.markers[r.id] || []).map((x) => ({
            id: x.id,
            name: x.name,
            kind: 'Marker',
            group: 'Markers/' + x.category,
            rid: r.id,
            time: x.time,
            image: r.poster,
          })),
        ),
        ...m.notes.map((n) => ({ id: n.id, name: n.title, kind: 'Note', group: 'Notes' })),
        ...(sample ? references : []).map((r) => ({
          ...r,
          kind: 'Footage reference',
          group: 'Footage/' + r.path.split('/').slice(0, -1).join('/'),
        })),
      ] as Node[],
    [m, sample],
  );
  const edges = useMemo(
    () =>
      [
        ...m.links,
        ...m.recordings.flatMap((r) =>
          (m.markers[r.id] || []).flatMap((x) => {
            const clips = m.clips.filter(
              (c) => c.rid === r.id && x.time >= c.start && x.time < c.end,
            );
            return [
              { from: x.topic, to: x.id, label: 'labels' },
              ...clips.map((c) => ({ from: x.id, to: c.id, label: 'inside' })),
            ];
          }),
        ),
      ].filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to)),
    [m, nodes],
  );
  const current = nodes.find((n) => n.id === focus) ||
      nodes[0] || {
        id: '',
        name: 'No connections yet',
        kind: 'Project',
        group: 'Project',
        image: '',
      },
    entry = m.terms.find((t) => t.id === current?.id);
  const matches = (n: Node) =>
    [n.name, m.terms.find((t) => t.id === n.id)?.aliases || '']
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase());
  const neighbors = (id: string) =>
    nodes.filter((n) =>
      edges.some((e) => (e.from === id && e.to === n.id) || (e.to === id && e.from === n.id)),
    );
  const direct = neighbors(current.id),
    visible = new Set([current.id, ...direct.map((n) => n.id)]);
  if (depth === 2) direct.forEach((n) => neighbors(n.id).forEach((x) => visible.add(x.id)));
  function choose(id: string) {
    if (id !== current.id) setHistory((h) => [...h, current.id]);
    setFocus(id);
    setMode('Connections');
    setQuery('');
  }
  const nodeButton = (n: Node) => (
    <button key={n.id} className={s.nodeButton} onClick={() => choose(n.id)}>
      <span>{n.kind}</span>
      <strong>{n.name}</strong>
    </button>
  );
  const detail = (
    <aside className={s.linkDetail} aria-label="Connection details">
      {current.image && <Thumbnail src={current.image} alt={current.name} />}
      <span className={s.eyebrow}>
        {entry ? 'Glossary · ' : ''}
        {current.kind}
      </span>
      <h2>{current.name}</h2>
      {entry && (
        <>
          <p>{entry.definition}</p>
          {entry.aliases && <p className={s.muted}>Aliases: {entry.aliases}</p>}
          <Button onClick={() => setTerm({ ...entry })}>Edit glossary entry</Button>
        </>
      )}
      {current.path && (
        <p className={s.muted}>
          {current.path}
          <br />
          Linked footage folder / reference
        </p>
      )}
      {current.rid && (
        <Button primary onClick={() => onOpen(current.rid!, current.time || 0)}>
          Open at this moment
        </Button>
      )}
      {current.kind === 'Note' && (
        <Button onClick={() => setNote({ ...m.notes.find((n) => n.id === current.id)! })}>
          Open note
        </Button>
      )}
      <h3>Connections</h3>
      {edges
        .filter((e) => e.from === current.id || e.to === current.id)
        .map((e, i) => {
          const n = nodes.find((n) => n.id === (e.from === current.id ? e.to : e.from))!;
          return (
            <div className={s.connection} key={i}>
              <span className={s.muted}>
                {e.from === current.id ? e.label : `${n.name} · ${e.label}`}
              </span>
              {nodeButton(n)}
            </div>
          );
        })}
      <Button onClick={() => setLinking(true)}>Link a note</Button>
    </aside>
  );
  return (
    <div className={s.library}>
      <div className={s.toolbar}>
        <div className={s.tools}>
          {['Clips', 'Connections', 'Glossary'].map((x) => (
            <Button
              key={x}
              aria-pressed={mode === x}
              onClick={() => {
                setMode(x);
                setQuery('');
              }}
            >
              {x === 'Glossary' ? (
                <BookOpen size={16} />
              ) : x === 'Connections' ? (
                <Network size={16} />
              ) : (
                <LayoutGrid size={16} />
              )}{' '}
              {x}
            </Button>
          ))}
        </div>
        <label className={s.search}>
          <Search size={16} />
          <input
            aria-label="Search library"
            placeholder="Names, aliases, markers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <Button onClick={() => setSmart(true)}>Resolve collection</Button>
      </div>
      {mode === 'Clips' ? (
        <div className={s.scroll}>
          <div className={s.libraryCards}>
            {m.clips
              .filter(
                (c) =>
                  matches({ id: c.id, name: c.name, kind: 'Clip' }) ||
                  m.markers[c.rid]?.some(
                    (x) =>
                      x.time >= c.start &&
                      x.time < c.end &&
                      matches({ id: x.topic, name: x.name, kind: 'Marker' }),
                  ),
              )
              .map((c) => (
                <article className={s.clipTile} key={c.id}>
                  <Thumbnail
                    src={m.recordings.find((r) => r.id === c.rid)?.poster || ''}
                    alt={c.name}
                  />
                  <h3>{c.name}</h3>
                  <p className={s.muted}>{c.folder}</p>
                  <div className={s.tools}>
                    <Button onClick={() => onOpen(c.rid, c.start)}>Details</Button>
                    <Button onClick={() => onSelect(c.id)}>+ Select</Button>
                    <Button onClick={() => choose(c.id)}>Connections</Button>
                  </div>
                </article>
              ))}
          </div>
        </div>
      ) : mode === 'Glossary' ? (
        <div className={s.scroll}>
          <div className={s.tools}>
            <Button
              primary
              onClick={() =>
                setTerm({
                  id: uid(),
                  name: '',
                  kind: 'Character',
                  definition: '',
                  aliases: '',
                  pronunciation: '',
                })
              }
            >
              <Plus size={16} /> Term
            </Button>
            <span className={s.muted}>Sample glossary · local edits</span>
          </div>
          <div className={s.libraryCards}>
            {m.terms
              .filter((t) => matches({ id: t.id, name: t.name, kind: t.kind }))
              .map((t) => (
                <article className={s.clipTile} key={t.id}>
                  {t.image && <Thumbnail src={t.image} alt={`${t.name} · footage reference`} />}
                  <span className={s.eyebrow}>{t.group || t.kind}</span>
                  <h2>{t.name}</h2>
                  <p>{t.definition}</p>
                  {t.aliases && <p className={s.muted}>Aliases: {t.aliases}</p>}
                  <div className={s.tools}>
                    <Button onClick={() => setTerm({ ...t })}>Edit entry</Button>
                    <Button primary onClick={() => choose(t.id)}>
                      Explore connections
                    </Button>
                  </div>
                </article>
              ))}
          </div>
        </div>
      ) : (
        <>
          <div className={s.toolbar}>
            <Button
              disabled={!history.length}
              aria-label="Back through connections"
              onClick={() => {
                setFocus(history[history.length - 1]);
                setHistory(history.slice(0, -1));
              }}
            >
              <ArrowLeft size={16} />
              Back
            </Button>
            <label>
              Start at{' '}
              <select
                aria-label="Connection focus"
                value={current.id}
                onChange={(e) => choose(e.target.value)}
              >
                {nodes
                  .filter((n) => m.terms.some((t) => t.id === n.id) || n.id === current.id)
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Depth{' '}
              <select
                aria-label="Connection depth"
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
              >
                <option value="1">Direct links</option>
                <option value="2">Two links</option>
              </select>
            </label>
            <div className={s.tools}>
              {['Cai', 'Blaze Arts', 'Dagsion'].map((n) => (
                <Button key={n} onClick={() => choose(n)}>
                  {n}
                </Button>
              ))}
            </div>
            <div className={s.tools}>
              {['Graph', 'Columns', 'Topics'].map((x) => (
                <Button key={x} aria-pressed={view === x} onClick={() => setView(x)}>
                  {x === 'Graph' ? (
                    <Network size={16} />
                  ) : x === 'Columns' ? (
                    <Columns3 size={16} />
                  ) : (
                    <LayoutGrid size={16} />
                  )}{' '}
                  {x}
                </Button>
              ))}
            </div>
          </div>
          {query && <div className={s.tools}>{nodes.filter(matches).map(nodeButton)}</div>}
          <div className={s.graphLayout}>
            <div className={s.graphScroll}>
              {view === 'Graph' ? (
                <FolderGraph
                  key={current.id}
                  current={current}
                  nodes={nodes}
                  edges={edges}
                  visible={visible}
                  onChoose={choose}
                />
              ) : view === 'Columns' ? (
                <div className={s.columns}>
                  {[
                    ['Glossary', nodes.filter((n) => m.terms.some((t) => t.id === n.id))],
                    [
                      'Related terms & markers',
                      nodes.filter(
                        (n) =>
                          visible.has(n.id) &&
                          n.id !== current.id &&
                          (n.kind === 'Marker' || m.terms.some((t) => t.id === n.id)),
                      ),
                    ],
                    [
                      'Footage & notes',
                      nodes.filter(
                        (n) =>
                          visible.has(n.id) &&
                          ['Clip', 'Note', 'Footage reference'].includes(n.kind),
                      ),
                    ],
                  ].map(([label, items]) => (
                    <section key={String(label)}>
                      <h3>{String(label)}</h3>
                      {(items as Node[]).map(nodeButton)}
                    </section>
                  ))}
                </div>
              ) : (
                <div className={s.libraryCards}>
                  {m.terms.map((t) => (
                    <article className={s.clipTile} key={t.id}>
                      {nodeButton({ id: t.id, name: t.name, kind: t.kind })}
                      <span className={s.muted}>{neighbors(t.id).length} connections</span>
                      {neighbors(t.id)
                        .filter((n) => n.image)
                        .slice(0, 1)
                        .map((n) => (
                          <Thumbnail key={n.id} src={n.image!} alt={n.name} />
                        ))}
                      {neighbors(t.id).slice(0, 4).map(nodeButton)}
                    </article>
                  ))}
                </div>
              )}
            </div>
            {detail}
          </div>
        </>
      )}
      {term && (
        <Modal title="Glossary entry" onClose={() => setTerm(null)}>
          <Field label="Canonical name">
            <input value={term.name} onChange={(e) => setTerm({ ...term, name: e.target.value })} />
          </Field>
          <Field label="Category">
            <select value={term.kind} onChange={(e) => setTerm({ ...term, kind: e.target.value })}>
              {['Character', 'Location', 'Mechanic', 'Story', 'Item', 'Other'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Concept group">
            <input
              value={term.group || conceptGroup(term.name, term.kind)}
              placeholder="Mechanics/Combat"
              onChange={(e) => setTerm({ ...term, group: e.target.value })}
            />
          </Field>
          <Field label="Image from footage">
            <select
              value={term.image || ''}
              onChange={(e) => setTerm({ ...term, image: e.target.value })}
            >
              <option value="">No image</option>
              {[
                ...new Map(
                  [
                    ...m.recordings.map((r) => ({ image: r.poster, name: r.title })),
                    ...references,
                    ...m.terms
                      .filter((t) => t.image)
                      .map((t) => ({ image: t.image!, name: t.name + ' reference' })),
                  ].map((x) => [x.image, x]),
                ).values(),
              ].map((x) => (
                <option key={x.image} value={x.image}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <p className={s.muted}>
            Concept groups organize the glossary. Linked footage keeps its own folder location.
          </p>
          <Field label="Aliases / transcript spellings">
            <input
              value={term.aliases}
              onChange={(e) => setTerm({ ...term, aliases: e.target.value })}
            />
          </Field>
          <Field label="Definition">
            <textarea
              value={term.definition}
              onChange={(e) => setTerm({ ...term, definition: e.target.value })}
            />
          </Field>
          <Field label="Pronunciation hint">
            <input
              value={term.pronunciation}
              onChange={(e) => setTerm({ ...term, pronunciation: e.target.value })}
            />
          </Field>
          <Field label="Add a connection">
            <select id="term-link">
              <option value="">Choose an item</option>
              {nodes
                .filter((n) => n.id !== term.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.kind} · {n.name}
                  </option>
                ))}
            </select>
          </Field>
          <Button
            primary
            disabled={!term.name.trim()}
            onClick={() => {
              const to = (document.getElementById('term-link') as HTMLSelectElement).value;
              setModel((m) => ({
                ...m,
                terms: [
                  ...m.terms.filter((t) => t.id !== term.id),
                  { ...term, name: term.name.trim() },
                ],
                links:
                  to && !m.links.some((l) => l.from === term.id && l.to === to)
                    ? [...m.links, { from: term.id, to, label: 'related to' }]
                    : m.links,
              }));
              choose(term.id);
              setTerm(null);
            }}
          >
            Save entry
          </Button>
          <p className={s.muted}>Original transcripts remain unchanged.</p>
        </Modal>
      )}
      {linking && (
        <Modal title={`Link a note to ${current.name}`} onClose={() => setLinking(false)}>
          {m.notes
            .filter((n) => n.id !== current.id)
            .map((n) => (
              <Button
                key={n.id}
                onClick={() => {
                  setModel((m) => ({
                    ...m,
                    links: m.links.some((e) => e.from === n.id && e.to === current.id)
                      ? m.links
                      : [...m.links, { from: n.id, to: current.id, label: 'cites' }],
                  }));
                  setLinking(false);
                }}
              >
                {n.title}
              </Button>
            ))}
        </Modal>
      )}
      {note && (
        <Modal title={note.title} onClose={() => setNote(null)}>
          <Field label="Note text">
            <textarea
              value={note.text}
              onChange={(e) => setNote({ ...note, text: e.target.value })}
            />
          </Field>
          <Field label="Notion page URL (reference only)">
            <input value={note.url} onChange={(e) => setNote({ ...note, url: e.target.value })} />
          </Field>
          <p className={s.muted}>Local draft; nothing is published to Notion.</p>
          <Button
            primary
            onClick={() => {
              setModel((m) => ({ ...m, notes: m.notes.map((n) => (n.id === note.id ? note : n)) }));
              setNote(null);
            }}
          >
            Save draft
          </Button>
        </Modal>
      )}
      {smart && (
        <Modal title="Resolve collection proposal" onClose={() => setSmart(false)}>
          <p>Approved glossary names can become keywords for Smart Bin rules.</p>
          <Field label="Collection">
            <select id="collection-term">
              {m.terms.map((t) => (
                <option key={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
          <p className={s.muted}>
            Merge approved metadata and preserve existing values. Direct Smart Bin creation is
            unverified; no Resolve connection is active.
          </p>
          <Button primary onClick={() => setSmart(false)}>
            Close proposal
          </Button>
        </Modal>
      )}
    </div>
  );
}
