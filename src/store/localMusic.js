// Music files already on this device (electron/localMusic.js on a computer, LocalMusic.java on a phone).
// They play like any other track but never leave the device: no history, no rooms, no downloads.
import { create } from 'zustand';
import { api } from '../lib/api.js';
import { isLocalId } from '../../electron/localId.js';
import { toast } from './ui.js';
import { tr } from '../lib/i18n.js';

export { isLocalId };

export const useLocalMusic = create((set) => ({
  enabled: false,
  folder: null,
  tracks: [],
  ids: new Set(),
  busy: false,
  loaded: false,

  apply(state) {
    const tracks = Array.isArray(state?.tracks) ? state.tracks : [];
    set({ enabled: Boolean(state?.enabled), folder: state?.folder || null, tracks, ids: new Set(tracks.map((t) => t.id)), busy: false, loaded: true });
  },
}));

const apply = (state) => useLocalMusic.getState().apply(state);
const failed = (e) => {
  console.warn('[local music]', e);
  useLocalMusic.setState({ busy: false, loaded: true });
};

export function initLocalMusic() {
  api.localMusic().then(apply).catch(failed);
  // Files added while the app was in the background show up when it comes back.
  const again = () => { if (useLocalMusic.getState().enabled) api.refreshLocalMusic().then(apply).catch(failed); };
  window.addEventListener('t-music:foreground', again);
  return () => window.removeEventListener('t-music:foreground', again);
}

export async function enableLocalMusic(on = true) {
  useLocalMusic.setState({ busy: true });
  try {
    const state = await api.enableLocalMusic(on);
    apply(state);
    if (on && !state?.enabled) toast(tr('음악 파일을 읽을 권한이 없어요. 설정에서 허용하면 불러올 수 있어요.'));
  } catch (e) {
    failed(e);
  }
}

export async function chooseMusicFolder() {
  useLocalMusic.setState({ busy: true });
  try { apply(await api.chooseMusicFolder()); } catch (e) { failed(e); }
}

export async function refreshLocalMusic() {
  useLocalMusic.setState({ busy: true });
  try { apply(await api.refreshLocalMusic()); } catch (e) { failed(e); }
}

// A file from another device, saved in a playlist or liked there, that can't play here.
export const missingHere = (track) => isLocalId(track?.id) && !useLocalMusic.getState().ids.has(track.id);
