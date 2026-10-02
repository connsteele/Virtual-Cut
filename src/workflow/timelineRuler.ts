/** Elapsed source time, deliberately not frame timecode (sources can be VFR). */
export function positionText(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

export function parsePosition(text: string): number | null {
  const parts = text.trim().split(':');
  if (
    parts.length > 3 ||
    !parts.every((part, i) => (i === parts.length - 1 ? /^\d+(?:\.\d{1,3})?$/ : /^\d+$/).test(part))
  )
    return null;
  const values = parts.map(Number);
  if (values.slice(1).some((value) => value >= 60)) return null;
  const result = values.reduce((total, value) => total * 60 + value, 0);
  return Number.isFinite(result) ? result : null;
}

export function rulerTicks(start: number, end: number, width: number) {
  const span = end - start;
  if (!(span > 0) || !(width > 0)) return [];
  const desired = span / Math.max(1, Math.floor(width / 112));
  const intervals = [
    0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
  ];
  const major = intervals.find((step) => step >= desired) ?? Math.ceil(desired / 3600) * 3600;
  const minor = major / 5;
  const ticks: { time: number; label?: string }[] = [];
  for (let i = Math.ceil(start / minor); i * minor <= end + 1e-8; i++) {
    const at = Number((i * minor).toFixed(6));
    const room = ((end - at) / span) * width;
    const full = positionText(at);
    const clock = at >= 3600 ? full : full.slice(3);
    const label = major < 1 ? clock : clock.slice(0, -4);
    ticks.push({
      time: at,
      label: i % 5 === 0 && room >= label.length * 7 + 8 ? label : undefined,
    });
  }
  return ticks;
}
