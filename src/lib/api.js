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
  lyricsCandidates: (track, query) => call('lyricsCandidates', track, query),
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
  setGithubToken: (tok) => call('setGithubToken', tok),
  openExternal: (url) => call('openExternal', url),
  setTitleBarOverlay: (opts) => call('setTitleBarOverlay', opts),
  updateTrayTooltip: (text) => call('updateTrayTooltip', text),
  updateTrayIcon: (dataUrl) => call('updateTrayIcon', dataUrl),
  onUpdateProgress: (cb) => window.api?.onUpdateProgress?.(cb) || (() => {}),
  onMediaControl: (cb) => window.api?.onMediaControl?.(cb) || (() => {}),
};

export const streamUrl = (id) => `ytm://stream/${id}`;

// IPC errors arrive as "Error invoking remote method 'api': Error: <message>".
export function errorText(e) {
  return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
