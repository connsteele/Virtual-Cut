import { useEffect } from 'react';

/**
 * Run when this window regains focus or becomes visible again, for example to recheck
 * files that were moved or deleted in Explorer while the app was in the background.
 */
export function useWindowFocus(callback: () => void) {
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === 'visible') callback();
    };
    window.addEventListener('focus', callback);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', callback);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [callback]);
}
