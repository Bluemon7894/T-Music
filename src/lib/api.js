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
  prefetch: (id) => call('prefetch', id),
  status: () => call('status'),
  diagnose: () => call('diagnose'),
  downloads: () => call('downloads'),
  download: (tracks) => call('download', tracks),
  cancelDownload: (id) => call('cancelDownload', id),
  retryDownload: (id) => call('retryDownload', id),
  removeDownload: (ids) => call('removeDownload', ids),
  openDownloads: () => call('openDownloads'),
  onDownloads: (cb) => window.api.onDownloads(cb),
};

export const streamUrl = (id) => `ytm://stream/${id}`;

// IPC errors arrive as "Error invoking remote method 'api': Error: <message>".
export function errorText(e) {
  return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
