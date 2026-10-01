/** Small reversible changes. Identity-based arrays let inspection add unrelated
 * recordings/markers without an edit or its Undo replacing those additions. */
export type Change =
  | { kind: 'value'; before: unknown; after: unknown }
  | { kind: 'object'; fields: [string, Change][] }
  | { kind: 'items'; fields: [string, Change][]; before: string[]; after: string[] };

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const items = (value: unknown[]): value is { id: string }[] =>
  value.every((v) => object(v) && typeof v.id === 'string') &&
  new Set(value.map((v) => (v as { id: string }).id)).size === value.length;

export function changes(before: unknown, after: unknown): Change | undefined {
  if (Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after) && items(before) && items(after)) {
    const fields = changes(
      Object.fromEntries(before.map((v) => [v.id, v])),
      Object.fromEntries(after.map((v) => [v.id, v])),
    );
    const oldOrder = before.map((v) => v.id),
      newOrder = after.map((v) => v.id);
    if (!fields && JSON.stringify(oldOrder) === JSON.stringify(newOrder)) return;
    return {
      kind: 'items',
      fields: fields?.kind === 'object' ? fields.fields : [],
      before: oldOrder,
      after: newOrder,
    };
  }
  if (object(before) && object(after)) {
    const fields: [string, Change][] = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const change = changes(before[key], after[key]);
      if (change) fields.push([key, change]);
    }
    return fields.length ? { kind: 'object', fields } : undefined;
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  return { kind: 'value', before: structuredClone(before), after: structuredClone(after) };
}

export function applyChange<T>(current: T, change: Change | undefined, reverse = false): T {
  if (!change) return current;
  if (change.kind === 'value') return structuredClone(reverse ? change.before : change.after) as T;
  if (change.kind === 'items') {
    const list = (Array.isArray(current) ? current : []) as { id: string }[];
    const values = new Map(list.map((v) => [v.id, v]));
    for (const [id, item] of change.fields) {
      // A native update to a still-unsaved item must not invent it on disk.
      if (!values.has(id) && item.kind !== 'value') continue;
      const next = applyChange(values.get(id), item, reverse);
      if (next === undefined) values.delete(id);
      else values.set(id, next);
    }
    const order =
      JSON.stringify(change.before) === JSON.stringify(change.after)
        ? list.map((v) => v.id)
        : reverse
          ? change.before
          : change.after;
    return [
      ...order.flatMap((id) => (values.has(id) ? [values.get(id)!] : [])),
      ...[...values].filter(([id]) => !order.includes(id)).map(([, v]) => v),
    ] as T;
  }
  const result = { ...(current as Record<string, unknown>) };
  for (const [key, field] of change.fields) {
    const next = applyChange(result[key], field, reverse);
    if (next === undefined) delete result[key];
    else
      Object.defineProperty(result, key, {
        value: next,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  return result as T;
}
