// Recommendations from what this account actually listens to. Time spent on a track is the signal,
// so skipped songs barely count, and recent listening counts for more than old listening.
import { dailyOrder } from './util.js';

const DAY = 24 * 60 * 60 * 1000;
const HALF_LIFE_DAYS = 14;
const LIKE_BONUS_SEC = 240;
const MIN_TRACKS_FOR_TASTE = 3;
const SEED_POOL = 10;
const SEEDS = 3;
const MIX_SIZE = 30;
const MAX_PER_ARTIST = 3;
const FRESH_DAYS = 14; // don't recommend what was played this recently

export function tasteProfile(listens, liked, now = Date.now()) {
  const tracks = new Map();
  const artists = new Map();
  const add = (id, track, artist, weight) => {
    const entry = tracks.get(id) || { ...track, id, artist, weight: 0 };
    entry.weight += weight;
    tracks.set(id, entry);
    if (artist) artists.set(artist, (artists.get(artist) || 0) + weight);
  };
  for (const l of listens) {
    const ageDays = Math.max(0, now - l.at) / DAY;
    add(l.id, { title: l.title, thumb: l.thumb }, l.artist, (l.sec || 0) * 0.5 ** (ageDays / HALF_LIFE_DAYS));
  }
  for (const t of liked) add(t.id, { title: t.title, thumb: t.thumb }, t.artists?.[0]?.name || '', LIKE_BONUS_SEC);
  const byWeight = (a, b) => b.weight - a.weight;
  return {
    tracks: [...tracks.values()].sort(byWeight),
    artists: [...artists].map(([name, weight]) => ({ name, weight })).sort(byWeight),
  };
}

export const hasTaste = (profile) => profile.tracks.length >= MIN_TRACKS_FOR_TASTE;

// Favorites to start from today. Rotating through them keeps the mix from repeating.
export const mixSeeds = (profile) => dailyOrder(profile.tracks.slice(0, SEED_POOL), 'mix').slice(0, SEEDS);

export function recentlyPlayedIds(listens, now = Date.now()) {
  return new Set(listens.filter((l) => now - l.at < FRESH_DAYS * DAY).map((l) => l.id));
}

// Songs that show up for several favorites, or come from artists this person plays a lot, rank
// first. Already familiar songs are left out, and no single artist can fill the mix.
export function rankMix(relatedLists, profile, exclude) {
  const topWeight = profile.artists[0]?.weight || 1;
  const affinity = new Map(profile.artists.map((a) => [a.name, a.weight / topWeight]));
  const scored = new Map();
  for (const list of relatedLists) {
    list.forEach((track, rank) => {
      if (!track?.id || exclude.has(track.id)) return;
      const entry = scored.get(track.id) || { track, score: affinity.get(track.artists?.[0]?.name) || 0 };
      entry.score += 1 - rank / list.length;
      scored.set(track.id, entry);
    });
  }
  const perArtist = new Map();
  const mix = [];
  for (const { track } of [...scored.values()].sort((a, b) => b.score - a.score)) {
    const artist = track.artists?.[0]?.name || track.id;
    const count = perArtist.get(artist) || 0;
    if (count >= MAX_PER_ARTIST) continue;
    perArtist.set(artist, count + 1);
    mix.push(track);
    if (mix.length >= MIX_SIZE) break;
  }
  return mix;
}

export const artistsOfTheDay = (profile, count = 2) => dailyOrder(profile.artists.slice(0, 5), 'artists').slice(0, count);
