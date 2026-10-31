import { app, BrowserWindow, clipboard, ipcMain, shell, Tray, Menu, nativeImage } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as catalog from './youtube/catalog.js';
import * as stream from './youtube/stream.js';
import * as lyrics from './lyrics/index.js';
import * as updater from './updater.js';
import { getClient } from './youtube/client.js';
import * as downloads from './downloads.js';
import * as discord from './discord.js';
import * as auth from './auth.js';
import { registerScheme, handleProtocol } from './protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BG = '#0a0712';

let tray = null;
let isQuitting = false;
let pendingInvite = null;

function rememberInvite(argv) {
  const match = argv.map((arg) => /^tmusic:\/\/join\/([A-Za-z0-9]{6})/.exec(arg)).find(Boolean);
  if (match) pendingInvite = match[1].toUpperCase();
  return Boolean(match);
}

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
  lyricsCandidates: (track, query) => lyrics.getCandidates(track, query),
  cleanLyricsQuery: (track) => lyrics.getCleanSearchTerm(track),
  setCustomLyrics: (trackId, lyricsData) => lyrics.setCustom(trackId, lyricsData),
  prefetch: (id) => { if (!downloads.localFile(id)) stream.prefetch(id); return true; },
  status: () => ({ methods: stream.status(), version: app.getVersion() }),
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
  updateTrayTooltip: (text) => { if (tray) tray.setToolTip(text || 'T-Music'); },
  updateTrayIcon: (dataUrl) => {
    if (!tray) return false;
    try {
      if (dataUrl) {
        const img = nativeImage.createFromDataURL(dataUrl);
        if (!img.isEmpty()) {
          tray.setImage(img.resize({ width: 32, height: 32 }));
          return true;
        }
      }
      tray.setImage(getAppNativeImage(32));
      return true;
    } catch {
      return false;
    }
  },
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
  chooseDownloadsDir: () => downloads.chooseFolder(),
  getDiscordRPC: () => discord.isEnabled(),
  setDiscordRPC: (val) => discord.setEnabled(val),
  getDiscordStatus: () => discord.getStatus(),
  setDiscordClientId: (id) => discord.setClientId(id),
  updateDiscordActivity: (data) => { discord.setActivity(data); return true; },
  clearDiscordActivity: () => { discord.clearActivity(); return true; },
  getAutoStart: () => {
    try {
      const s = app.getLoginItemSettings({
        path: process.execPath,
        args: ['--hidden'],
      });
      return Boolean(s.openAtLogin);
    } catch {
      return false;
    }
  },
  setAutoStart: (val) => {
    const enable = Boolean(val);
    try {
      app.setLoginItemSettings({
        openAtLogin: enable,
        path: process.execPath,
        args: ['--hidden'],
      });
      const s = app.getLoginItemSettings({
        path: process.execPath,
        args: ['--hidden'],
      });
      return s.openAtLogin !== undefined ? Boolean(s.openAtLogin) : enable;
    } catch (e) {
      console.warn('setAutoStart error:', e);
      return enable;
    }
  },
  openExternal: (url) => { if (/^https?:\/\//i.test(String(url))) shell.openExternal(url); },
  googleAvailable: () => auth.isGoogleConfigured(),
  googleSignIn: () => auth.googleSignIn(),
  cancelGoogleSignIn: () => auth.cancelGoogleSignIn(),
  copyText: (text) => clipboard.writeText(String(text)),
  takeInvite: () => {
    const code = pendingInvite;
    pendingInvite = null;
    return code;
  },
};

ipcMain.handle('api', async (_e, method, ...args) => {
  const fn = api[method];
  if (!fn) throw new Error('unknown method ' + method);
  return fn(...args);
});

function getAppIconPath() {
  const candidates = [
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(process.resourcesPath || '', 'build', 'icon.png'),
    path.join(process.resourcesPath || '', 'app', 'electron', 'icon.png'),
    path.join(__dirname, '..', 'src', 'assets', 'logo-mark.png'),
    path.join(__dirname, '..', 'dist', 'assets', 'logo-mark.png'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function getAppNativeImage(size = 32) {
  const iconPath = getAppIconPath();
  if (!iconPath) return nativeImage.createEmpty();
  const img = nativeImage.createFromPath(iconPath);
  return size ? img.resize({ width: size, height: size }) : img;
}

function createWindow() {
  const iconPath = getAppIconPath();
  const win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: BG,
    title: 'T-Music',
    icon: iconPath || undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: 'rgba(0, 0, 0, 0)', symbolColor: '#c4b5fd', height: 52 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const isHidden = process.argv.includes('--hidden');
  if (!isHidden) win.once('ready-to-show', () => win.show());

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
  const image = getAppNativeImage(32);
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

  // Only an installed copy registers the link type; a dev build would point it at electron.exe.
  if (app.isPackaged) app.setAsDefaultProtocolClient('tmusic');
  rememberInvite(process.argv);

  app.on('second-instance', (_e, argv) => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (!win.isVisible()) win.show();
      if (win.isMinimized()) win.restore();
      win.focus();
      if (rememberInvite(argv)) win.webContents.send('invite');
    }
  });

  app.whenReady().then(async () => {
    handleProtocol();
    if (process.env.TMUSIC_DIAGNOSE) {
      for (const r of await stream.diagnose()) console.log('DIAG', JSON.stringify(r));
      app.quit();
      return;
    }
    const win = createWindow();
    createTray(win);
    // Warm up in the background so the first click plays quickly.
    getClient().catch(() => {});
  });

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin' || !isQuitting) {
      // Keep alive in tray
    } else {
      app.quit();
    }
  });
}
