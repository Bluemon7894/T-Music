import { tr } from './i18n.js';
const shorten = (value, max) => String(value || '').slice(0, max);
const TRUSTED_THUMB = /^https:\/\/([\w-]+\.)*(ytimg\.com|ggpht\.com|googleusercontent\.com)\//;

const TRUSTED_PHOTO = /^https:\/\/([\w-]+\.)*(googleusercontent\.com|ggpht\.com|ytimg\.com)\//;
const OWN_PHOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
export const MAX_PHOTO = 20000; // the database refuses more

// Loading a picture from an address someone else chose would reveal our IP address to them. A picture
// carried in the text itself isn't loaded from anywhere.
export const safePhoto = (url) => (TRUSTED_PHOTO.test(url || '') || (String(url || '').length <= MAX_PHOTO && OWN_PHOTO.test(url || '')) ? url : null);

// Rooms and shared playlists hold tracks written by other people's computers:
// keep only what we expect before using them.
export function safeTrack(t) {
  if (!t || !/^[\w-]{11}$/.test(t.id)) return null;
  return {
    id: t.id,
    title: shorten(t.title, 200) || tr('제목 없음'),
    artists: (Array.isArray(t.artists) ? t.artists : Object.values(t.artists || {})).slice(0, 8).map((a) => ({ name: shorten(a?.name, 100), id: /^[\w-]+$/.test(a?.id || '') ? a.id : null })),
    album: null,
    duration: Number(t.duration) || 0,
    thumb: TRUSTED_THUMB.test(t.thumb || '') ? t.thumb : null,
  };
}
