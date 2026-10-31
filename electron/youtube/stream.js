// Turns a video id into a direct audio URL. visionOS is the only client that currently serves whole
// tracks. The others stay listed so playback moves to them by itself if YouTube blocks it and they
// work again. They answer normally today but refuse anything past the first megabyte, so every
// fallback has to prove it can serve the middle of the file before it's used.
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getClient, resetClient } from './client.js';

const CLIENTS = ['VISIONOS', 'IOS', 'ANDROID_VR'];
const TIMEOUT_MS = 12000;
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const FAILS_BEFORE_COOLDOWN = 3;

// This video can't be played. That says nothing about the client that was asked.
class UnplayableError extends Error {}

async function innertube(id, clientName) {
  const yt = await getClient();
  const info = await yt.getBasicInfo(id, { client: clientName }).catch((e) => {
    // The library throws for deleted and private videos instead of reporting their status.
    throw /unavailable|private|removed/i.test(e.message) ? new UnplayableError(e.message) : e;
  });
  const ps = info.playability_status;
  if (ps?.status !== 'OK') throw new UnplayableError(ps?.reason || ps?.status || 'unplayable');
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
const clientOrder = () => [...CLIENTS.filter((c) => !coolingDown(c)), ...CLIENTS.filter(coolingDown)];

async function tryClients(id) {
  let unplayable = null;
  let lastError = null;
  for (const name of clientOrder()) {
    try {
      const r = await withTimeout(innertube(id, name), TIMEOUT_MS);
      if (name !== CLIENTS[0] && !(await withTimeout(servesWholeFile(r), TIMEOUT_MS))) throw new Error('only serves the start of the file');
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

const cache = new Map();
const inflight = new Map();

export async function resolve(id) {
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
        r = await tryClients(id);
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
  for (const name of CLIENTS) {
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
  return CLIENTS.map((name) => ({ name, ...(st[name] || { ok: 0, fail: 0 }) }));
}
