// Helpers that turn raw InnerTube JSON into plain objects for the UI.
// Everything here searches for renderer keys anywhere in the tree instead of
// following fixed paths, so small layout changes on YouTube's side don't matter.

export function text(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (t.simpleText != null) return t.simpleText;
  if (Array.isArray(t.runs)) return t.runs.map((r) => r.text).join('');
  if (t.content != null) return t.content;
  return '';
}

// All values stored under `key`, in document order. Doesn't descend into matches.
export function findAll(o, key, out = []) {
  if (Array.isArray(o)) {
    for (const x of o) findAll(x, key, out);
  } else if (o && typeof o === 'object') {
    for (const k in o) {
      if (k === key) out.push(o[k]);
      else findAll(o[k], key, out);
    }
  }
  return out;
}

export function find(o, key) {
  if (Array.isArray(o)) {
    for (const x of o) {
      const r = find(x, key);
      if (r !== undefined) return r;
    }
  } else if (o && typeof o === 'object') {
    if (key in o) return o[key];
    for (const k in o) {
      const r = find(o[k], key);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

export function thumb(thumbs, size = 544) {
  const list = Array.isArray(thumbs) ? thumbs : thumbs?.thumbnails;
  if (!list?.length) return null;
  let url = list.reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a)).url;
  if (!url) return null;
  if (url.startsWith('//')) url = 'https:' + url;
  if (/googleusercontent\.com|ggpht\.com/.test(url)) {
    url = url.split('=')[0] + `=w${size}-h${size}-l90-rj`;
  } else if (url.includes('i.ytimg.com')) {
    url = url.split('?')[0];
  }
  return url;
}

// hq720 is 16:9 without the letterbox bars hqdefault has; older videos lack it,
// so the renderer falls back to mqdefault on error.
export function videoThumb(id) {
  return `https://i.ytimg.com/vi/${id}/hq720.jpg`;
}

export function seconds(s) {
  const m = String(s || '').trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return 0;
  return m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
}

const isDuration = (s) => /^\d+:\d{2}(:\d{2})?$/.test(s.trim());
const isYear = (s) => /^\d{4}(년)?$/.test(s.trim());
const TYPE_LABELS = new Set([
  '노래', '동영상', '싱글', '앨범', 'EP', '아티스트', '재생목록', '에피소드', '팟캐스트', '프로필',
  'Song', 'Video', 'Single', 'Album', 'Artist', 'Playlist', 'Episode', 'Podcast', 'Profile',
]);
const SEPARATORS = new Set([' • ', ' & ', ', ', ' · ', ' 및 ', ' and ']);

function pageTypeOf(endpoint) {
  return endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
}

// Split a YT Music subtitle into linked artists/album and leftover plain text.
function splitRuns(runs = []) {
  const artists = [];
  let album = null;
  let label = null;
  const extra = [];
  for (const r of runs) {
    const t = r.text ?? '';
    if (SEPARATORS.has(t) || !t.trim()) continue;
    const browseId = r.navigationEndpoint?.browseEndpoint?.browseId;
    if (browseId?.startsWith('MPRE')) album = { id: browseId, name: t };
    else if (browseId?.startsWith('UC')) artists.push({ id: browseId, name: t });
    else if (TYPE_LABELS.has(t.trim())) label = t.trim();
    else extra.push(t.trim());
  }
  if (!artists.length) {
    const guess = extra.find((x) => !isDuration(x) && !isYear(x) && !/조회수|회 재생|views|plays|구독자|subscribers|곡$|songs$/i.test(x));
    if (guess) artists.push({ id: null, name: guess });
  }
  return { artists, album, label, extra };
}

const NON_MUSIC_RE = /에피소드|팟캐스트|Episode|Podcast|오디오북|다큐|뉴스|라디오/i;

// musicResponsiveListItemRenderer: rows in YT Music search results, album tracklists, playlists.
export function parseResponsive(r, ctx = {}) {
  if (!r) return null;
  const cols = (r.flexColumns || []).map((c) => c.musicResponsiveListItemFlexColumnRenderer?.text);
  const title = text(cols[0]);
  if (!title) return null;
  const runs = cols.slice(1).flatMap((c) => c?.runs || []);
  const nav = r.navigationEndpoint;
  const pageType = pageTypeOf(nav);
  const browseId = nav?.browseEndpoint?.browseId;
  const { artists, album, label, extra } = splitRuns(runs);
  const th = thumb(find(r.thumbnail, 'thumbnails'));

  if (pageType === 'MUSIC_PAGE_TYPE_ALBUM') {
    return { kind: 'album', id: browseId, title, artists, type: label || '앨범', year: extra.find(isYear)?.replace('년', ''), thumb: th };
  }
  if (pageType === 'MUSIC_PAGE_TYPE_ARTIST') {
    return { kind: 'artist', id: browseId, name: title, thumb: th, subtitle: extra.filter((x) => x !== title).join(' • ') };
  }
  if (pageType === 'MUSIC_PAGE_TYPE_PLAYLIST') {
    return { kind: 'playlist', id: browseId.replace(/^VL/, ''), title, author: artists[0]?.name || '', thumb: th };
  }
  if (pageType) return null; // podcasts, episodes, profiles, non-music audio

  // Filter out talk shows, audiobooks, science documentaries, podcasts mistakenly returned without a pageType
  if (NON_MUSIC_RE.test(title) || NON_MUSIC_RE.test(label || '') || NON_MUSIC_RE.test(extra.join(' '))) {
    return null;
  }

  const videoId = r.playlistItemData?.videoId || find(r.overlay, 'videoId') || nav?.watchEndpoint?.videoId || find(cols[0], 'videoId');
  if (!videoId) return null;
  const durText = text(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text) || extra.find(isDuration);
  const durSec = seconds(durText);

  // Filter out non-music long form episodes (> 15 minutes) or very short audio (< 45s) unless part of album
  if (!album && !ctx.album && (durSec > 900 || (durSec > 0 && durSec < 45))) {
    return null;
  }

  return {
    kind: 'track',
    id: videoId,
    title,
    artists: artists.length ? artists : ctx.artists || [],
    album: album || ctx.album || null,
    duration: durSec,
    thumb: th || ctx.thumb || videoThumb(videoId),
    score: 8, // YouTube Music native tracks receive solid base score
  };
}

// musicTwoRowItemRenderer: square cards in carousels (artist discography, related).
export function parseTwoRow(r) {
  if (!r) return null;
  const nav = r.navigationEndpoint;
  const pageType = pageTypeOf(nav);
  const browseId = nav?.browseEndpoint?.browseId;
  const title = text(r.title);
  const { artists, label, extra } = splitRuns(r.subtitle?.runs);
  const th = thumb(find(r.thumbnailRenderer, 'thumbnails'));
  if (pageType === 'MUSIC_PAGE_TYPE_ALBUM') {
    return { kind: 'album', id: browseId, title, artists, type: label || '앨범', year: extra.find(isYear)?.replace('년', ''), thumb: th };
  }
  if (pageType === 'MUSIC_PAGE_TYPE_ARTIST') return { kind: 'artist', id: browseId, name: title, thumb: th, subtitle: extra.join(' • ') };
  if (pageType === 'MUSIC_PAGE_TYPE_PLAYLIST') return { kind: 'playlist', id: browseId.replace(/^VL/, ''), title, author: artists[0]?.name || extra[0] || '', thumb: th };
  const videoId = nav?.watchEndpoint?.videoId;
  if (videoId && !pageType) return { kind: 'track', id: videoId, title, artists, album: null, duration: 0, thumb: th || videoThumb(videoId) };
  return null;
}

// ---- regular YouTube results ----

const NOISE = /(노래방|karaoke|커버|cover|reaction|리액션|직캠|fancam|1\s*시간|1\s*hour|playlist|플레이리스트|모음|연속\s*듣기|피아노|piano|instrumental|8d\b|sped\s*up|slowed|nightcore|teaser|티저|shorts|behind|비하인드|메이킹|making|교차편집|stage\s*mix|해석|tutorial|lesson|강좌|mr제거|무대교차|쇼츠)/i;
const OFFICIAL_CHANNELS = /(?:official|공식|smtown|hybe|jyp|1thek|stone\s*music|yg|starship|music|records|entertainment|vevo|카카오엔터|워너뮤직|genie\s*music|벅스|danmee|danal)/i;

export function parseViews(str) {
  if (!str) return 0;
  const s = String(str).replace(/,/g, '').trim();
  const m억 = s.match(/([\d.]+)\s*억/);
  if (m억) return Math.round(parseFloat(m억[1]) * 100000000);
  const m만 = s.match(/([\d.]+)\s*만/);
  if (m만) return Math.round(parseFloat(m만[1]) * 10000);
  const mB = s.match(/([\d.]+)\s*B(?:illion)?/i);
  if (mB) return Math.round(parseFloat(mB[1]) * 1000000000);
  const mM = s.match(/([\d.]+)\s*M(?:illion)?/i);
  if (mM) return Math.round(parseFloat(mM[1]) * 1000000);
  const mK = s.match(/([\d.]+)\s*K/i);
  if (mK) return Math.round(parseFloat(mK[1]) * 1000);
  const mNum = s.match(/(\d+)/);
  if (mNum) return parseInt(mNum[1], 10);
  return 0;
}

export function musicScore(t, query = '') {
  let s = 0;
  if (t.topic) s += 4;
  if (t.officialArtist) s += 5;
  if (t.verified) s += 3;
  if (/official|\bM\/?V\b|뮤직비디오|audio/i.test(t.rawTitle || '')) s += 2;
  const artistName = t.artists?.[0]?.name || '';
  if (OFFICIAL_CHANNELS.test(artistName)) s += 4;

  // View count popularity bonus / low-view penalty
  const v = t.views || 0;
  if (v >= 50000000) s += 8;
  else if (v >= 10000000) s += 6;
  else if (v >= 1000000) s += 5;
  else if (v >= 200000) s += 3;
  else if (v >= 30000) s += 1;
  else if (v > 0 && v < 200) s -= 12; // Harsh penalty for random 1-200 view bedroom distrokid uploads
  else if (v > 0 && v < 1000 && !t.officialArtist && !t.verified) s -= 8;

  // Match relevance to query
  if (query && query.trim()) {
    const qClean = query.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const tClean = (t.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const aClean = artistName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (tClean === qClean) s += 6;
    else if (tClean.startsWith(qClean) || tClean.includes(qClean)) s += 3;
    if (aClean.includes(qClean)) s += 3;
  }

  const noise = (t.rawTitle || '').match(NOISE);
  if (noise && !new RegExp(noise[0], 'i').test(query)) s -= 10;
  if (/live|라이브|콘서트|concert|@/i.test(t.rawTitle || '') && !/live|라이브/i.test(query)) s -= 3;
  if (t.duration > 600 || t.duration < 55) s -= 8;
  return s;
}

const TITLE_JUNK = [
  /\s*[\[(【]\s*(official\s*)?(music\s*video|m\/?v|mv|audio|lyric\s*video|visualizer|official\s*video)\s*[\])】]/gi,
  /\s*[_|\-–]\s*(official\s*)?(music\s*video|m\/?v|mv|official\s*video|official\s*audio)\s*$/gi,
  /\s+(official\s*)?(m\/v|mv)\s*$/gi,
];

export function cleanTitle(title, artist = '') {
  let s = title;
  for (const re of TITLE_JUNK) s = s.replace(re, '');
  if (artist) {
    const esc = artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`^${esc}\\s*(\\([^)]*\\))?\\s*[-_–|]\\s*`, 'i'), '');
  }
  return s.replace(/\s*[_|]\s*$/, '').trim() || title;
}

function ownerInfo(v) {
  const t = v.ownerText || v.shortBylineText || v.longBylineText;
  const name = text(t);
  const id = t?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || null;
  return { name, id };
}

// videoRenderer / compactVideoRenderer
export function parseVideo(v, query = '') {
  if (!v?.videoId) return null;
  const duration = seconds(text(v.lengthText));
  if (!duration) return null; // live streams, premieres
  const owner = ownerInfo(v);
  const topic = / - Topic$/.test(owner.name);
  const badges = (v.ownerBadges || []).map((b) => b.metadataBadgeRenderer?.style || '');
  const verifiedArtist = badges.includes('BADGE_STYLE_TYPE_VERIFIED_ARTIST');
  const verified = verifiedArtist || badges.includes('BADGE_STYLE_TYPE_VERIFIED');
  const artistName = owner.name.replace(/ - Topic$/, '');
  const rawTitle = text(v.title);
  const views = parseViews(text(v.viewCountText) || text(v.shortViewCountText));
  const t = {
    kind: 'track',
    id: v.videoId,
    title: cleanTitle(rawTitle, artistName),
    rawTitle,
    artists: [{ id: topic || verified ? owner.id : null, name: artistName }],
    album: null,
    duration,
    thumb: videoThumb(v.videoId),
    topic,
    officialArtist: verifiedArtist,
    verified,
    views,
  };
  t.score = musicScore(t, query);
  return t;
}

// lockupViewModel (new-style related videos)
export function parseLockup(l, query = '') {
  if (l?.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
  const md = l.metadata?.lockupMetadataViewModel;
  const rawTitle = text(md?.title);
  const rows = md?.metadata?.contentMetadataViewModel?.metadataRows || [];
  const ownerName = text(rows[0]?.metadataParts?.[0]?.text);
  const ownerId = find(rows[0], 'browseId') || null;
  const durStr = JSON.stringify(l.contentImage || {}).match(/"(?:text|content)":"(\d+:\d{2}(?::\d{2})?)"/)?.[1];
  const duration = seconds(durStr);
  if (!rawTitle || !duration) return null;
  const topic = / - Topic$/.test(ownerName);
  const artistName = ownerName.replace(/ - Topic$/, '');
  const viewsText = text(rows[1]?.metadataParts?.[0]?.text) || '';
  const views = parseViews(viewsText);
  const t = {
    kind: 'track',
    id: l.contentId,
    title: cleanTitle(rawTitle, artistName),
    rawTitle,
    artists: [{ id: topic ? ownerId : null, name: artistName }],
    album: null,
    duration,
    thumb: videoThumb(l.contentId),
    topic,
    officialArtist: false,
    verified: false,
    views,
  };
  t.score = musicScore(t, query);
  return t;
}

// playlistVideoRenderer (regular YouTube playlist pages)
export function parsePlaylistVideo(v) {
  if (!v?.videoId || v.isPlayable === false) return null;
  const owner = ownerInfo(v);
  const artistName = owner.name.replace(/ - Topic$/, '');
  const rawTitle = text(v.title);
  return {
    kind: 'track',
    id: v.videoId,
    title: cleanTitle(rawTitle, artistName),
    rawTitle,
    artists: [{ id: / - Topic$/.test(owner.name) ? owner.id : null, name: artistName }],
    album: null,
    duration: seconds(text(v.lengthText)) || Number(v.lengthSeconds) || 0,
    thumb: videoThumb(v.videoId),
  };
}

// playlistPanelVideoRenderer (YouTube Music / YouTube Automix radio panels)
export function parsePlaylistPanel(r) {
  if (!r?.videoId) return null;
  const byline = r.shortBylineText || r.longBylineText;
  const artists = byline?.runs?.map((x) => ({
    name: x.text,
    id: x.navigationEndpoint?.browseEndpoint?.browseId || null,
  })) || [];
  const rawTitle = text(r.title);
  const durSec = seconds(text(r.lengthText));
  const th = thumb(r.thumbnail, 544) || videoThumb(r.videoId);
  return {
    kind: 'track',
    id: r.videoId,
    title: cleanTitle(rawTitle, artists[0]?.name),
    rawTitle,
    artists,
    album: null,
    duration: durSec,
    thumb: th,
  };
}

export function strip(t) {
  if (!t) return t;
  const { score, topic, officialArtist, verified, views, rawTitle, ...rest } = t;
  return rest;
}
