// A track's album cover, for videos YouTube has no picture for (audio-only "art tracks" often come
// without one). YouTube Music knows the album art even then. Runs on desktop and inside the Android app.
import { getClient } from './client.js';

const cache = new Map();
const MAX = 500;

export async function trackArt(videoId) {
  if (!/^[\w-]{11}$/.test(videoId)) return null;
  if (cache.has(videoId)) return cache.get(videoId);
  let url = null;
  try {
    const yt = await getClient();
    const info = await yt.music.getInfo(videoId);
    const thumbs = info?.basic_info?.thumbnail || [];
    const best = [...thumbs].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    url = best?.url || null;
    // The 120x90 grey picture again is no better than nothing.
    if (url && /i\.ytimg\.com\/vi\/[\w-]+\/(hq|mq|sd|maxres)?default/.test(url) && (best.width || 0) <= 120) url = null;
  } catch { /* none */ }
  if (cache.size > MAX) cache.delete(cache.keys().next().value);
  cache.set(videoId, url);
  return url;
}
