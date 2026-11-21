// Catalog: search, album/artist/playlist pages, related tracks, home feed.
// Logged-out YT Music in Korea omits songs, home and radio, so those parts are
// filled from regular YouTube.
import { call, resetClient, setMarket } from './client.js';
import * as P from './parse.js';
import { relevance, trackRelevance, albumRelevance, playlistRelevance, artistRelevance, keepRelevant } from './relevance.js';

const memo = new Map();
async function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await fn();
  memo.set(key, { value, until: Date.now() + ttlMs });
  if (memo.size > 300) memo.delete(memo.keys().next().value);
  return value;
}

const MIN = 60 * 1000;
const VIDEOS_ONLY = 'EgIQAQ%3D%3D';
const FEW_PLAYLIST_TRACKS = 20;
let homeShelves = null;
const HOME_SHELF_MAX = 16;
const MAX_PLAYLIST_PAGES = 5;
const INSTRUMENTAL = /\binst\b|instrumental|\bMR\b|반주/i;
const MINOR_VIEWS = 50;

function uniqueBy(list, key = (x) => x.id) {
  const seen = new Set();
  return list.filter((x) => {
    const k = key(x);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const squash = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// One channel often uploads a recording twice, as audio and as a video.
function uniqueRecordings(tracks) {
  const kept = [];
  return tracks.filter((t) => {
    const twin = kept.some((k) => squash(k.title) === squash(t.title)
      && squash(k.artists?.[0]?.name) === squash(t.artists?.[0]?.name)
      && Math.abs(k.duration - t.duration) <= 1);
    if (!twin) kept.push(t);
    return !twin;
  });
}

// ---- whose song it is ----
// Signed out in Korea, YouTube Music won't say which upload is the official song, so it's worked out
// from the uploads themselves. Lyric videos, broadcasts and MV uploads name the artist ("이찬혁 -
// 멸종위기사랑", "[성시경 노래] …", "성시경 _ …"), and official channels name themselves. A cover
// singer is seldom named by anyone else's upload. Weighted by how many people watched, the name that
// keeps coming up is the song's owner.
const NOT_A_NAME = /방송|버전|ver(sion)?\b|cover|커버|가사|lyrics?|노래방|karaoke|\bmr\b|inst|audio|m\/?v\b|teaser|직캠|fancam|\bost\b|full|live|라이브|playlist|모음|reaction|리액션|official|공식|topic|채널|channel/i;

// "이찬혁 (LEE CHANHYUK)" → 이찬혁, leechanhyuk. "이지금 [IU Official]" → 이지금, iu.
function nameVariants(name) {
  return String(name || '')
    .replace(/\b(official|topic|channel)\b|공식|채널/gi, ' ')
    .split(/[()[\]{}/&,·|]|\s+x\s+|\bfeat\.?|\bft\./i)
    .flatMap((piece) => piece.match(/[\p{Script=Hangul}\d][\p{Script=Hangul}\d\s]*|[\p{Script=Latin}\d][\p{Script=Latin}\d\s.'-]*/gu) || [])
    .map(squash)
    .filter((v) => v.length >= 2 && !NOT_A_NAME.test(v));
}

// The artist names a title gives besides the song's own name.
function namesInTitle(raw, query) {
  const title = squash(query);
  const s = String(raw || '').replace(/【([^】]*)】/g, '$1 - ').replace(/\s\|\s.*$/, '');
  const out = [];
  const tagged = s.match(/\[([^\]]+?)\s*(?:의\s*)?노래\]/);
  if (tagged) out.push(tagged[1]);
  const parts = s.replace(/\[[^\]]*\]/g, ' ').split(/\s+[-–—_]\s*|\s*[-–—_]\s+|\s*[–—]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    for (const part of parts.slice(0, 2)) {
      const p = squash(part);
      if (p && part.length <= 40 && !p.includes(title) && !title.includes(p)) out.push(part);
    }
  }
  return out;
}

// The owner's group of names, and each track's own groups. Names said together ("이찬혁 (LEE
// CHANHYUK)", an official channel and the artist its title names) are one artist.
function songOwner(tracks, query) {
  const parent = new Map();
  const root = (v) => { while (parent.get(v) !== v) v = parent.get(v); return v; };
  const join = (vs) => {
    vs.forEach((v) => { if (!parent.has(v)) parent.set(v, v); });
    for (let i = 1; i < vs.length; i++) parent.set(root(vs[i]), root(vs[0]));
  };
  const namesOf = tracks.map((t) => {
    const own = t.topic || t.officialArtist ? [t.artists?.[0]?.name] : [];
    const said = namesInTitle(t.rawTitle || t.title, query);
    const groups = [...own, ...said].map(nameVariants).filter((g) => g.length);
    groups.forEach(join);
    if (own.length && groups.length > 1) join(groups.flat()); // an official channel and the artist it names
    return groups.flat();
  });
  const weight = new Map();
  tracks.forEach((t, i) => {
    for (const r of new Set(namesOf[i].map(root))) weight.set(r, (weight.get(r) || 0) + Math.log10((t.views || 0) + 10));
  });
  // An artist named in the search itself is the one meant ("멜로망스 취중고백").
  const asked = squash(query);
  // Only part of it, though: a channel that is just the song's name ("Supernova") names nobody.
  const named = new Set([...parent.keys()].filter((v) => v.length >= 2 && asked.includes(v) && asked.replace(v, '').length >= 2).map(root));
  let owner = null;
  for (const r of weight.keys()) {
    const ahead = !owner || Number(named.has(r)) - Number(named.has(owner)) || weight.get(r) - weight.get(owner);
    if (ahead === true || ahead > 0) owner = r;
  }
  return { owns: (i) => owner != null && namesOf[i].some((v) => root(v) === owner) };
}

// Sort into score bands, keeping YouTube's relevance order within a band.
const band = (s) => (s >= 3 ? 2 : s >= 0 ? 1 : 0);
function rank(tracks) {
  return tracks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => band(b.t.score) - band(a.t.score) || a.i - b.i)
    .map((x) => x.t);
}

// YouTube gives each session its own layout and keeps it. When a search comes back full of
// entries and none can be read, this session got a layout that's new to us: the search is asked
// again on a fresh session, which most likely gets one we know. At most once a minute, so a
// change that reaches everyone can't make every search take two trips.
const FRESH_SESSION_GAP_MS = MIN;
// One search sends two of these at once; the one that finishes second uses the new session too.
const JUST_RENEWED_MS = 10 * 1000;
const UNREADABLE_AT = 3;
let freshSessionAt = 0;

// `asked` is what goes to YouTube; results are scored against what the person typed.
async function videoSearch(asked, query = asked) {
  const d = await call('/search', { client: 'WEB', query: asked, params: VIDEOS_ONLY });
  const { all, readable } = P.searchEntries(d);
  const since = Date.now() - freshSessionAt;
  const justRenewed = since < JUST_RENEWED_MS;
  if (readable || all < UNREADABLE_AT || (!justRenewed && since < FRESH_SESSION_GAP_MS)) return P.searchVideos(d, query);
  if (!justRenewed) {
    freshSessionAt = Date.now();
    console.warn("[search] nothing readable in this session's results, trying a fresh session");
    resetClient();
  }
  return P.searchVideos(await call('/search', { client: 'WEB', query: asked, params: VIDEOS_ONLY }), query);
}

async function webSongs(query, limit = 20) {
  const vids = await videoSearch(query);
  return rank(vids.filter((t) => t.score >= -3)).slice(0, limit);
}

// Auto-generated "Artist - Topic" uploads carry this line in their description,
// so adding it to the query surfaces official studio audio instead of MVs/covers.
async function officialAudio(query, limit = 20) {
  const tracks = (await videoSearch(`${query} "Provided to YouTube"`, query))
    .filter((t) => t.topic || t.score >= 1)
    // "Release - Topic" mirrors whole albums with barely any listeners and no artist name.
    .filter((t) => !(t.topic && t.artists[0]?.name === 'Release'))
    // Noisy titles (karaoke, instrumentals) and near-zero view uploads score under 3.
    .map((t) => ({ ...t, studioAudio: Boolean((t.topic || t.officialArtist) && t.score >= 3) }))
    .slice(0, limit);
  // YouTube's first artist upload is its best guess, and it sees past typos and translated
  // titles ("10CM 그라데이션" finds "Gradation"), which comparing text can't.
  // An artist's own release often sits on its auto-generated Topic channel, which carries no badge.
  const [first, second] = tracks.filter((t) => (t.officialArtist || t.topic) && t.score >= 3 && !INSTRUMENTAL.test(t.title) && !P.isLiveTitle(t.title));
  // A much better known second result wins ("좋은날" has an obscure song of that exact name too).
  const pick = second && second.score >= first.score + 3 ? second : first;
  if (pick) pick.ytPick = true;
  return tracks;
}

// The highlighted top result YT Music shows above the list.
function parseCard(d) {
  const card = P.find(d, 'musicCardShelfRenderer');
  if (!card) return null;
  const run = card.title?.runs?.[0];
  const nav = run?.navigationEndpoint;
  const browseId = nav?.browseEndpoint?.browseId;
  const th = P.thumb(P.find(card.thumbnail, 'thumbnails'));
  if (browseId?.startsWith('UC')) return { kind: 'artist', id: browseId, name: run.text, thumb: th, subtitle: '아티스트' };
  if (browseId?.startsWith('MPRE')) return { kind: 'album', id: browseId, title: run.text, artists: [], type: '앨범', thumb: th };
  return null;
}

export function search(query) {
  return cached('search:' + query, 10 * MIN, async () => {
    const [ytm, official, web] = await Promise.allSettled([
      call('/search', { client: 'YTMUSIC', query }),
      officialAudio(query, 20),
      webSongs(query, 30),
    ]);
    const ok = (r) => (r.status === 'fulfilled' ? r.value : null);
    [ytm, official, web].forEach((r, i) => r.status === 'rejected' && console.warn(`[search] part ${i} failed:`, r.reason?.message));
    const items = ok(ytm)
      ? P.findAll(ytm.value, 'musicResponsiveListItemRenderer').map((r) => P.parseResponsive(r)).filter(Boolean)
      : [];
    const of = (kind) => uniqueBy(items.filter((i) => i.kind === kind));
    
    const ytmSongs = of('track').filter((t) => t.duration > 0);

    const candidates = uniqueBy([
      ...(ok(official) || []),
      ...(ok(web) || []),
      ...ytmSongs,
    ]);

    // Karaoke and other junk stay below everything real, however well their long titles match.
    // Then relevance decides. Among equally fitting results the studio recording beats its
    // music video, and only then does popularity count.
    const fitBand = (r) => (r >= 0.95 ? 3 : r >= 0.75 ? 2 : r >= 0.5 ? 1 : 0);
    const flag = (v) => (v ? 1 : 0);
    const wantsInstrumental = INSTRUMENTAL.test(query);
    const wantsLive = P.isLiveTitle(query);
    const scored = candidates.map((t) => ({ t, r: trackRelevance(query, t) }));
    const literal = scored.filter((x) => x.r >= 0.95 && (x.t.score ?? 0) >= 0);
    // YouTube's pick only outranks results that literally match when one of them confirms it's
    // the same song under another name ("Gradation" inside "10CM _ Gradation(그라데이션)").
    const confirmedAlias = (t) => squash(t.title).length >= 3 && literal.some((x) => squash(x.t.rawTitle || x.t.title).includes(squash(t.title)));
    const trustPick = (t) => !literal.length || confirmedAlias(t);
    // A pick whose title shares no words with the search still fits when a literal match names it too:
    // "멸종위기사랑" is officially "Endangered Love", and "LEE CHANHYUK - 멸종위기사랑 (Endangered Love)" says so.
    const fitted = scored.map(({ t, r }) => {
      if (t.ytPick && !trustPick(t)) t = { ...t, ytPick: false };
      return { t, r: t.ytPick && (r >= 0.5 || confirmedAlias(t)) ? Math.max(r, 0.95) : r };
    });
    // Among versions that fit equally well, one with a fiftieth of the best known one's views is a cover
    // or a re-upload, however official its channel looks ("좋은날" by a small singer over IU's).
    // The song's own artist goes first: their release, then the rest of theirs, then covers and other
    // songs that share the name.
    const matching = fitted.filter((x) => fitBand(x.r) === 3 && (x.t.score ?? 0) >= 0);
    const { owns } = songOwner(matching.map((x) => x.t), query);
    const owned = new Set(matching.filter((_, i) => owns(i)));
    // Someone else's version with a fiftieth of the best known one's views is a cover or a re-upload,
    // however official its channel looks ("좋은날" by a small singer over IU's). The owner's own release
    // is never that, though a lyric video of it may well have more views.
    const bestViews = {};
    for (const x of fitted) if ((x.t.score ?? 0) >= 0) bestViews[fitBand(x.r)] = Math.max(bestViews[fitBand(x.r)] || 0, x.t.views || 0);
    const minor = (x) => !owned.has(x) && (x.t.views || 0) > 0 && x.t.views * MINOR_VIEWS < (bestViews[fitBand(x.r)] || 0);
    // Then the song as released: not an instrumental or a live take unless asked for, from an official
    // channel, the studio recording before its video.
    const officialChannel = (t) => t.topic || t.officialArtist;
    const rated = fitted
      .sort((a, b) => flag((b.t.score ?? 0) >= 0) - flag((a.t.score ?? 0) >= 0)
        || fitBand(b.r) - fitBand(a.r)
        || flag(owned.has(b)) - flag(owned.has(a))
        || flag(!minor(b)) - flag(!minor(a))
        || flag(!INSTRUMENTAL.test(b.t.title) || wantsInstrumental) - flag(!INSTRUMENTAL.test(a.t.title) || wantsInstrumental)
        || flag(!P.isLiveTitle(b.t.title) || wantsLive) - flag(!P.isLiveTitle(a.t.title) || wantsLive)
        || flag(officialChannel(b.t)) - flag(officialChannel(a.t))
        || flag(b.t.studioAudio) - flag(a.t.studioAudio)
        || flag(b.t.ytPick) - flag(a.t.ytPick)
        || (b.t.score ?? 0) - (a.t.score ?? 0)
        || (b.t.views ?? 0) - (a.t.views ?? 0));
    // Hour-long compilations aren't songs unless that's what was asked for.
    const wantsLong = /모음|연속|playlist|mix|full\s*album|1\s*시간|1\s*hour/i.test(query);
    const songLike = rated.filter((x) => wantsLong || !x.t.duration || x.t.duration <= 600);
    let fitting = songLike.filter((x) => x.r >= 0.5);
    // Misspelled or descriptive searches match nothing literally; trust YouTube's own picks then.
    if (!fitting.length) fitting = songLike.filter((x) => (x.t.score ?? 0) >= 1).slice(0, 10);
    const songs = uniqueRecordings(fitting.map((x) => P.strip(x.t)));

    const card = ok(ytm) ? parseCard(ytm.value) : null;
    let artistList = of('artist');
    if (card?.kind === 'artist') artistList = uniqueBy([card, ...artistList]);
    const artists = keepRelevant(artistList, query, artistRelevance);
    const albums = keepRelevant(of('album'), query, albumRelevance);
    const playlists = keepRelevant(
      of('playlist').filter((p) => !/개인|사용자|user|cover|커버/i.test(p.author || '')),
      query,
      playlistRelevance,
    );

    // Top result: whatever explains the query best. On a tie an artist only wins if YT Music
    // itself highlighted them; otherwise "Blinding Lights" finds an obscure act of that name.
    const contenders = [
      artists[0] && { item: artists[0], r: artistRelevance(query, artists[0]), rank: card?.id === artists[0].id ? 3 : 0 },
      songs[0] && { item: songs[0], r: fitting[0].r, rank: 2 },
      albums[0] && { item: albums[0], r: relevance(query, [albums[0].title]), rank: 1 },
    ].filter(Boolean).sort((a, b) => b.r - a.r || b.rank - a.rank);
    const top = contenders[0]?.item || null;

    if (!songs.length && !artists.length && !albums.length && !playlists.length && [ytm, official, web].every((r) => r.status === 'rejected')) {
      throw new Error('검색에 실패했습니다. 인터넷 연결을 확인하세요.');
    }
    return { top, songs, artists, albums, playlists };
  });
}

export async function suggest(input) {
  if (!input.trim()) return [];
  const d = await call('/music/get_search_suggestions', { client: 'YTMUSIC', input });
  return P.findAll(d, 'searchSuggestionRenderer').map((r) => P.text(r.suggestion)).filter(Boolean).slice(0, 8);
}

function headerOf(d) {
  return P.find(d, 'musicResponsiveHeaderRenderer')
    || P.find(d, 'musicDetailHeaderRenderer')
    || P.find(d, 'musicEditablePlaylistDetailHeaderRenderer')
    || P.find(d, 'musicImmersiveHeaderRenderer')
    || P.find(d, 'musicVisualHeaderRenderer')
    || {};
}

function carousels(d) {
  return P.findAll(d, 'musicCarouselShelfRenderer').map((s) => ({
    title: P.text(P.find(s.header, 'title')),
    items: uniqueBy((s.contents || []).map((c) =>
      c.musicTwoRowItemRenderer ? P.parseTwoRow(c.musicTwoRowItemRenderer)
        : c.musicResponsiveListItemRenderer ? P.parseResponsive(c.musicResponsiveListItemRenderer)
          : null).filter(Boolean), (x) => x.kind + x.id),
  })).filter((s) => s.items.length);
}

export function album(id) {
  return cached('album:' + id, 60 * MIN, async () => {
    const d = await call('/browse', { client: 'YTMUSIC', browseId: id });
    const h = headerOf(d);
    const title = P.text(h.title);
    const strap = h.straplineTextOne?.runs || h.subtitle?.runs || [];
    const artists = strap
      .filter((r) => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'))
      .map((r) => ({ id: r.navigationEndpoint.browseEndpoint.browseId, name: r.text }));
    if (!artists.length && h.straplineTextOne) artists.push({ id: null, name: P.text(h.straplineTextOne) });
    const subtitle = P.text(h.subtitle);
    const thumb = P.thumb(P.find(h.thumbnail, 'thumbnails'), 800);
    const shelf = P.find(d, 'musicShelfRenderer') || d;
    const ctx = { artists, album: { id, name: title }, thumb };
    const tracks = uniqueBy(P.findAll(shelf, 'musicResponsiveListItemRenderer').map((r) => P.parseResponsive(r, ctx)).filter((t) => t?.kind === 'track'));
    // Album tracks only carry their own row thumbnail when it differs; prefer the cover.
    for (const t of tracks) if (t.thumb?.includes('i.ytimg.com')) t.thumb = thumb;
    return {
      kind: 'album',
      id,
      title,
      artists,
      type: subtitle.split('•')[0]?.trim() || '앨범',
      year: subtitle.match(/\d{4}/)?.[0] || '',
      info: P.text(h.secondSubtitle),
      description: P.text(P.find(h, 'musicDescriptionShelfRenderer')?.description),
      thumb,
      tracks,
      more: carousels(d),
    };
  });
}

export function artist(id) {
  return cached('artist:' + id, 60 * MIN, async () => {
    const d = await call('/browse', { client: 'YTMUSIC', browseId: id });
    const h = headerOf(d);
    const name = P.text(h.title);
    const thumb = P.thumb(P.find(h.thumbnail, 'thumbnails'), 1200);
    const shelf = P.find(d, 'musicShelfRenderer');
    let songs = shelf
      ? P.findAll(shelf, 'musicResponsiveListItemRenderer').map((r) => P.parseResponsive(r, { artists: [{ id, name }] })).filter((t) => t?.kind === 'track')
      : [];
    if (!songs.length && name) {
      // YT Music hides the songs shelf when logged out; fall back to YouTube.
      // The artist's own YouTube channel id can differ from the YT Music id, so
      // keep the channel that uploaded most of the official audio results.
      const found = await officialAudio(name, 30).catch(() => []);
      const counts = {};
      for (const t of found) if (t.officialArtist || t.topic) counts[t.artists[0].name] = (counts[t.artists[0].name] || 0) + 1;
      const owner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      songs = found
        .filter((t) => owner && t.artists[0].name === owner)
        .map((t) => ({ ...P.strip(t), artists: [{ id, name }] }));
    }
    return {
      kind: 'artist',
      id,
      name,
      thumb,
      description: P.text(h.description),
      subscribers: P.text(P.find(h.subscriptionButton, 'subscriberCountText')),
      songs: uniqueBy(songs).slice(0, 10),
      sections: carousels(d),
    };
  });
}

// YT Music sends a long playlist a page at a time.
async function playlistRows(first) {
  const shelf = P.find(first, 'musicPlaylistShelfRenderer') || P.find(first, 'musicShelfRenderer') || {};
  const rows = P.findAll(shelf, 'musicResponsiveListItemRenderer');
  let token = P.find(shelf, 'continuationCommand')?.token;
  for (let page = 1; token && page < MAX_PLAYLIST_PAGES; page++) {
    const more = await call('/browse', { client: 'YTMUSIC', continuation: token }).catch(() => null);
    rows.push(...P.findAll(more, 'musicResponsiveListItemRenderer'));
    token = P.find(more, 'continuationCommand')?.token;
  }
  return rows;
}

export function playlist(id) {
  return cached('playlist:' + id, 30 * MIN, async () => {
    const browseId = id.startsWith('VL') ? id : 'VL' + id;
    let result = null;
    let rowCount = 0;
    try {
      const d = await call('/browse', { client: 'YTMUSIC', browseId });
      const h = headerOf(d);
      const rows = await playlistRows(d);
      rowCount = rows.length;
      const tracks = uniqueBy(rows.map((r) => P.parseResponsive(r)).filter((t) => t?.kind === 'track'));
      if (tracks.length) {
        result = {
          title: P.text(h.title),
          author: P.text(h.straplineTextOne) || P.text(h.subtitle),
          info: P.text(h.secondSubtitle),
          description: P.text(P.find(h, 'musicDescriptionShelfRenderer')?.description),
          thumb: P.thumb(P.find(h.thumbnail, 'thumbnails'), 800),
          tracks,
        };
      }
    } catch {
      // fall through to regular YouTube
    }
    // Logged out, YT Music can cut a curated playlist down to its first 2 tracks, and the parser
    // skips long videos. Regular YouTube has them all, so a short answer gets checked against it.
    if (!result || result.tracks.length < Math.max(rowCount, FEW_PLAYLIST_TRACKS)) {
      try {
        const d = await call('/browse', { client: 'WEB', browseId });
        const meta = P.find(d, 'playlistMetadataRenderer') || {};
        const tracks = uniqueBy([
          ...P.findAll(d, 'playlistVideoRenderer').map(P.parsePlaylistVideo),
          ...P.findAll(d, 'lockupViewModel').map((l) => P.parseLockup(l)),
        ].filter(Boolean)).map(P.strip);
        if (tracks.length > (result?.tracks.length || 0)) {
          result = {
            title: result?.title || meta.title || P.text(P.find(d, 'pageHeaderViewModel')?.title) || '재생목록',
            author: result?.author || '',
            info: `${tracks.length}곡`,
            description: result?.description || meta.description || '',
            thumb: result?.thumb || tracks[0]?.thumb || null,
            tracks,
          };
        }
      } catch (e) {
        if (!result) throw e;
      }
    }
    if (!result?.tracks.length) throw new Error('재생목록을 불러올 수 없습니다.');
    return { kind: 'playlist', id: browseId.slice(2), ...result };
  });
}

// "Radio" for a track: YouTube Music Automix / Radio playlist + related videos fallback.
export function related(videoId) {
  return cached('related:' + videoId, 30 * MIN, async () => {
    let list = [];
    try {
      const d = await call('/next', { client: 'WEB', playlistId: 'RDAMVM' + videoId });
      const panels = P.findAll(d, 'playlistPanelVideoRenderer');
      list = panels.map(P.parsePlaylistPanel).filter((t) => t && t.id !== videoId);
    } catch {
      // fall back below
    }

    if (!list.length) {
      try {
        const d = await call('/next', { client: 'WEB', videoId });
        list = [
          ...P.findAll(d, 'lockupViewModel').map((l) => P.parseLockup(l)),
          ...P.findAll(d, 'compactVideoRenderer').map((v) => P.parseVideo(v)),
        ].filter((t) => t && t.id !== videoId && t.score > -3);
        list = rank(list);
      } catch {
        // ignore
      }
    }

    return uniqueBy(list).map(P.strip);
  });
}

// Results follow the app's language: a different market gets different rankings and shelves.
export function setLanguage(language) {
  if (!setMarket(language)) return;
  homeShelves = language === 'en' ? HOME_SHELVES_EN : HOME_SHELVES;
  memo.clear();
}

const HOME_SHELVES_EN = [
  { title: 'Top hits', query: 'top hits playlist' },
  { title: 'New music', query: 'new music playlist' },
  { title: 'Pop favorites', query: 'pop hits playlist' },
  { title: 'Hip-hop & R&B', query: 'hip hop r&b playlist' },
  { title: 'Rock classics', query: 'rock classics playlist' },
  { title: 'Indie & acoustic', query: 'indie acoustic playlist' },
  { title: 'Movie soundtracks', query: 'movie soundtrack playlist' },
  { title: 'Music for focus', query: 'study focus music playlist' },
  { title: 'K-POP', query: 'kpop hits playlist' },
  { title: 'Late night', query: 'late night chill playlist' },
];

const HOME_SHELVES = [
  { title: '지금 뜨는 K-POP', query: 'K-POP 인기곡 플레이리스트' },
  { title: '새로 나온 음악', query: '최신 가요 플레이리스트' },
  { title: '마음을 울리는 발라드', query: '발라드 플레이리스트' },
  { title: '힙합 & R&B', query: '국내 힙합 플레이리스트' },
  { title: '글로벌 팝 히트', query: 'pop hits playlist' },
  { title: '인디 & 어쿠스틱', query: '인디 어쿠스틱 플레이리스트' },
  { title: '드라마 OST 명곡', query: '드라마 OST 플레이리스트' },
  { title: '집중이 필요할 때', query: '공부할 때 듣는 음악 플레이리스트' },
  { title: 'J-POP 셀렉션', query: 'J-POP 플레이리스트' },
  { title: '밤에 듣기 좋은', query: '새벽 감성 플레이리스트' },
];

export function home() {
  return cached('home', 60 * MIN, async () => {
    // One search gives only eight or nine playlists, so each shelf also asks a second way and keeps up to
    // HOME_SHELF_MAX, leaving room for ones dropped later for having no cover.
    const shelves = await Promise.all((homeShelves ?? HOME_SHELVES).map(async (s) => {
      const queries = [s.query, `${s.query} ${homeShelves === HOME_SHELVES_EN ? 'playlist' : '플레이리스트'}`];
      const found = await Promise.allSettled(queries.map(async (query) => {
        const d = await call('/search', { client: 'YTMUSIC', query });
        return P.findAll(d, 'musicResponsiveListItemRenderer').map((r) => P.parseResponsive(r)).filter((i) => i && (i.kind === 'playlist' || i.kind === 'album') && i.thumb);
      }));
      const items = found.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      return { title: s.title, items: uniqueBy(items, (x) => x.kind + x.id).slice(0, HOME_SHELF_MAX) };
    }));
    return { shelves: shelves.filter((s) => s.items.length) };
  });
}
