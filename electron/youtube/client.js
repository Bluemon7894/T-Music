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
  playerClient = null;
}

// Slower to set up because it downloads YouTube's player, so only made when nothing else has worked.
let playerClient = null;
export async function getPlayerClient() {
  playerClient ??= Innertube.create({ lang: market.lang, location: market.location, retrieve_player: true }).catch((e) => {
    playerClient = null;
    throw e;
  });
  return playerClient;
}

// YouTube leaves some requests hanging for 5 to 10 seconds and then refuses them, while the same
// request sent again answers in half a second. A healthy answer takes well under a second, so one
// that hasn't come by HEDGE_MS is sent again, and whichever copy answers first is used.
const HEDGE_MS = 1500;
const COPIES = 3;

function hedged(send) {
  return new Promise((resolve, reject) => {
    let sent = 0;
    let failed = 0;
    let settled = false;
    let timer = null;
    const next = () => {
      clearTimeout(timer);
      sent += 1;
      send().then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (e) => {
          failed += 1;
          if (settled) return;
          // A refusal is sent again straight away; the last one to fail ends it.
          if (sent < COPIES) next();
          else if (failed === sent) {
            settled = true;
            reject(e);
          }
        },
      );
      if (sent < COPIES) timer = setTimeout(next, HEDGE_MS);
    };
    next();
  });
}

const execute = (yt, endpoint, payload) => yt.actions.execute(endpoint, { ...payload, parse: false }).then((r) => r.data);

export async function call(endpoint, payload) {
  const yt = await getClient();
  try {
    return await hedged(() => execute(yt, endpoint, payload));
  } catch {
    // Every copy failed: the session itself (visitor data, client version) may be stale.
    if (client === yt) resetClient();
  }
  const fresh = await getClient();
  return hedged(() => execute(fresh, endpoint, payload));
}
