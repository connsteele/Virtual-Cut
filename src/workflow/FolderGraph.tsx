import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, FolderOpen, Image as ImageIcon, ArrowRight } from 'lucide-react';
import type { Link } from './model';
import s from './FolderGraph.module.css';

export interface GraphNode {
  id: string;
  name: string;
  kind: string;
  image?: string;
  group?: string;
  rid?: string;
  time?: number;
  path?: string;
}
interface Group {
  path: string;
  name: string;
  nodes: GraphNode[];
  children: Group[];
}
function groupNodes(nodes: GraphNode[]): Group[] {
  const groups: Group[] = [];
  for (const node of nodes) {
    const parts = (node.group || node.kind).split('/').filter(Boolean);
    let level = groups;
    let path = '';
    for (let i = 0; i < parts.length; i++) {
      path += (path ? '/' : '') + parts[i];
      let group = level.find((g) => g.name === parts[i]);
      if (!group) {
        group = { name: parts[i], path, nodes: [], children: [] };
        level.push(group);
      }
      if (i === parts.length - 1) group.nodes.push(node);
      level = group.children;
    }
  }
  return groups;
}
export function FolderGraph({
  current,
  nodes,
  edges,
  visible,
  onChoose,
}: {
  current: GraphNode;
  nodes: GraphNode[];
  edges: Link[];
  visible: Set<string>;
  onChoose: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState('Relevance');
  const canvas = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const linkedIds = (id: string) =>
    new Set(edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : [])));
  const focusLinks = linkedIds(current.id);
  const shared = (id: string) => [...linkedIds(id)].filter((n) => focusLinks.has(n)).length;
  const related = nodes.filter((n) => n.id !== current.id && visible.has(n.id));
  const sorted = [...related].sort((a, b) => {
    if (sort === 'Name') return a.name.localeCompare(b.name);
    const score = (n: GraphNode) =>
      sort === 'Connections'
        ? linkedIds(n.id).size
        : Number(focusLinks.has(n.id)) * 100 + shared(n.id);
    return score(b) - score(a) || a.name.localeCompare(b.name);
  });
  const order = ['Characters', 'Mechanics', 'Locations', 'Story', 'Footage', 'Markers', 'Notes'];
  const groups = groupNodes(sorted).sort(
    (a, b) =>
      (order.indexOf(a.name) < 0 ? 99 : order.indexOf(a.name)) -
      (order.indexOf(b.name) < 0 ? 99 : order.indexOf(b.name)),
  );
  const layoutKey = JSON.stringify([
    current.id,
    sort,
    expanded,
    sorted.map((n) => [n.id, n.group]),
  ]);
  useLayoutEffect(() => {
    const el = canvas.current!;
    const draw = () => {
      const box = el.getBoundingClientRect();
      const focus = el.querySelector<HTMLElement>('[data-focus-card]')!.getBoundingClientRect();
      const x = focus.right - box.left,
        y = focus.top + focus.height / 2 - box.top;
      const next = [...el.querySelectorAll<HTMLElement>('[data-group-root]')].map((g) => {
        const r = g.getBoundingClientRect();
        const dx = r.left - box.left,
          dy = r.top + Math.min(90, r.height / 2) - box.top;
        return `M ${x} ${y} C ${x + 40} ${y}, ${dx - 40} ${dy}, ${dx} ${dy}`;
      });
      setLines((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    };
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    el.querySelectorAll<HTMLElement>('[data-group-root]').forEach((e) => observer.observe(e));
    draw();
    return () => observer.disconnect();
  }, [layoutKey]);
  const visual = (n: GraphNode, large = false) =>
    n.image ? (
      <img
        src={n.image}
        alt={`${n.name} · footage reference`}
        draggable={false}
        className={large ? s.focusImage : s.image}
      />
    ) : (
      <div className={large ? s.focusPlaceholder : s.placeholder}>
        <ImageIcon size={large ? 30 : 20} />
        <span>{n.name.slice(0, 2).toUpperCase()}</span>
      </div>
    );
  const card = (n: GraphNode) => (
    <button
      data-navigate-item
      key={n.id}
      className={s.node}
      data-graph-node={n.id}
      onClick={() => onChoose(n.id)}
      title={`${focusLinks.has(n.id) ? 'Direct connection' : 'Related through another node'} · ${shared(n.id)} shared links`}
    >
      {visual(n)}
      <strong>{n.name}</strong>
      <small>
        {focusLinks.has(n.id) ? 'Direct' : 'Related'}
        {shared(n.id) ? ` · ${shared(n.id)} shared` : ''}
      </small>
    </button>
  );
  const folder = (g: Group, root = false) => (
    <section
      key={g.path}
      className={`${s.folder} ${root ? s.rootFolder : ''}`}
      data-group-root={root || undefined}
      data-concept-folder={g.path}
    >
      <h3 className={s.tab}>
        <FolderOpen size={15} />
        {g.name}
        <span>{g.nodes.length || g.children.length}</span>
      </h3>
      <div className={s.folderBody}>
        {g.nodes.length > 0 && (
          <div className={s.nodeGrid}>
            {(expanded[g.path] ? g.nodes : g.nodes.slice(0, 4)).map(card)}
          </div>
        )}
        {g.nodes.length > 4 && (
          <button
            className={s.expand}
            aria-expanded={!!expanded[g.path]}
            onClick={() => setExpanded({ ...expanded, [g.path]: !expanded[g.path] })}
          >
            {expanded[g.path] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {expanded[g.path] ? 'Show top 4' : `Show all ${g.nodes.length}`}
          </button>
        )}
        {g.children.length > 0 && (
          <div className={s.nested}>{g.children.map((child) => folder(child))}</div>
        )}
      </div>
    </section>
  );
  return (
    <div className={s.explorer}>
      <div className={s.toolbar}>
        <span>
          Connections from <strong>{current.name}</strong>
        </span>
        <label>
          Sort{' '}
          <select
            aria-label="Sort graph connections"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {['Relevance', 'Name', 'Connections'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <div className={s.canvas} ref={canvas}>
        <svg className={s.edges} aria-hidden="true">
          {lines.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>
        <div className={s.focusColumn}>
          <section className={s.focusCard} data-focus-card>
            <h3 className={s.tab}>
              <FolderOpen size={15} />
              {current.group || current.kind}
            </h3>
            <div className={s.focusBody}>
              {visual(current, true)}
              <span className={s.overline}>Exploring</span>
              <h2>{current.name}</h2>
              <p>{focusLinks.size} direct connections</p>
            </div>
          </section>
          <p className={s.hint}>
            <ArrowRight size={15} />
            Choose a card to follow its connections.
          </p>
          <p className={s.hint}>
            Relevance uses direct relationships, then shared links. Images are references from
            footage.
          </p>
        </div>
        <div className={s.groups}>
          {groups.map((g) => folder(g, true))}
          {!groups.length && <p>No connections yet. Add one in the glossary.</p>}
        </div>
      </div>
    </div>
  );
}
