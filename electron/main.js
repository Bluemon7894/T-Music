import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as catalog from './youtube/catalog.js';
import * as stream from './youtube/stream.js';
import * as ytdlp from './youtube/ytdlp.js';
import * as lyrics from './youtube/lyrics.js';
import * as updater from './updater.js';
import { getClient } from './youtube/client.js';
import * as downloads from './downloads.js';
import { registerScheme, handleProtocol } from './protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BG = '#0a0712';

let tray = null;
let isQuitting = false;

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
  checkUpdate: () => updater.checkUpdate(),
  downloadUpdate: () => {
    const [win] = BrowserWindow.getAllWindows();
    return updater.downloadUpdate(win?.webContents);
  },
  installUpdate: () => updater.installUpdate(),
  setGithubToken: (tok) => updater.setGithubToken(tok),
  updateTrayTooltip: (text) => { if (tray) tray.setToolTip(text || 'T-Music'); },
  setTitleBarOverlay: (opts) => {
    const [win] = BrowserWindow.getAllWindows();
    if (win && typeof win.setTitleBarOverlay === 'function') {
      try {
        win.setTitleBarOverlay(opts);
      } catch (e) {
        console.warn('setTitleBarOverlay failed:', e);
      }
    }
    return true;
  },
  openExternal: (url) => { if (url) shell.openExternal(url); },
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
    titleBarOverlay: { color: 'rgba(0, 0, 0, 0)', symbolColor: '#c4b5fd', height: 52 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.VITE_DEV_URL) win.loadURL(process.env.VITE_DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  return win;
}

function createTray(win) {
  if (tray) return;
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  const image = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(image);
  tray.setToolTip('T-Music');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'T-Music 열기',
      click: () => {
        win.show();
        win.focus();
      },
    },
    { type: 'separator' },
    {
      label: '재생 / 일시정지',
      click: () => win.webContents.send('media-control', 'toggle'),
    },
    {
      label: '다음 곡',
      click: () => win.webContents.send('media-control', 'next'),
    },
    {
      label: '이전 곡',
      click: () => win.webContents.send('media-control', 'prev'),
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (win.isVisible()) {
      if (win.isFocused()) {
        win.hide();
      } else {
        win.focus();
      }
    } else {
      win.show();
      win.focus();
    }
  });

  tray.on('double-click', () => {
    win.show();
    win.focus();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.bluemon7894.tmusic');

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (!win.isVisible()) win.show();
      if (win.isMinimized()) win.restore();
      win.focus();
    }
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
    const win = createWindow();
    createTray(win);
    // Warm up in the background so the first click plays quickly.
    getClient().catch(() => {});
    ytdlp.ensure().catch(() => {});
  });

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin' || !isQuitting) {
      // Keep alive in tray
    } else {
      app.quit();
    }
  });
}
