import { app, BrowserWindow, ipcMain, protocol, net, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import * as catalog from './yt/catalog.js';
import * as stream from './yt/stream.js';
import * as ytdlp from './yt/ytdlp.js';
import { getClient } from './yt/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// <audio src="ytm://stream/VIDEO_ID"> is served by the handler below, which
// resolves the id to a googlevideo URL and pipes the bytes through. That keeps
// URL expiry and method fallback invisible to the renderer.
protocol.registerSchemesAsPrivileged([
  { scheme: 'ytm', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
]);

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

async function handleStream(req) {
  const id = new URL(req.url).pathname.slice(1);
  if (!/^[\w-]{11}$/.test(id)) return new Response('bad id', { status: 400 });
  const range = req.headers.get('range');
  const exclude = [];

  for (let attempt = 0; attempt < 6; attempt++) {
    let s;
    try {
      s = await stream.resolve(id, { exclude });
    } catch (e) {
      return new Response(e.message, { status: 502 });
    }
    try {
      const headers = { ...s.headers };
      if (range) headers.Range = range;
      const res = await net.fetch(s.url, { headers, bypassCustomProtocolHandlers: true });
      if (res.status === 200 || res.status === 206) {
        const h = new Headers();
        for (const k of PASS_HEADERS) {
          const v = res.headers.get(k);
          if (v) h.set(k, v);
        }
        if (!h.has('accept-ranges')) h.set('accept-ranges', 'bytes');
        return new Response(res.body, { status: res.status, headers: h });
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
  return new Response('stream failed', { status: 502 });
}

const api = {
  search: (q) => catalog.search(q),
  suggest: (q) => catalog.suggest(q),
  album: (id) => catalog.album(id),
  artist: (id) => catalog.artist(id),
  playlist: (id) => catalog.playlist(id),
  related: (id) => catalog.related(id),
  home: () => catalog.home(),
  prefetch: (id) => { stream.prefetch(id); return true; },
  status: () => ({ methods: stream.status(), ytdlp: ytdlp.state }),
  diagnose: () => stream.diagnose(),
};

ipcMain.handle('api', async (_e, method, ...args) => {
  const fn = api[method];
  if (!fn) throw new Error('unknown method ' + method);
  return fn(...args);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#000000',
    title: 'T-Music',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#000000', symbolColor: '#b3b3b3', height: 56 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.VITE_DEV_URL) win.loadURL(process.env.VITE_DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    protocol.handle('ytm', handleStream);
    if (process.env.TMUSIC_DIAGNOSE) {
      await ytdlp.ensure().catch((e) => console.log('yt-dlp setup failed:', e.message));
      console.log('yt-dlp', JSON.stringify(ytdlp.state));
      for (const r of await stream.diagnose()) console.log('DIAG', JSON.stringify(r));
      app.quit();
      return;
    }
    createWindow();
    // Warm up in the background so the first click plays quickly.
    getClient().catch(() => {});
    ytdlp.ensure().catch(() => {});
  });

  app.on('window-all-closed', () => app.quit());
}
