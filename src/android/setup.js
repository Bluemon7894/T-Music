// Runs before anything else in the app: answers window.api, which is what the page uses to reach the
// desktop app's main process, from the same code running right here.
import { Native, onNative } from './native.js';
import './proxyFetch.js';
import * as catalog from '../../electron/youtube/catalog.js';
import * as stream from '../../electron/youtube/stream.js';
import * as lyrics from '../../electron/lyrics/index.js';
import { translateLines } from '../../electron/lyrics/translate.js';
import { getClient } from '../../electron/youtube/client.js';
import * as downloads from './downloads.js';
import * as updater from './updater.js';
import * as auth from './auth.js';

const info = JSON.parse(Native.appInfo());
updater.setCurrentVersion(info.version);

// ---- the screen edges the system bars cover ----
const setInsets = (top, bottom) => {
  document.documentElement.style.setProperty('--safe-top', `${top || 0}px`);
  document.documentElement.style.setProperty('--safe-bottom', `${bottom || 0}px`);
};
setInsets(info.insetTop, info.insetBottom);
onNative('insets', ({ top, bottom, keyboard }) => {
  setInsets(top, bottom);
  document.documentElement.classList.toggle('kb-open', keyboard);
});

// ---- <audio> asks the phone for /stream/ID, and the phone asks here which URL that is ----
window.__tm.resolveStream = async (id, request) => {
  try {
    const s = await stream.resolve(id);
    Native.streamResolved(request, JSON.stringify({ url: s.url, method: s.method, fresh: s.fresh }));
  } catch (e) {
    console.warn('[stream]', e.message);
    Native.streamResolved(request, null);
  }
};
window.__tm.invalidateStream = (id, method, fresh) => stream.invalidate(id, method, fresh);

// ---- whether the app is on screen ----
let visible = true;
onNative('visibility', (event) => { visible = event.visible; });
document.hasFocus = () => visible;

// ---- web notifications become phone notifications ----
const clickHandlers = new Map();
let nextNotification = 1;
window.Notification = class {
  constructor(title, { body } = {}) {
    const id = String(nextNotification++);
    clickHandlers.set(id, this);
    Native.notify(id, title, body || '');
  }
};
onNative('notificationClick', ({ id }) => {
  clickHandlers.get(id)?.onclick?.();
  clickHandlers.delete(id);
});

// ---- links that open the app ----
function takeInvite() {
  const link = Native.takeLink();
  if (!link) return null;
  const room = /^tmusic:\/\/join\/([A-Za-z0-9]{6})/.exec(link);
  if (room) return { kind: 'room', code: room[1].toUpperCase() };
  const playlist = /^tmusic:\/\/playlist\/([A-Za-z0-9]{22})/.exec(link);
  return playlist ? { kind: 'playlist', code: playlist[1] } : null;
}

const noop = () => {};

// Everything electron/main.js answers that a phone has a use for. The rest does nothing here.
const api = {
  search: (q) => catalog.search(q),
  suggest: (q) => catalog.suggest(q),
  album: (id) => catalog.album(id),
  artist: (id) => catalog.artist(id),
  playlist: (id) => catalog.playlist(id),
  related: (id) => catalog.related(id),
  home: () => catalog.home(),
  lyrics: (track) => lyrics.getLyrics(track),
  refreshLyrics: (track) => lyrics.refreshLyrics(track),
  translateLyrics: (lines, target) => translateLines(lines, target),
  setLanguage: (language) => {
    catalog.setLanguage(language);
    window.TMusicNative.setLanguage(language);
  },
  lyricsCandidates: (track, query) => lyrics.getCandidates(track, query),
  cleanLyricsQuery: (track) => lyrics.getCleanSearchTerm(track),
  setCustomLyrics: (trackId, data) => lyrics.setCustom(trackId, data),
  prefetch: (id) => { if (!downloads.localFile(id)) stream.prefetch(id); return true; },
  status: () => ({ methods: stream.status(), version: info.version }),
  diagnose: () => stream.diagnose(),
  downloads: () => downloads.snapshot(),
  download: (tracks) => downloads.enqueue(tracks),
  cancelDownload: (id) => downloads.cancel(id),
  retryDownload: (id) => downloads.retry(id),
  removeDownload: (ids) => downloads.remove(ids),
  checkUpdate: () => updater.checkUpdate(),
  downloadUpdate: () => updater.downloadUpdate(),
  installUpdate: () => updater.installUpdate(),
  openExternal: (url) => Native.openExternal(String(url)),
  googleAvailable: () => auth.isGoogleConfigured(),
  googleSignIn: () => auth.googleSignIn(),
  cancelGoogleSignIn: () => auth.cancelGoogleSignIn(),
  copyText: (text) => Native.copyText(String(text)),
  shareText: (text) => Native.share(String(text)),
  saveFile: (name, mime, content) => new Promise((resolve) => {
    const stop = onNative('saved', ({ ok }) => { stop(); resolve(ok); });
    Native.saveDocument(name, mime, content);
  }),
  takeInvite: () => takeInvite(),
};

const mediaListeners = new Set();

window.api = {
  call: async (method, ...args) => (Object.hasOwn(api, method) ? api[method](...args) : noop()),
  onDownloads: (listener) => downloads.onDownloads(listener),
  onUpdateProgress: (listener) => updater.onUpdateProgress(listener),
  onInvite: (listener) => onNative('invite', listener),
  onMediaControl: (listener) => { mediaListeners.add(listener); return () => mediaListeners.delete(listener); },
};

// Warm up in the background so the first tap plays quickly.
getClient().catch(noop);
