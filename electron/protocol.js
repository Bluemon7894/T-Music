// ytm://stream/VIDEO_ID — what the renderer's <audio> elements load.
// Downloaded tracks are served from disk; everything else is resolved to a
// googlevideo URL and piped through, so URL expiry and method fallback stay
// invisible to the renderer.
import { protocol, net } from 'electron';
import fs from 'fs';
import { Readable } from 'stream';
import * as stream from './youtube/stream.js';
import * as downloads from './downloads.js';

export function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'ytm', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

export function handleProtocol() {
  protocol.handle('ytm', handleStream);
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
// The visualizer reads samples through Web Audio, which needs CORS on the media.
const CORS = { 'access-control-allow-origin': '*' };

function serveFile({ file, mime }, range) {
  const size = fs.statSync(file).size;
  const headers = { ...CORS, 'content-type': mime || 'audio/mp4', 'accept-ranges': 'bytes' };
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (!m || (!m[1] && !m[2])) {
    return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...headers, 'content-length': String(size) } });
  }
  let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206,
    headers: { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` },
  });
}

// ytm://radio/?u=URL — a radio stream, or a piece of a livestream's HLS playlist, fetched here because
// the page may only load media and data through this scheme (and the stations send no CORS headers).
const RADIO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
async function handleRadio(req) {
  const target = new URL(req.url).searchParams.get('u') || '';
  if (!/^https?:\/\//i.test(target)) return new Response('bad url', { status: 400, headers: CORS });
  try {
    const res = await net.fetch(target, { headers: { 'User-Agent': RADIO_UA, 'Icy-MetaData': '0' }, bypassCustomProtocolHandlers: true });
    const h = new Headers(CORS);
    const type = res.headers.get('content-type');
    if (type) h.set('content-type', type);
    const length = res.headers.get('content-length');
    if (length) h.set('content-length', length);
    h.set('cache-control', 'no-store');
    return new Response(res.body, { status: res.status, headers: h });
  } catch (e) {
    return new Response(String(e.message || e), { status: 502, headers: CORS });
  }
}

async function handleStream(req) {
  if (new URL(req.url).host === 'radio') return handleRadio(req);
  const id = new URL(req.url).pathname.slice(1);
  if (!/^[\w-]{11}$/.test(id)) return new Response('bad id', { status: 400 });
  const range = req.headers.get('range');

  const local = downloads.localFile(id);
  if (local) return serveFile(local, range);

  // Pass the browser's Range request directly to upstream (e.g. bytes=0- or bytes=X-)
  // so the audio element receives a continuous stream and can seek to any position
  // without premature stream termination or 416 errors.
  const upstreamRange = range || 'bytes=0-';

  for (let attempt = 0; attempt < 3; attempt++) {
    let s;
    try {
      s = await stream.resolve(id);
    } catch (e) {
      return new Response(e.message, { status: 502, headers: CORS });
    }
    try {
      const headers = { ...s.headers, Range: upstreamRange };
      const res = await net.fetch(s.url, { headers, bypassCustomProtocolHandlers: true });
      if (res.status === 200 || res.status === 206) {
        const h = new Headers(CORS);
        for (const k of PASS_HEADERS) {
          const v = res.headers.get(k);
          if (v) h.set(k, v);
        }
        if (!h.has('accept-ranges')) h.set('accept-ranges', 'bytes');
        return new Response(res.body, { status: res.status, headers: h });
      }
      if (res.status === 416) {
        const h = new Headers(CORS);
        const cr = res.headers.get('content-range');
        if (cr) h.set('content-range', cr);
        return new Response(null, { status: 416, headers: h });
      }
      res.body?.cancel();
    } catch {
      // network error: treat like a rejected URL
    }
    // A cached URL may simply have expired: drop it and resolve a fresh one.
    stream.invalidate(id, s.method, s.fresh);
  }
  return new Response('stream failed', { status: 502, headers: CORS });
}
