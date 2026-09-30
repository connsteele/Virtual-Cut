import { useEffect, useState } from 'react';
export function JobTime({
  started,
  elapsedMs,
  running = false,
}: {
  started?: string;
  elapsedMs?: number;
  running?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const ms = running && started ? Math.max(elapsedMs ?? 0, now - Date.parse(started)) : elapsedMs;
  if (ms == null) return <span title="This older job did not record processing time">—</span>;
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return (
    <span title="Processing time for this attempt; excludes time waiting in the queue">
      {ms < 1000
        ? '<1s'
        : seconds >= 60
          ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
          : `${seconds}s`}
    </span>
  );
}
