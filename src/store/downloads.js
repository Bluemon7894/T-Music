import { create } from 'zustand';
import { api, errorText } from '../lib/api.js';
import { slim } from './library.js';
import { toast } from './ui.js';
import { tr } from '../lib/i18n.js';

// Mirror of the main process download state, pushed over IPC.
export const useDownloads = create((set) => ({
  items: [],
  jobs: [],
  totalSize: 0,
  dir: '',
  done: new Set(),
  active: {}, // id -> job

  apply(state) {
    set({
      ...state,
      done: new Set(state.items.map((i) => i.id)),
      active: Object.fromEntries(state.jobs.map((j) => [j.track.id, j])),
    });
  },
}));

export function initDownloads() {
  api.downloads().then((s) => useDownloads.getState().apply(s)).catch(() => {});
  return api.onDownloads((s) => useDownloads.getState().apply(s));
}

export async function download(tracks) {
  const list = (Array.isArray(tracks) ? tracks : [tracks]).filter(Boolean).map(slim);
  try {
    const added = await api.download(list);
    if (added) toast(added > 1 ? tr('{0}곡 다운로드를 시작합니다', added) : tr('다운로드를 시작합니다'));
    else toast(tr('이미 다운로드했거나 받는 중입니다'));
  } catch (e) {
    toast(errorText(e));
  }
}

export const cancelDownload = (id) => api.cancelDownload(id);
export const retryDownload = (id) => api.retryDownload(id);
export function removeDownload(ids) {
  api.removeDownload(ids);
  toast(tr('다운로드한 파일을 삭제했습니다'));
}
export const openDownloads = () => api.openDownloads();
