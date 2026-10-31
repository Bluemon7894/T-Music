// Shared InnerTube session. Metadata calls go through `call()` and return the raw
// JSON, which we parse ourselves (see parse.js) so a parser change in youtubei.js
// can't break the catalog.
import { Innertube, Log, Constants } from 'youtubei.js';

Log.setLevel(Log.Level.NONE);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const MARKETS = {
  ko: { lang: 'ko', location: 'KR', accept: 'ko-KR,ko;q=0.9' },
  en: { lang: 'en', location: 'US', accept: 'en-US,en;q=0.9' },
};

let market = MARKETS.ko;
let client = null;
let creating = null;

// What YouTube ranks and names things for. A new market needs a new session.
export function setMarket(language) {
  const next = MARKETS[language] || MARKETS.ko;
  if (next === market) return false;
  market = next;
  client = null;
  creating = null;
  return true;
}

// youtubei.js ships a hard-coded YT Music client version that goes stale; an old
// version gets degraded search results, so pick up the live one when we can.
async function refreshMusicClientVersion() {
  try {
    const res = await fetch('https://music.youtube.com/', {
      headers: { 'User-Agent': UA, 'Accept-Language': market.accept },
      signal: AbortSignal.timeout(4000),
    });
    const m = (await res.text()).match(/"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/);
    if (m) Constants.CLIENTS.YTMUSIC.VERSION = m[1];
  } catch {
    // keep the bundled version
  }
}

export async function getClient() {
  if (client) return client;
  const wanted = market;
  const started = creating ?? (async () => {
    await refreshMusicClientVersion();
    const made = await Innertube.create({ lang: wanted.lang, location: wanted.location, retrieve_player: false });
    if (wanted === market) client = made;
    return made;
  })().finally(() => { if (creating === started) creating = null; });
  creating = started;
  return started;
}

export function resetClient() {
  client = null;
}

export async function call(endpoint, payload) {
  const yt = await getClient();
  try {
    return (await yt.actions.execute(endpoint, { ...payload, parse: false })).data;
  } catch {
    // Most failures are transient; retry on the same session first.
    await new Promise((r) => setTimeout(r, 300));
  }
  try {
    return (await yt.actions.execute(endpoint, { ...payload, parse: false })).data;
  } catch {
    // Still failing: the session itself (visitor data, client version) may be stale.
    if (client === yt) resetClient();
    const fresh = await getClient();
    return (await fresh.actions.execute(endpoint, { ...payload, parse: false })).data;
  }
}
