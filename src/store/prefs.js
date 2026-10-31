// Small preferences from the Convenience card in settings. They belong to this device.
import { create } from 'zustand';
import { setCalmMotion } from '../lib/motion.js';

const KEY = 't-music-prefs';

const saved = (() => {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
})();

function apply({ lyricSize, calmMotion }) {
  document.documentElement.dataset.lyricSize = lyricSize;
  document.documentElement.dataset.motion = calmMotion ? 'calm' : 'full';
  setCalmMotion(calmMotion);
}

export const usePrefs = create((set, get) => ({
  resumeOnLaunch: saved.resumeOnLaunch === true,
  lyricSize: ['small', 'normal', 'large'].includes(saved.lyricSize) ? saved.lyricSize : 'normal',
  calmMotion: saved.calmMotion === true,

  setPref(patch) {
    set(patch);
    const { resumeOnLaunch, lyricSize, calmMotion } = get();
    apply({ lyricSize, calmMotion });
    try { localStorage.setItem(KEY, JSON.stringify({ resumeOnLaunch, lyricSize, calmMotion })); } catch { /* it still applies this session */ }
  },
}));

apply(usePrefs.getState());
