export interface TimelineViewport {
  start: number;
  end: number;
}
export function fitViewport(
  view: TimelineViewport,
  start: number,
  end: number,
  minimum: number,
): TimelineViewport {
  const full = Math.max(0.001, end - start);
  const span = Math.max(Math.min(minimum, full), Math.min(full, view.end - view.start));
  const left = Math.max(start, Math.min(end - span, view.start));
  return { start: left, end: left + span };
}
export function zoomViewport(
  view: TimelineViewport,
  factor: number,
  anchor: number,
  start: number,
  end: number,
  minimum: number,
) {
  const fraction = Math.max(0, Math.min(1, (anchor - view.start) / (view.end - view.start)));
  const span = Math.max(
    Math.min(minimum, end - start),
    Math.min(end - start, (view.end - view.start) / factor),
  );
  return fitViewport(
    { start: anchor - fraction * span, end: anchor + (1 - fraction) * span },
    start,
    end,
    minimum,
  );
}
