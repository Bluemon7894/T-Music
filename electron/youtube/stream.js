// Turns a video id into a direct audio URL. visionOS is the only client that currently serves whole
// tracks. The others stay listed so playback moves to them by itself if YouTube blocks it and they
// work again. They answer normally today but refuse anything past the first megabyte, so every
// fallback has to prove it can serve the middle of the file before it's used.
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getClient, getPlayerClient, resetClient } from './client.js';
import { isLocalId } from '../localId.js';
import * as remote from '../remoteConfig.js';

const CLIENTS = ['VISIONOS', 'IOS', 'ANDROID_VR'];
// Tried only once all of the above fail, with a session that can also unscramble web addresses.
const LAST_RESORT_CLIENTS = ['TV', 'TV_EMBEDDED', 'WEB_EMBEDDED', 'MWEB', 'ANDROID', 'YTMUSIC', 'WEB'];
const TIMEOUT_MS = 12000;
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const FAILS_BEFORE_COOLDOWN = 3;

// This video can't be played. That says nothing about the client that was asked.
class UnplayableError extends Error {}

// A check for bots or a "try again later" is about whoever asked, and hits every video at once, so it must
// not read as the video being unplayable. Reasons come in the language the app runs in.
const ABOUT_THE_VIDEO = /\bage\b|private|member|연령|비공개|멤버십/i;
const TRY_LATER = /try again|다시 시도|나중에/i;
function refusedTheAsker(ps) {
  const reason = ps?.reason || '';
  if (ps?.status === 'LOGIN_REQUIRED') return !ABOUT_THE_VIDEO.test(reason);
  return TRY_LATER.test(reason);
}

async function innertube(id, clientName, session = getClient) {
  const yt = await session();
  const info = await yt.getBasicInfo(id, { client: clientName }).catch((e) => {
    // The library throws for deleted and private videos instead of reporting their status.
    throw /unavailable|private|removed/i.test(e.message) ? new UnplayableError(e.message) : e;
  });
  const ps = info.playability_status;
  if (ps?.status !== 'OK') {
    const reason = ps?.reason || ps?.status || 'unplayable';
    throw refusedTheAsker(ps) ? new Error(reason) : new UnplayableError(reason);
  }
  const fmt = info.chooseFormat({ type: 'audio', quality: 'best' });
  const url = await fmt.decipher(yt.session.player);
  if (!url) throw new Error('no url');
  return { url, headers: {}, mime: fmt.mime_type, bitrate: fmt.bitrate, size: Number(fmt.content_length) || 0 };
}

async function servesWholeFile(r) {
  const middle = Math.floor(r.size / 2);
  const res = await fetch(r.url, { headers: { ...r.headers, Range: `bytes=${middle}-${middle + 1023}` } });
  res.body?.cancel();
  return res.status === 206 || res.status === 200;
}

const statsFile = () => path.join(app.getPath('userData'), 'stream-stats.json');
let stats = null;
function loadStats() {
  if (stats) return stats;
  try { stats = JSON.parse(fs.readFileSync(statsFile(), 'utf8')); } catch { stats = {}; }
  return stats;
}
let saveTimer = null;
function saveStats() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(statsFile(), JSON.stringify(stats)); } catch { /* not fatal */ }
  }, 1000);
}
function mark(name, ok, error) {
  const s = (loadStats()[name] ??= { ok: 0, fail: 0 });
  if (ok) { s.ok++; s.lastOk = Date.now(); s.streak = 0; } else { s.fail++; s.lastFail = Date.now(); s.streak = (s.streak || 0) + 1; s.lastError = String(error || '').slice(0, 200); }
  saveStats();
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

function expiryOf(url) {
  const exp = Number(new URL(url).searchParams.get('expire'));
  // Refresh ten minutes early so a long track doesn't cross the deadline.
  return exp ? exp * 1000 - 10 * 60 * 1000 : Date.now() + 60 * 60 * 1000;
}

function coolingDown(name) {
  const s = loadStats()[name];
  return Boolean(s && (s.streak || 0) >= FAILS_BEFORE_COOLDOWN && Date.now() - s.lastFail < COOLDOWN_MS);
}

// Clients that have been failing go last rather than being dropped: one may have recovered.
// remote-config.json can reorder these when YouTube starts refusing one.
const clients = () => remote.streamClients(CLIENTS);
const clientOrder = () => [...clients().filter((c) => !coolingDown(c)), ...clients().filter(coolingDown)];

async function tryClients(id) {
  let unplayable = null;
  let lastError = null;
  for (const name of clientOrder()) {
    try {
      const r = await withTimeout(innertube(id, name), TIMEOUT_MS);
      if (name !== clients()[0] && !(await withTimeout(servesWholeFile(r), TIMEOUT_MS))) throw new Error('only serves the start of the file');
      mark(name, true);
      return { ...r, method: name };
    } catch (e) {
      if (e instanceof UnplayableError) {
        unplayable ??= e;
      } else {
        mark(name, false, e.message);
        lastError = e;
      }
    }
  }
  throw unplayable || lastError || new Error('no client available');
}

async function tryLastResort(id) {
  for (const name of remote.lastResortClients(LAST_RESORT_CLIENTS)) {
    try {
      const r = await withTimeout(innertube(id, name, getPlayerClient), TIMEOUT_MS);
      if (await withTimeout(servesWholeFile(r), TIMEOUT_MS)) return { ...r, method: name };
    } catch { /* on to the next */ }
  }
  return null;
}

const cache = new Map();
const inflight = new Map();

export async function resolve(id) {
  if (isLocalId(id)) throw new UnplayableError('재생할 수 없는 곡입니다: 이 기기에 없는 음악 파일이에요');
  const hit = cache.get(id);
  if (hit && hit.expires > Date.now()) return { ...hit, fresh: false };
  if (inflight.has(id)) return inflight.get(id);

  const job = (async () => {
    try {
      let r;
      try {
        r = await tryClients(id);
      } catch (e) {
        if (e instanceof UnplayableError) throw e;
        // Every client failing usually means the session itself went stale.
        resetClient();
        try {
          r = await tryClients(id);
        } catch (again) {
          if (again instanceof UnplayableError) throw again;
          r = await tryLastResort(id);
          if (!r) throw again;
        }
      }
      const entry = { ...r, id, expires: r.expires || expiryOf(r.url) };
      cache.set(id, entry);
      return { ...entry, fresh: true };
    } catch (e) {
      throw new Error('재생할 수 없는 곡입니다: ' + e.message);
    }
  })().finally(() => inflight.delete(id));

  inflight.set(id, job);
  return job;
}

// Called when a URL we handed out stopped working.
export function invalidate(id, method, blame) {
  cache.delete(id);
  if (blame && method) mark(method, false, 'stream request rejected');
}

export function prefetch(id) {
  resolve(id).catch(() => {});
}

export async function diagnose(id = 'OIHlzvEKncQ') {
  const results = [];
  for (const name of clients()) {
    const t = Date.now();
    try {
      const r = await withTimeout(innertube(id, name), TIMEOUT_MS);
      const whole = await withTimeout(servesWholeFile(r), TIMEOUT_MS);
      results.push({ name, ok: whole, ms: Date.now() - t, mime: r.mime });
    } catch (e) {
      results.push({ name, ok: false, ms: Date.now() - t, error: e.message.slice(0, 160) });
    }
  }
  return results;
}

export function status() {
  const st = loadStats();
  return clients().map((name) => ({ name, ...(st[name] || { ok: 0, fail: 0 }) }));
}
