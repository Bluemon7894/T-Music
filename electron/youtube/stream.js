// Turns a video id into a direct audio URL, trying several methods in order.
// Methods that recently failed (while a later one worked) get pushed to the back
// for a few hours, then retried, so the app routes around breakage on its own.
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getClient } from './client.js';

async function innertube(id, clientName) {
  const yt = await getClient();
  const info = await yt.getBasicInfo(id, { client: clientName });
  const ps = info.playability_status;
  if (ps?.status !== 'OK') throw new Error(ps?.reason || ps?.status || 'unplayable');
  const fmt = info.chooseFormat({ type: 'audio', quality: 'best' });
  const url = await fmt.decipher(yt.session.player);
  if (!url) throw new Error('no url');
  return { url, headers: {}, mime: fmt.mime_type, bitrate: fmt.bitrate };
}

// Default order: fastest and most reliable first (measured).
const METHODS = {
  VISIONOS: (id) => innertube(id, 'VISIONOS'),
  IOS: (id) => innertube(id, 'IOS'),
  ANDROID_VR: (id) => innertube(id, 'ANDROID_VR'),
};
const DEFAULT_ORDER = Object.keys(METHODS);
const TIMEOUT_MS = 12000;
const DEMOTE_MS = 6 * 60 * 60 * 1000;

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

function order() {
  const now = Date.now();
  const st = loadStats();
  // One odd video shouldn't sink a method; two failures in a row do.
  const demoted = (n) => {
    const s = st[n];
    return s?.streak >= 2 && now - s.lastFail < DEMOTE_MS;
  };
  return [...DEFAULT_ORDER.filter((n) => !demoted(n)), ...DEFAULT_ORDER.filter(demoted)];
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

function expiryOf(url) {
  const exp = Number(new URL(url).searchParams.get('expire'));
  // Refresh ten minutes early so a long track doesn't cross the deadline.
  return exp ? exp * 1000 - 10 * 60 * 1000 : Date.now() + 60 * 60 * 1000;
}

const cache = new Map();
const inflight = new Map();

export async function resolve(id, { exclude = [] } = {}) {
  const hit = cache.get(id);
  if (hit && hit.expires > Date.now() && !exclude.includes(hit.method)) return { ...hit, fresh: false };
  const key = id + '|' + exclude.join(',');
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    const failed = [];
    for (const name of order()) {
      if (exclude.includes(name)) continue;
      try {
        const r = await withTimeout(METHODS[name](id), TIMEOUT_MS);
        const entry = { ...r, id, method: name, expires: r.expires || expiryOf(r.url) };
        cache.set(id, entry);
        mark(name, true);
        // Only blame earlier methods when a later one proved the video is playable.
        for (const f of failed) mark(f.name, false, f.error);
        return { ...entry, fresh: true };
      } catch (e) {
        failed.push({ name, error: e.message });
      }
    }
    throw new Error('재생할 수 없는 곡입니다: ' + failed.map((f) => `${f.name}(${f.error})`).join(', '));
  })().finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}

// Called when a URL we handed out stopped working.
export function invalidate(id, method, blame) {
  cache.delete(id);
  if (blame) mark(method, false, 'stream request rejected');
}

export function prefetch(id) {
  resolve(id).catch(() => {});
}

// Runs every method on its own (no fallback) and reports which ones work.
export async function diagnose(id = 'OIHlzvEKncQ') {
  const results = [];
  for (const name of DEFAULT_ORDER) {
    const t = Date.now();
    try {
      const r = await withTimeout(METHODS[name](id), TIMEOUT_MS);
      const res = await fetch(r.url, { headers: { ...r.headers, Range: 'bytes=0-1023' } });
      results.push({ name, ok: res.status === 206 || res.status === 200, ms: Date.now() - t, http: res.status, mime: r.mime });
    } catch (e) {
      results.push({ name, ok: false, ms: Date.now() - t, error: e.message.slice(0, 160) });
    }
  }
  return results;
}

export function status() {
  const st = loadStats();
  return order().map((name) => ({ name, ...(st[name] || { ok: 0, fail: 0 }) }));
}
