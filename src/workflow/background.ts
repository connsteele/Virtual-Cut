/**
 * Start an async UI action without awaiting it. The action's own handler reports expected
 * failures to the user; this only keeps an unexpected rejection from going unhandled.
 */
export function background(task: Promise<unknown> | undefined): void {
  task?.catch((error: unknown) => console.error('Virtual Cut background action failed', error));
}
