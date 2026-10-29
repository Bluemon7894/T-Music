// Turns a video id into a direct audio URL using InnerTube visionOS.
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

// Dedicated playback engine: InnerTube visionOS
const METHODS = {
  VISIONOS: (id) => innertube(id, 'VISIONOS'),
};
const DEFAULT_ORDER = ['VISIONOS'];
const TIMEOUT_MS = 12000;

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

const cache = new Map();
const inflight = new Map();

export async function resolve(id) {
  const hit = cache.get(id);
  if (hit && hit.expires > Date.now()) return { ...hit, fresh: false };
  if (inflight.has(id)) return inflight.get(id);

  const job = (async () => {
    try {
      const r = await withTimeout(METHODS.VISIONOS(id), TIMEOUT_MS);
      const entry = { ...r, id, method: 'VISIONOS', expires: r.expires || expiryOf(r.url) };
      cache.set(id, entry);
      mark('VISIONOS', true);
      return { ...entry, fresh: true };
    } catch (e) {
      mark('VISIONOS', false, e.message);
      throw new Error('재생할 수 없는 곡입니다: ' + e.message);
    }
  })().finally(() => inflight.delete(id));

  inflight.set(id, job);
  return job;
}

// Called when a URL we handed out stopped working.
export function invalidate(id, method, blame) {
  cache.delete(id);
  if (blame) mark('VISIONOS', false, 'stream request rejected');
}

export function prefetch(id) {
  resolve(id).catch(() => {});
}

// Reports visionOS playback engine diagnosis.
export async function diagnose(id = 'OIHlzvEKncQ') {
  const t = Date.now();
  try {
    const r = await withTimeout(METHODS.VISIONOS(id), TIMEOUT_MS);
    const res = await fetch(r.url, { headers: { ...r.headers, Range: 'bytes=0-1023' } });
    return [{ name: 'VISIONOS', ok: res.status === 206 || res.status === 200, ms: Date.now() - t, http: res.status, mime: r.mime }];
  } catch (e) {
    return [{ name: 'VISIONOS', ok: false, ms: Date.now() - t, error: e.message.slice(0, 160) }];
  }
}

export function status() {
  const st = loadStats();
  return [{ name: 'VISIONOS', ...(st.VISIONOS || { ok: 0, fail: 0 }) }];
}
