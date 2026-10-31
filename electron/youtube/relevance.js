// How much of what the user typed a search result actually accounts for, from 0 to 1.
// Popularity must never lift a result that has nothing to do with the query.
import { norm, aliasesOf, dice } from '../lyrics/match.js';

function piecesOf(fields) {
  const out = new Set();
  for (const f of fields.filter(Boolean)) {
    const raw = String(f);
    out.add(norm(raw));
    for (const al of aliasesOf(raw.trim())) out.add(norm(al));
    for (const part of raw.split(/[()[\]{}|/_,&·:~]+|\s-\s/)) {
      const n = norm(part);
      if (n) out.add(n);
      for (const al of aliasesOf(part.trim())) out.add(norm(al));
    }
  }
  out.delete('');
  return [...out];
}

export function relevance(query, fields) {
  const whole = norm(query);
  if (!whole) return 0;
  const pieces = piecesOf(fields);
  if (!pieces.length) return 0;
  if (pieces.includes(whole)) return 1;
  const joined = pieces.join(' ');
  if (joined.includes(whole)) return 0.95;

  // Word by word: "REAL 아이유" should keep the artist's songs even without the album name.
  const words = String(query).trim().split(/\s+/).map((raw) => ({ raw, w: norm(raw) })).filter((x) => x.w);
  let hit = 0;
  for (const { raw, w } of words) {
    const forms = [w, ...[...aliasesOf(raw)].map(norm)];
    if (forms.some((f) => joined.includes(f)) || pieces.some((p) => dice(w, p) >= 0.75)) hit++;
  }
  const byWords = words.length ? hit / words.length : 0;

  // Queries typed without spaces ("아이유좋은날"): count the part each field explains.
  let left = whole;
  let covered = 0;
  for (const p of [...pieces].sort((a, b) => b.length - a.length)) {
    if (p.length >= 2 && left.includes(p)) {
      left = left.replace(p, '');
      covered += p.length;
    }
  }

  const fuzzy = Math.max(0, ...pieces.map((p) => dice(whole, p))) * 0.9;
  return Math.max(byWords, covered / whole.length, fuzzy >= 0.6 ? fuzzy : 0);
}

export const trackRelevance = (q, t) => relevance(q, [t.rawTitle, t.title, ...(t.artists || []).map((a) => a.name), t.album?.name]);
export const albumRelevance = (q, a) => relevance(q, [a.title, ...(a.artists || []).map((x) => x.name)]);
export const playlistRelevance = (q, p) => relevance(q, [p.title, p.author]);
export const artistRelevance = (q, a) => relevance(q, [a.name]);

// Items worth showing at all, best fit first; YouTube's order breaks ties.
export function keepRelevant(list, q, rel, min = 0.5) {
  return list
    .map((item, i) => ({ item, i, r: rel(q, item) }))
    .filter((x) => x.r >= min)
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.item);
}
