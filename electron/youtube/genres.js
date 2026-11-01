// YouTube doesn't say what genre anything is. Apple's public catalog does, per artist, and asks for no key.
const TIMEOUT_MS = 5000;
const known = new Map();

async function genreOf(name) {
  if (known.has(name)) return known.get(name);
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=1&country=KR`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const genre = (await res.json())?.results?.[0]?.primaryGenreName || null;
  known.set(name, genre);
  return genre;
}

export async function artistGenres(names) {
  const list = (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && n).slice(0, 12);
  const found = await Promise.allSettled(list.map(genreOf));
  return Object.fromEntries(list.map((name, i) => [name, found[i].status === 'fulfilled' ? found[i].value : null]));
}
