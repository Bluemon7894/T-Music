import { create } from 'zustand';
import { api } from '../lib/api.js';
import { toast } from './ui.js';

export const useUpdater = create((set, get) => ({
  checking: false,
  hasUpdate: false,
  currentVersion: '',
  latestVersion: '',
  releaseName: '',
  releaseNotes: '',
  releaseUrl: '',
  downloadUrl: '',
  assetSize: 0,
  downloading: false,
  downloaded: false,
  progress: { percent: 0, received: 0, total: 0 },
  error: null,
  modalOpen: false,
  lastChecked: null,

  init: () => {
    const savedToken = localStorage.getItem('tmusic_github_token');
    if (savedToken) api.setGithubToken(savedToken).catch(() => {});

    // Register progress listener
    api.onUpdateProgress((data) => {
      if (data.status === 'downloading') {
        set({
          downloading: true,
          progress: {
            percent: data.percent || 0,
            received: data.received || 0,
            total: data.total || 0,
          },
        });
      } else if (data.status === 'completed') {
        set({
          downloading: false,
          downloaded: true,
          progress: { percent: 100, received: data.total || 0, total: data.total || 0 },
        });
        toast('업데이트 다운로드가 완료되었습니다!');
      } else if (data.status === 'error') {
        set({ downloading: false, error: data.error });
        toast(`업데이트 다운로드 실패: ${data.error || '오류 발생'}`);
      }
    });

    // Initial check after short delay on app start
    setTimeout(() => {
      get().check(true);
    }, 2500);
  },

  check: async (silent = false) => {
    if (get().checking) return;
    set({ checking: true, error: null });
    try {
      const res = await api.checkUpdate();
      set({
        checking: false,
        lastChecked: Date.now(),
        hasUpdate: Boolean(res.hasUpdate),
        currentVersion: res.currentVersion || '',
        latestVersion: res.latestVersion || '',
        releaseName: res.releaseName || '',
        releaseNotes: res.releaseNotes || '',
        releaseUrl: res.releaseUrl || '',
        downloadUrl: res.downloadUrl || '',
        assetSize: res.assetSize || 0,
        downloaded: Boolean(res.downloaded),
      });

      if (res.hasUpdate) {
        set({ modalOpen: true });
      } else if (!silent) {
        toast(`현재 최신 버전(v${res.currentVersion})을 사용하고 있습니다.`);
      }
    } catch (err) {
      set({ checking: false, error: err.message });
      if (!silent) {
        toast('업데이트 확인 실패: ' + err.message);
      }
    }
  },

  download: async () => {
    const { downloading, downloaded } = get();
    if (downloading) return;
    if (downloaded) {
      return get().install();
    }
    set({ downloading: true, error: null });
    try {
      await api.downloadUpdate();
    } catch (err) {
      set({ downloading: false, error: err.message });
      toast('업데이트 다운로드 실패: ' + err.message);
    }
  },

  install: async () => {
    try {
      await api.installUpdate();
    } catch (err) {
      toast('업데이트 설치 실패: ' + err.message);
    }
  },

  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),

  openReleasePage: () => {
    const { releaseUrl } = get();
    api.openExternal(releaseUrl || 'https://github.com/Bluemon7894/T-Music/releases/latest');
  },

  setToken: (token) => {
    if (token) localStorage.setItem('tmusic_github_token', token);
    else localStorage.removeItem('tmusic_github_token');
    api.setGithubToken(token).catch(() => {});
  },
}));
