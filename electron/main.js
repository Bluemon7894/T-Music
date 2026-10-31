import { app, BrowserWindow, clipboard, ipcMain, screen, session, shell, Tray, Menu, nativeImage } from 'electron';
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
import * as lang from './lang.js';
import { translateLines } from './lyrics/translate.js';
import { registerScheme, handleProtocol } from './protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BG = '#0a0712';

let tray = null;
let trayWindow = null;
let isQuitting = false;
let pendingInvite = null;
let sizeBeforeMini = null;

const MINI_SIZE = { width: 400, height: 136 };
const MINI_MARGIN = 16;
const NORMAL_MIN_SIZE = [1024, 640];

function rememberInvite(argv) {
  for (const arg of argv) {
    const room = /^tmusic:\/\/join\/([A-Za-z0-9]{6})/.exec(arg);
    const playlist = /^tmusic:\/\/playlist\/([A-Za-z0-9]{22})/.exec(arg);
    if (room) pendingInvite = { kind: 'room', code: room[1].toUpperCase() };
    if (playlist) pendingInvite = { kind: 'playlist', code: playlist[1] };
    if (room || playlist) return true;
  }
  return false;
}

function setMiniMode(on) {
  const [win] = BrowserWindow.getAllWindows();
  if (!win || on === Boolean(sizeBeforeMini)) return;
  if (on) {
    sizeBeforeMini = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    if (win.isMaximized()) win.unmaximize();
    const { workArea } = screen.getDisplayMatching(win.getBounds());
    win.setMinimumSize(MINI_SIZE.width, MINI_SIZE.height);
    win.setBounds({ ...MINI_SIZE, x: workArea.x + workArea.width - MINI_SIZE.width - MINI_MARGIN, y: workArea.y + workArea.height - MINI_SIZE.height - MINI_MARGIN });
    win.setResizable(false);
    win.setMaximizable(false);
    win.setAlwaysOnTop(true, 'floating');
  } else {
    const { bounds, maximized } = sizeBeforeMini;
    sizeBeforeMini = null;
    win.setAlwaysOnTop(false);
    win.setResizable(true);
    win.setMaximizable(true);
    win.setMinimumSize(...NORMAL_MIN_SIZE);
    win.setBounds(bounds);
    if (maximized) win.maximize();
  }
}

registerScheme();

const api = {
  search: (q) => catalog.search(q),
  suggest: (q) => catalog.suggest(q),
  album: (id) => catalog.album(id),
  artist: (id) => catalog.artist(id),
  playlist: (id) => catalog.playlist(id),
  translateLyrics: (lines, target) => translateLines(lines, target),
  setLanguage: (language) => {
    lang.setLanguage(language);
    catalog.setLanguage(language);
    updateTrayMenu();
  },
  related: (id) => catalog.related(id),
  home: () => catalog.home(),
  lyrics: (track) => lyrics.getLyrics(track),
  refreshLyrics: (track) => lyrics.refreshLyrics(track),
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
  setMiniMode: (on) => setMiniMode(Boolean(on)),
  showWindow: () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  },
  takeInvite: () => {
    const invite = pendingInvite;
    pendingInvite = null;
    return invite;
  },
};

// Only the app's own page may use the API, and only the methods listed above.
function isAppPage(url) {
  return process.env.VITE_DEV_URL ? String(url).startsWith(process.env.VITE_DEV_URL) : String(url).startsWith('file://');
}

ipcMain.handle('api', async (e, method, ...args) => {
  if (!isAppPage(e.senderFrame?.url)) throw new Error('not allowed');
  if (!Object.hasOwn(api, method)) throw new Error('unknown method ' + method);
  return api[method](...args);
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

  // A dropped link or file must never replace the app with another page, which would get its API.
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.VITE_DEV_URL) win.loadURL(process.env.VITE_DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  return win;
}

function updateTrayMenu() {
  if (!tray || !trayWindow) return;
  const win = trayWindow;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: lang.say('T-Music 열기', 'Open T-Music'),
      click: () => {
        win.show();
        win.focus();
      },
    },
    { type: 'separator' },
    {
      label: lang.say('재생 / 일시정지', 'Play / Pause'),
      click: () => win.webContents.send('media-control', 'toggle'),
    },
    {
      label: lang.say('다음 곡', 'Next track'),
      click: () => win.webContents.send('media-control', 'next'),
    },
    {
      label: lang.say('이전 곡', 'Previous track'),
      click: () => win.webContents.send('media-control', 'prev'),
    },
    { type: 'separator' },
    {
      label: lang.say('종료', 'Quit'),
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function createTray(win) {
  trayWindow = win;
  if (tray) return;
  const image = getAppNativeImage(32);
  tray = new Tray(image);
  tray.setToolTip('T-Music');
  updateTrayMenu();

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
    session.defaultSession.flushStorageData();
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
