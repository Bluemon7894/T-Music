import { isElectron, isAndroid } from './device.js';

function compareVersions(v1, v2) {
  const clean = (v) => String(v || '').replace(/^v/, '').trim();
  const parts1 = clean(v1).split('.').map((p) => parseInt(p, 10) || 0);
  const parts2 = clean(v2).split('.').map((p) => parseInt(p, 10) || 0);
  const max = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < max; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

const fallbackHandlers = {
  checkUpdate: async () => {
    const currentVersion = '0.3.9';
    try {
      const res = await fetch('https://api.github.com/repos/Bluemon7894/T-Music/releases/latest');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const release = await res.json();
      const tagName = release.tag_name || '';
      const latestVersion = tagName.replace(/^v/, '');
      const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

      // Filter for Android APK asset
      const apkAsset = Array.isArray(release.assets)
        ? release.assets.find((a) => a.name && a.name.endsWith('.apk') && (a.state === 'uploaded' || !a.state)) ||
          release.assets.find((a) => a.name && a.name.endsWith('.apk'))
        : null;

      return {
        hasUpdate,
        currentVersion,
        latestVersion,
        tagName,
        releaseName: release.name || tagName,
        releaseNotes: release.body || '',
        releaseUrl: release.html_url,
        downloadUrl: apkAsset ? apkAsset.browser_download_url : (release.html_url || ''),
        assetSize: apkAsset ? apkAsset.size : 0,
        isApk: true,
      };
    } catch (e) {
      return {
        hasUpdate: false,
        currentVersion,
        latestVersion: currentVersion,
        error: e.message,
      };
    }
  },
  downloadUpdate: async () => {
    return true;
  },
  installUpdate: async () => {
    return true;
  },
  openExternal: (url) => {
    if (url && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  },
  status: () => ({ methods: [], version: '0.3.9' }),
  diagnose: () => [],
  downloads: () => [],
  getDiscordRPC: () => false,
  setDiscordRPC: () => false,
  updateDiscordActivity: () => false,
  clearDiscordActivity: () => false,
  getAutoStart: () => false,
  setAutoStart: () => false,
  chooseDownloadsDir: () => null,
  openDownloads: () => {},
  cancelDownload: () => {},
  retryDownload: () => {},
  removeDownload: () => {},
  download: () => {},
  setGithubToken: () => {},
  setTitleBarOverlay: () => {},
  updateTrayTooltip: () => {},
  updateTrayIcon: () => {},
  lyrics: async (track) => {
    try {
      const q = new URLSearchParams({
        track_name: track.title || '',
        artist_name: track.artists?.[0]?.name || track.artists?.[0] || '',
      });
      const res = await fetch(`https://lrclib.net/api/get?${q}`);
      if (res.ok) {
        const data = await res.json();
        return { synced: data.syncedLyrics || null, plain: data.plainLyrics || null };
      }
    } catch {}
    return { synced: null, plain: null };
  },
  prefetch: () => true,
};

const call = (method, ...args) => {
  if (typeof window !== 'undefined' && window.api && typeof window.api.call === 'function') {
    return window.api.call(method, ...args);
  }
  const handler = fallbackHandlers[method];
  if (handler) return handler(...args);
  return Promise.resolve(null);
};

export const api = {
  search: (q) => call('search', q),
  suggest: (q) => call('suggest', q),
  album: (id) => call('album', id),
  artist: (id) => call('artist', id),
  playlist: (id) => call('playlist', id),
  related: (id) => call('related', id),
  home: () => call('home'),
  lyrics: (track) => call('lyrics', track),
  prefetch: (id) => call('prefetch', id),
  status: () => call('status'),
  diagnose: () => call('diagnose'),
  downloads: () => call('downloads'),
  download: (tracks) => call('download', tracks),
  cancelDownload: (id) => call('cancelDownload', id),
  retryDownload: (id) => call('retryDownload', id),
  removeDownload: (ids) => call('removeDownload', ids),
  openDownloads: () => call('openDownloads'),
  chooseDownloadsDir: () => call('chooseDownloadsDir'),
  getDiscordRPC: () => call('getDiscordRPC'),
  setDiscordRPC: (enabled) => call('setDiscordRPC', enabled),
  updateDiscordActivity: (data) => call('updateDiscordActivity', data),
  clearDiscordActivity: () => call('clearDiscordActivity'),
  getAutoStart: () => call('getAutoStart'),
  setAutoStart: (val) => call('setAutoStart', val),
  onDownloads: (cb) => (window.api?.onDownloads ? window.api.onDownloads(cb) : () => {}),
  checkUpdate: () => call('checkUpdate'),
  downloadUpdate: () => call('downloadUpdate'),
  installUpdate: () => call('installUpdate'),
  setGithubToken: (tok) => call('setGithubToken', tok),
  openExternal: (url) => call('openExternal', url),
  setTitleBarOverlay: (opts) => call('setTitleBarOverlay', opts),
  updateTrayTooltip: (text) => call('updateTrayTooltip', text),
  updateTrayIcon: (dataUrl) => call('updateTrayIcon', dataUrl),
  onUpdateProgress: (cb) => (window.api?.onUpdateProgress ? window.api.onUpdateProgress(cb) : () => {}),
  onMediaControl: (cb) => (window.api?.onMediaControl ? window.api.onMediaControl(cb) : () => {}),
};

export const streamUrl = (id) => `ytm://stream/${id}`;

// IPC errors arrive as "Error invoking remote method 'api': Error: <message>".
export function errorText(e) {
  return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
