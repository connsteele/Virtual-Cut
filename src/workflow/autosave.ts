export interface AutosaveSettings {
  minutes: number;
  afterEdits: boolean;
}
export const autosaveKey = 'virtual-cut-autosave-v1';
export function autosaveSettings(value: unknown): AutosaveSettings {
  const input = value as Partial<AutosaveSettings> | null;
  return {
    minutes:
      Number.isInteger(input?.minutes) && input!.minutes! >= 1 && input!.minutes! <= 120
        ? input!.minutes!
        : 10,
    afterEdits: input?.afterEdits === true,
  };
}
export function autosaveDue(
  settings: AutosaveSettings,
  now: number,
  savedAt: number,
  lastInteraction: number,
  active: boolean,
  dirty: boolean,
  edited: boolean,
) {
  return (
    dirty &&
    !active &&
    now - lastInteraction >= 2000 &&
    (now - savedAt >= settings.minutes * 60000 || (settings.afterEdits && edited))
  );
}
