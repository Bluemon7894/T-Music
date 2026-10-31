import { tr } from './i18n.js';
import { IS_ANDROID } from './platform.js';

const call = (method, ...args) => window.api.call(method, ...args);

export const api = {
  search: (q) => call('search', q),
  suggest: (q) => call('suggest', q),
  album: (id) => call('album', id),
  artist: (id) => call('artist', id),
  playlist: (id) => call('playlist', id),
  related: (id) => call('related', id),
  home: () => call('home'),
  lyrics: (track) => call('lyrics', track),
  refreshLyrics: (track) => call('refreshLyrics', track),
  setLanguage: (language) => call('setLanguage', language),
  translateLyrics: (lines, target) => call('translateLyrics', lines, target),
  lyricsCandidates: (track, query) => call('lyricsCandidates', track, query),
  cleanLyricsQuery: (track) => call('cleanLyricsQuery', track),
  setCustomLyrics: (trackId, lyricsData) => call('setCustomLyrics', trackId, lyricsData),
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
  getDiscordStatus: () => call('getDiscordStatus'),
  setDiscordClientId: (id) => call('setDiscordClientId', id),
  updateDiscordActivity: (data) => call('updateDiscordActivity', data),
  clearDiscordActivity: () => call('clearDiscordActivity'),
  getAutoStart: () => call('getAutoStart'),
  setAutoStart: (val) => call('setAutoStart', val),
  onDownloads: (cb) => window.api?.onDownloads?.(cb) || (() => {}),
  checkUpdate: () => call('checkUpdate'),
  downloadUpdate: () => call('downloadUpdate'),
  installUpdate: () => call('installUpdate'),
  openExternal: (url) => call('openExternal', url),
  setTitleBarOverlay: (opts) => call('setTitleBarOverlay', opts),
  updateTrayTooltip: (text) => call('updateTrayTooltip', text),
  updateTrayIcon: (dataUrl) => call('updateTrayIcon', dataUrl),
  googleAvailable: () => call('googleAvailable'),
  googleSignIn: () => call('googleSignIn'),
  cancelGoogleSignIn: () => call('cancelGoogleSignIn'),
  copyText: (text) => call('copyText', text),
  shareText: (text) => call('shareText', text),
  saveFile: (name, mime, content) => call('saveFile', name, mime, content),
  setMiniMode: (on) => call('setMiniMode', on),
  showWindow: () => call('showWindow'),
  takeInvite: () => call('takeInvite'),
  onInvite: (cb) => window.api?.onInvite?.(cb) || (() => {}),
  onUpdateProgress: (cb) => window.api?.onUpdateProgress?.(cb) || (() => {}),
  onMediaControl: (cb) => window.api?.onMediaControl?.(cb) || (() => {}),
};

export const streamUrl = (id) => (IS_ANDROID ? `/stream/${id}` : `ytm://stream/${id}`);

// IPC errors arrive as "Error invoking remote method 'api': Error: <message>".
export function errorText(e) {
  return tr(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
}
