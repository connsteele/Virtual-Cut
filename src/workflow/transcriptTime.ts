/** HH:MM:SS.mmm, as the transcript window shows times. */
export const time = (seconds: number) => {
  const total = Math.floor(seconds),
    ms = Math.floor((seconds - total) * 1000);
  return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};
// Row timestamps: hundredths are enough to tell phrases apart; the title keeps milliseconds.
// Rounded first, so 12.1 s reads 12.10 rather than a truncated 12.09.
export const formatTimecode = (seconds: number) =>
  time(Math.round(seconds * 100) / 100 + 0.0005).slice(0, -1);
