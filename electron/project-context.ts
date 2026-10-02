/** Editorial context is deliberately small. Recognition results live separately. */
export interface CreativeContext {
  id: string;
  gameMode: 'inherit' | 'set' | 'none';
  game?: { id: string; name: string; vocabulary: string };
  briefMode: 'inherit' | 'append' | 'replace' | 'none';
  brief: string;
}
export function defaultContext(id: string): CreativeContext {
  return {
    id,
    gameMode: id === 'project' ? 'none' : 'inherit',
    briefMode: id === 'project' ? 'replace' : 'inherit',
    brief: '',
  };
}
export function effectiveContext(contexts: CreativeContext[] = [], batchId?: string) {
  const project = contexts.find((c) => c.id === 'project') || defaultContext('project');
  const batch = contexts.find((c) => c.id === batchId);
  const game =
    batch && batch.gameMode !== 'inherit'
      ? batch.gameMode === 'set'
        ? batch.game
        : undefined
      : project.gameMode === 'set'
        ? project.game
        : undefined;
  const base = project.briefMode === 'none' ? '' : project.brief;
  const brief =
    !batch || batch.briefMode === 'inherit'
      ? base
      : batch.briefMode === 'none'
        ? ''
        : batch.briefMode === 'append'
          ? [base, batch.brief].filter(Boolean).join('\n\n')
          : batch.brief;
  return { game: game?.name.trim() ? game : undefined, brief };
}
export function validateContexts(value: CreativeContext[] = []) {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid project context.');
  const ids = new Set<string>();
  const text = (s: unknown, n: number) => typeof s === 'string' && s.length <= n;
  for (const c of value) {
    if (
      !c ||
      !text(c.id, 200) ||
      ids.has(c.id) ||
      !['inherit', 'set', 'none'].includes(c.gameMode) ||
      !['inherit', 'append', 'replace', 'none'].includes(c.briefMode) ||
      !text(c.brief, 20000) ||
      (c.game &&
        (!text(c.game.id, 200) ||
          !c.game.id ||
          !text(c.game.name, 300) ||
          !text(c.game.vocabulary, 10000)))
    )
      throw new Error('Choose a game name and valid video context.');
    ids.add(c.id);
  }
}
