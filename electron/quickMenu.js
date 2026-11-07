// The quick menu: a global shortcut (Win+Y by default) dims whatever is on screen and slides a small
// T-Music panel over it, like a console's guide button. It's a transparent window of its own over the
// screen the mouse is on. It owns no music: the main window sends it what's playing a few times a
// second while it's open, and it sends back what was pressed.
import { app, BrowserWindow, globalShortcut, screen } from 'electron';
import fs from 'fs';
import path from 'path';

export const SHORTCUTS = ['Super+Y', 'Super+J', 'Control+Shift+Space', 'Control+Alt+M'];
const DEFAULT = SHORTCUTS[0];
const settingsFile = () => path.join(app.getPath('userData'), 'quick-menu.json');

let quickWin = null;
let mainWin = null;
let load = null;
let chosen = DEFAULT; // what the person picked, or 'off'
let active = null; // what is actually registered right now
let failed = []; // keys another program already holds

function readSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (saved.shortcut === 'off' || isValidShortcut(saved.shortcut)) chosen = saved.shortcut;
  } catch { /* the default */ }
}

function writeSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify({ shortcut: chosen })); } catch { /* this session only */ }
}

// The chosen key, or the next free one if another program has it.
function register() {
  if (active) globalShortcut.unregister(active);
  active = null;
  failed = [];
  if (chosen === 'off') return;
  const order = [chosen, ...SHORTCUTS.filter((k) => k !== chosen)];
  for (const key of order) {
    let ok = false;
    try { ok = globalShortcut.register(key, toggle); } catch { ok = false; }
    if (ok) {
      active = key;
      return;
    }
    failed.push(key);
  }
}

function makeWindow() {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { preload: load.preload, contextIsolation: true, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.on('blur', () => hide());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (load.url) win.loadURL(`${load.url}#quick`);
  else win.loadFile(load.file, { hash: 'quick' });
  return win;
}

export const isQuickVisible = () => Boolean(quickWin && !quickWin.isDestroyed() && quickWin.isVisible());

function show() {
  if (!quickWin || quickWin.isDestroyed()) quickWin = makeWindow();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  quickWin.setBounds(display.bounds);
  quickWin.showInactive();
  quickWin.focus();
  quickWin.moveTop();
  mainWin?.webContents.send('quick-active', true);
  quickWin.webContents.send('quick-open');
}

export function hide() {
  if (!isQuickVisible()) return;
  quickWin.webContents.send('quick-close');
  mainWin?.webContents.send('quick-active', false);
  // The panel slides away first; the window goes when it's done.
  setTimeout(() => { if (quickWin && !quickWin.isDestroyed()) quickWin.hide(); }, 220);
}

export function toggle() {
  if (isQuickVisible()) hide();
  else show();
}

export function setupQuickMenu(win, options) {
  mainWin = win;
  load = options;
  readSettings();
  register();
  // Made ahead of time, so the first press opens instantly.
  setTimeout(() => { if (!quickWin) quickWin = makeWindow(); }, 4000);
  app.on('will-quit', () => globalShortcut.unregisterAll());
}

// From the main window: what's playing.
export function relayState(state) {
  if (isQuickVisible()) quickWin.webContents.send('quick-state', state);
}

// From the quick menu: something was pressed.
export function relayCommand(command, arg) {
  if (command === 'close') return hide();
  if (command === 'openApp') {
    hide();
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
    return undefined;
  }
  mainWin?.webContents.send('quick-command', command, arg);
  return undefined;
}

export function shortcutInfo() {
  return { chosen, active, failed, standard: DEFAULT };
}

// While the settings are listening for a new key, the current one must not open the menu.
export function pauseShortcut(paused) {
  if (paused) {
    if (active) globalShortcut.unregister(active);
    active = null;
  } else {
    register();
  }
  return shortcutInfo();
}

// Any key with at least one modifier, or a function key alone, in Electron's accelerator form.
const MODIFIER = /^(Super|Control|Alt|Shift)$/;
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|[`\-=[\]\\;',./])$/;
export function isValidShortcut(accel) {
  if (typeof accel !== 'string') return false;
  const parts = accel.split('+').map((p) => (p === '' ? 'Plus' : p));
  const key = parts.pop();
  if (!KEY.test(key) || new Set(parts).size !== parts.length || !parts.every((p) => MODIFIER.test(p))) return false;
  return parts.length > 0 || /^F\d+$/.test(key);
}

// Returns the new state, with `ok: false` if the key couldn't be taken (the old one stays).
export function setShortcut(key) {
  if (key !== 'off' && !isValidShortcut(key)) return { ...shortcutInfo(), ok: false, reason: 'invalid' };
  if (key === 'off') {
    chosen = 'off';
    writeSettings();
    register();
    return { ...shortcutInfo(), ok: true };
  }
  if (active) globalShortcut.unregister(active);
  let ok = false;
  try { ok = globalShortcut.register(key, toggle); } catch { ok = false; }
  if (!ok) {
    register(); // put the old one back
    return { ...shortcutInfo(), ok: false, reason: 'taken', tried: key };
  }
  globalShortcut.unregister(key);
  chosen = key;
  writeSettings();
  register();
  return { ...shortcutInfo(), ok: true };
}
