// Getting out of trouble without anyone having to do anything. Each step is tried once in a short while,
// so something truly broken ends at a screen that says so instead of restarting forever.
import { IS_ANDROID } from './platform.js';

const CRASH_KEY = 't-music-crash-recovery';
const CRASH_WINDOW_MS = 60 * 1000;
const SAVED_PLAYBACK = 't-music-player';

function recentCrashes() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CRASH_KEY));
    return saved && Date.now() - saved.at < CRASH_WINDOW_MS ? saved.count : 0;
  } catch {
    return 0;
  }
}

// First crash: start the page again. Second in a row: what was saved about playback may be what's
// breaking it, and losing that costs nothing that matters. After that, the crash screen stays up.
export function recoverFromCrash() {
  const count = recentCrashes();
  if (count >= 2) return;
  try {
    sessionStorage.setItem(CRASH_KEY, JSON.stringify({ count: count + 1, at: Date.now() }));
    if (count === 1) localStorage.removeItem(SAVED_PLAYBACK);
  } catch { /* the reload may still help */ }
  window.location.reload();
}

// The phone tells the page when it comes back on screen; a page on a PC can see that for itself.
export function watchForeground() {
  if (!IS_ANDROID) return () => {};
  const onShow = (e) => { if (e.detail?.visible) window.dispatchEvent(new CustomEvent('t-music:foreground')); };
  window.addEventListener('t-music:visibility', onShow);
  return () => window.removeEventListener('t-music:visibility', onShow);
}
