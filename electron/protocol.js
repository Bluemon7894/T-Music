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

async function handleStream(req) {
  const id = new URL(req.url).pathname.slice(1);
  if (!/^[\w-]{11}$/.test(id)) return new Response('bad id', { status: 400 });
  const range = req.headers.get('range');

  const local = downloads.localFile(id);
  if (local) return serveFile(local, range);

  // Pass the browser's Range request directly to upstream (e.g. bytes=0- or bytes=X-)
  // so the audio element receives a continuous stream and can seek to any position
  // without premature stream termination or 416 errors.
  const upstreamRange = range || 'bytes=0-';

  const exclude = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    let s;
    try {
      s = await stream.resolve(id, { exclude });
    } catch (e) {
      return new Response(e.message, { status: 502, headers: CORS });
    }
    try {
      const headers = { ...s.headers };
      if (upstreamRange) headers.Range = upstreamRange;
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
    // A cached URL may simply have expired: refresh once with the same method,
    // and only skip the method if a freshly resolved URL also fails.
    stream.invalidate(id, s.method, s.fresh);
    if (s.fresh) exclude.push(s.method);
  }
  return new Response('stream failed', { status: 502, headers: CORS });
}
