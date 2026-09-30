import type { Recording } from './model';

export interface SourceFolder {
  path: string;
  label: string;
  count: number;
  total: number;
  children: SourceFolder[];
}
export function sourceDirectory(file?: string) {
  if (!file) return '';
  const normalized = file.replaceAll('\\', '/');
  return normalized.slice(0, normalized.lastIndexOf('/'));
}
export function inSourceFolder(recording: Recording, folder: string) {
  const dir = sourceDirectory(recording.sourcePath).toLowerCase();
  const key = folder.toLowerCase();
  return !folder || dir === key || dir.startsWith(key + '/');
}
export function sourceFolders(recordings: Recording[]): SourceFolder[] {
  const roots: SourceFolder[] = [],
    byPath = new Map<string, SourceFolder>();
  for (const r of recordings) {
    const dir = sourceDirectory(r.sourcePath);
    if (!dir) continue;
    const unc = dir.startsWith('//');
    const parts = dir.split('/').filter(Boolean);
    const base = unc
      ? '//' + parts.splice(0, 2).join('/')
      : dir.startsWith('/')
        ? '/'
        : parts.shift()!;
    let prefix = base,
      siblings = roots,
      node: SourceFolder | undefined;
    for (const part of [base, ...parts]) {
      if (part !== base) prefix = prefix.replace(/\/$/, '') + '/' + part;
      const key = prefix.toLowerCase();
      node = byPath.get(key);
      if (!node) {
        node = { path: prefix, label: part, count: 0, total: 0, children: [] };
        byPath.set(key, node);
        siblings.push(node);
      }
      node.total++;
      siblings = node.children;
    }
    if (node) node.count++;
  }
  function sort(nodes: SourceFolder[]) {
    nodes.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    nodes.forEach((node) => sort(node.children));
  }
  sort(roots);
  // Hide redundant drive/ancestor chains while retaining the real full path.
  return roots.map((node) => {
    while (!node.count && node.children.length === 1) node = node.children[0];
    return node;
  });
}
