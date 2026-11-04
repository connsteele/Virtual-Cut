import { useEffect } from 'react';

/**
 * Tells the main process whenever any preview video in this window starts or stops playing,
 * so the picture pass (VC-180) leaves the GPU decoder to playback. Media events don't bubble,
 * so they are caught on the way down.
 */
export function usePreviewPlaying() {
  useEffect(() => {
    const api = window.virtualCut?.project;
    if (!api?.previewPlaying) return;
    let last = false;
    const check = () => {
      const playing = [...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended);
      if (playing === last) return;
      last = playing;
      api.previewPlaying(playing).catch(() => {});
    };
    const events = ['play', 'playing', 'pause', 'ended', 'emptied', 'abort'];
    for (const name of events) document.addEventListener(name, check, true);
    return () => {
      for (const name of events) document.removeEventListener(name, check, true);
      if (last) api.previewPlaying(false).catch(() => {});
    };
  }, []);
}
