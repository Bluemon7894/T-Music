// Whether this device was following a room, so that coming back after the app was killed picks the room
// up again. A phone remembers it across restarts; a PC only across its page reloading after a crash,
// because quitting a PC app is on purpose.
import { IS_ANDROID } from './platform.js';

const KEY = 't-music-following-room';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const store = () => (IS_ANDROID ? localStorage : sessionStorage);

export function rememberFollowing(code) {
  try { store().setItem(KEY, JSON.stringify({ code, at: Date.now() })); } catch { /* it just won't rejoin by itself */ }
}

export function forgetFollowing() {
  try { store().removeItem(KEY); } catch { /* nothing to forget */ }
}

// Browser storage reaches the disk some time after it's written, and a killed app loses the rest. A phone
// has to survive being killed, so what's playing also goes in a file of its own, written straight away.
const PLAYBACK_FILE = 'last-playback.json';

export function rememberPlayback(state) {
  try {
    if (state) window.TMusicNative?.fsWrite(PLAYBACK_FILE, JSON.stringify(state));
    else window.TMusicNative?.fsDelete(PLAYBACK_FILE);
  } catch { /* localStorage still has something close */ }
}

export function lastPlayback() {
  if (!IS_ANDROID) return null;
  try {
    return JSON.parse(window.TMusicNative?.fsRead(PLAYBACK_FILE));
  } catch {
    return null;
  }
}

export function followingCode() {
  try {
    const saved = JSON.parse(store().getItem(KEY));
    return saved && Date.now() - saved.at < MAX_AGE_MS ? saved.code : null;
  } catch {
    return null;
  }
}
