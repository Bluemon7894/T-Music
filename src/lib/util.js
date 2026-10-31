import { tr } from './i18n.js';
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
  return h ? tr('{0}시간 {1}분', h, m) : tr('{0}분', m);
}

export function fmtBytes(n) {
  if (!n) return '0 MB';
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return tr('깊은 밤이에요');
  if (h < 11) return tr('좋은 아침이에요');
  if (h < 17) return tr('좋은 오후예요');
  if (h < 21) return tr('좋은 저녁이에요');
  return tr('편안한 밤이에요');
}

// Stable violet-family hue per id, for headers without artwork colour.
export function colorFor(key = '') {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = 240 + (h % 80); // indigo → magenta
  return `hsl(${hue} 55% 42%)`;
}

// The same order all day and a different one tomorrow, so daily picks really change daily.
export function dailyOrder(list, salt = '', date = new Date()) {
  let state = 0;
  for (const c of `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}:${salt}`) state = (state * 31 + c.charCodeAt(0)) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const artistNames = (t) => (t?.artists || []).map((a) => a.name).join(', ');
