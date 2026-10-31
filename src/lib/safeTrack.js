const shorten = (value, max) => String(value || '').slice(0, max);
const TRUSTED_THUMB = /^https:\/\/([\w-]+\.)*(ytimg\.com|ggpht\.com|googleusercontent\.com)\//;

// Rooms and shared playlists hold tracks written by other people's computers:
// keep only what we expect before using them.
export function safeTrack(t) {
  if (!t || !/^[\w-]{11}$/.test(t.id)) return null;
  return {
    id: t.id,
    title: shorten(t.title, 200) || '제목 없음',
    artists: (Array.isArray(t.artists) ? t.artists : Object.values(t.artists || {})).slice(0, 8).map((a) => ({ name: shorten(a?.name, 100), id: /^[\w-]+$/.test(a?.id || '') ? a.id : null })),
    album: null,
    duration: Number(t.duration) || 0,
    thumb: TRUSTED_THUMB.test(t.thumb || '') ? t.thumb : null,
  };
}
