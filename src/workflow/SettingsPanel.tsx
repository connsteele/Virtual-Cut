import { useState } from 'react';
import s from './Workflow.module.css';

/** App-wide settings live in this browser profile, beside the other viewer preferences. */
const fastScrubKey = 'virtual-cut.fast-scrub';

/** Fastest scrubbing (VC-202): keyframes on every scrub move, as in 0.4.30-53. Off by default. */
export function fastScrubbing() {
  try {
    return localStorage.getItem(fastScrubKey) === 'true';
  } catch {
    return false;
  }
}

/** The Settings dialog's content, opened from the bottom bar (VC-202). */
export function SettingsContent() {
  const [fast, setFast] = useState(fastScrubbing);
  return (
    <div className={s.help} data-settings>
      <h3>Scrubbing</h3>
      <div className={s.settingsOption}>
        <label>
          <input
            type="checkbox"
            id="settings-fast-scrub"
            checked={fast}
            onChange={(e) => {
              setFast(e.target.checked);
              try {
                localStorage.setItem(fastScrubKey, String(e.target.checked));
              } catch {
                /* Unsaved: the choice lasts until the window closes. */
              }
            }}
          />
          <strong>Fastest scrubbing</strong>
        </label>
        <details>
          <summary>What this does</summary>
          <p>
            Shows keyframes on every move while you drag, so the picture keeps up even on a fast
            sweep across a 4K recording. When you hold still, the picture can jump to the exact
            frame, up to half a keyframe interval away (0.5 s on recordings with a keyframe every
            second). Off: slow drags show exact frames and only fast sweeps use keyframes.
          </p>
        </details>
      </div>
      <p className={s.muted}>Saved on this computer for every project.</p>
    </div>
  );
}
