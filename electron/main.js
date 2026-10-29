import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as catalog from './youtube/catalog.js';
import * as stream from './youtube/stream.js';
import * as ytdlp from './youtube/ytdlp.js';
import * as lyrics from './youtube/lyrics.js';
import { getClient } from './youtube/client.js';
import * as downloads from './downloads.js';
import { registerScheme, handleProtocol } from './protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BG = '#0a0712';

registerScheme();

const api = {
  search: (q) => catalog.search(q),
  suggest: (q) => catalog.suggest(q),
  album: (id) => catalog.album(id),
  artist: (id) => catalog.artist(id),
  playlist: (id) => catalog.playlist(id),
  related: (id) => catalog.related(id),
  home: () => catalog.home(),
  lyrics: (track) => lyrics.getLyrics(track),
  prefetch: (id) => { if (!downloads.localFile(id)) stream.prefetch(id); return true; },
  status: () => ({ methods: stream.status(), ytdlp: ytdlp.state, version: app.getVersion() }),
  diagnose: () => stream.diagnose(),
  downloads: () => downloads.list(),
  download: (tracks) => downloads.enqueue(tracks),
  cancelDownload: (id) => downloads.cancel(id),
  retryDownload: (id) => downloads.retry(id),
  removeDownload: (ids) => downloads.remove(ids),
  openDownloads: () => downloads.openFolder(),
};

ipcMain.handle('api', async (_e, method, ...args) => {
  const fn = api[method];
  if (!fn) throw new Error('unknown method ' + method);
  return fn(...args);
});

function createWindow() {
  const icon = path.join(__dirname, '..', 'build', 'icon.png');
  const win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: BG,
    title: 'T-Music',
    icon: fs.existsSync(icon) ? icon : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#c4b5fd', height: 52 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());

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
  app.setAppUserModelId('com.bluemon7894.tmusic');

  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    handleProtocol();
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
