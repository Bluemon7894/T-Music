export function fmtTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function totalTime(tracks) {
  const sec = tracks.reduce((n, t) => n + (t.duration || 0), 0);
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}시간 ${m}분` : `${m}분`;
}

export function fmtBytes(n) {
  if (!n) return '0 MB';
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '깊은 밤이에요';
  if (h < 11) return '좋은 아침이에요';
  if (h < 17) return '좋은 오후예요';
  if (h < 21) return '좋은 저녁이에요';
  return '편안한 밤이에요';
}

// Stable violet-family hue per id, for headers without artwork colour.
export function colorFor(key = '') {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = 240 + (h % 80); // indigo → magenta
  return `hsl(${hue} 55% 42%)`;
}

export const artistNames = (t) => (t?.artists || []).map((a) => a.name).join(', ');
