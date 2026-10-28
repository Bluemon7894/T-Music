const call = (method, ...args) => window.api.call(method, ...args);

export const api = {
  search: (q) => call('search', q),
  suggest: (q) => call('suggest', q),
  album: (id) => call('album', id),
  artist: (id) => call('artist', id),
  playlist: (id) => call('playlist', id),
  related: (id) => call('related', id),
  home: () => call('home'),
  prefetch: (id) => call('prefetch', id),
  status: () => call('status'),
  diagnose: () => call('diagnose'),
};

export const streamUrl = (id) => `ytm://stream/${id}`;

// IPC errors arrive as "Error invoking remote method 'api': Error: <message>".
export function errorText(e) {
  return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
