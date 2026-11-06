/**
 * One preview audio track beside the muted video, checked every 50 ms (VC-29 note 28).
 *
 * The video can stall at speed (a 4K decode that can't keep up). Pulling audio that ran ahead
 * back to the picture replays a slice of sound each time, heard as an echo. So the audio waits
 * instead: while the video stalls, or while the track is ahead of it, the track holds (pauses)
 * until the picture catches up. Only a large drift seeks, and a track behind the picture seeks
 * forward, which skips sound but never repeats it.
 */
export type AudioSyncAction = 'seek' | 'hold' | 'release' | 'play';

export function audioSyncStep({
  drift,
  rate,
  stalled,
  holding,
  spaced,
}: {
  /** Audio time minus picture time, in source seconds: positive when the audio is ahead. */
  drift: number;
  rate: number;
  /** The video is waiting for data or has not moved for a moment while playing. */
  stalled: boolean;
  /** The track is held from an earlier step. */
  holding: boolean;
  /** Long enough since this track's last seek to seek again. */
  spaced: boolean;
}): AudioSyncAction {
  // A fixed source-time tolerance shrinks to a few wall-clock milliseconds when fast
  // forwarding and can make the audio seek again on every tick.
  const tolerance = 0.12 * rate;
  if (Math.abs(drift) > Math.max(1, 4 * tolerance)) return spaced ? 'seek' : 'hold';
  if (stalled || drift > tolerance) return 'hold';
  // Release a little early: starting the element takes a moment.
  if (holding) return drift <= 0.05 * rate ? 'release' : 'hold';
  if (drift < -tolerance && spaced) return 'seek';
  return 'play';
}
