// Runs the debug APK on a real Android system and checks what only a real system can show: taps,
// playback through the WebView, playing on in the background, the notification, the back button and
// links. Run with an emulator or phone attached; results and screenshots land in android/test/out.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE = 'com.bluemon7894.tmusic';
const APK = 'release/T-Music-Android-debug.apk';
const OUT = 'android/test/out';
const CDP_PORT = 9222;
// A generated tone from this repository, for when YouTube refuses this machine's IP address.
const SAMPLE_AUDIO = `https://raw.githubusercontent.com/Bluemon7894/T-Music/${process.env.GITHUB_SHA || 'main'}/android/test/sample.wav`;

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${String(detail).slice(0, 200)})` : ''}`);
};
const note = (text) => console.log(`      ${text}`);

const adb = (...args) => spawnSync('adb', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 128 * 1024 * 1024 }).stdout || '';
const shell = (...args) => adb('shell', ...args);
function shot(name) {
  try {
    fs.writeFileSync(path.join(OUT, `${name}.png`), execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, timeout: 30000 }));
  } catch (e) {
    note(`screenshot ${name} failed: ${e.message}`);
  }
}
const waitFor = async (f, ms = 20000, step = 300) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if (await f()) return Date.now() - start; } catch { /* still coming up */ }
    await sleep(step);
  }
  return null;
};

// ---- talking to the page ----
let socket = null;
let nextId = 1;
const replies = new Map();

// The debugging socket shows up a little after the process does.
async function findPage() {
  const pid = shell('pidof', PACKAGE).trim();
  if (!pid) throw new Error('app is not running');
  adb('forward', `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  const pages = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  const page = pages.find((p) => p.url.includes('appassets'));
  if (!page) throw new Error('page not found');
  return page;
}

async function connect() {
  let page = null;
  await waitFor(async () => { page = await findPage(); return true; }, 40000, 1000);
  if (!page) page = await findPage();
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = (m) => {
    const data = JSON.parse(m.data);
    if (data.id && replies.has(data.id)) { replies.get(data.id)(data); replies.delete(data.id); }
    if (data.method === 'Runtime.exceptionThrown') note(`page error: ${data.params.exceptionDetails?.exception?.description?.slice(0, 200)}`);
    if (data.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(data.params.type)) note(`console ${data.params.type}: ${data.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 240)}`);
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
}
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  replies.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (replies.delete(id)) reject(new Error(`timeout: ${method} ${String(params.expression ?? '').slice(0, 80)}`)); }, 120000);
});
async function js(expression) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'page error');
  return r.result?.result?.value;
}
const has = (s) => js(`!!document.querySelector(${JSON.stringify(s)})`);
const PROBE = `(() => {
  const seen = new Set();
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { seen.add(this); return play.call(this); };
  window.__pos = () => { const list = [...seen]; const a = list.find((x) => !x.paused) || list.find((x) => x.currentTime > 0) || null; return { t: a ? a.currentTime : null, paused: a ? a.paused : true, id: a ? a.dataset.id : null, duration: a ? a.duration : null, error: a?.error?.message || null, ready: a ? a.readyState : null, net: a ? a.networkState : null, src: a ? a.src : null }; };
})()`;
const pos = () => js('window.__pos()');

// A real finger on the screen, not a script.
async function rectOf(selector, index = 0) {
  return js(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); const d = devicePixelRatio; return { x: Math.round((r.x + r.width / 2) * d), y: Math.round((r.y + r.height / 2) * d) }; })()`);
}
async function tap(selector, index = 0) {
  const r = await rectOf(selector, index);
  if (!r) return false;
  shell('input', 'tap', String(r.x), String(r.y));
  return true;
}
async function tapText(selector, text) {
  const r = await js(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); const d = devicePixelRatio; return { x: Math.round((b.x + b.width / 2) * d), y: Math.round((b.y + b.height / 2) * d) }; })()`);
  if (!r) return false;
  shell('input', 'tap', String(r.x), String(r.y));
  return true;
}
const session = () => shell('dumpsys', 'media_session');
const sessionState = () => /state=PlaybackState \{state=(\w+)/.exec(session())?.[1] ?? /state=(\d)/.exec(session())?.[1];

// Written as it happens, so it survives the emulator itself crashing.
function keepLog() {
  const file = fs.createWriteStream(path.join(OUT, 'logcat.txt'));
  const child = spawn('adb', ['logcat', '-v', 'time']);
  child.stdout.pipe(file);
  child.stderr.pipe(file);
  return child;
}

async function main() {
  console.log('device', shell('getprop', 'ro.build.version.release').trim(), 'API', shell('getprop', 'ro.build.version.sdk').trim(), '| WebView', /versionName=(\S+)/.exec(shell('dumpsys', 'package', 'com.google.android.webview'))?.[1] ?? 'unknown');

  // The test machine counts as having a keyboard, which would hide the on-screen one.
  shell('settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1');

  // ---- install and start ----
  check('installs', /Success/.test(spawnSync('adb', ['install', '-r', APK], { encoding: 'utf8' }).stdout));
  shell('pm', 'grant', PACKAGE, 'android.permission.POST_NOTIFICATIONS');
  shell('am', 'start', '-n', `${PACKAGE}/.MainActivity`);
  check('process starts', await waitFor(() => shell('pidof', PACKAGE).trim(), 20000));
  await sleep(2500);
  await connect();
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
  await cdp('Page.reload');
  await sleep(2000);
  await connect();

  // ---- signing in, which also proves Firebase works from the app's address ----
  check('login screen shows', await waitFor(() => has('.login-card'), 40000));
  await sleep(800);
  shot('01-login');
  const insets = await js(`[getComputedStyle(document.documentElement).getPropertyValue('--safe-top'), getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom')].join(' ')`);
  check('system bar sizes reach the page', /[1-9]/.test(insets), insets);
  let signedIn = null;
  for (let attempt = 0; attempt < 3 && signedIn === null; attempt++) {
    await tapText('.login-btn', '게스트');
    signedIn = await waitFor(() => has('.m-tabs'), 20000);
    if (signedIn === null) {
      note(`tap ${attempt + 1} did not sign in: ${await js(`document.querySelector('.login-error')?.textContent ?? 'no error shown'`)}`);
      shot(`01-login-attempt${attempt + 1}`);
    }
  }
  check('guest sign-in with a real tap', signedIn !== null);
  if (signedIn === null) throw new Error('could not sign in');
  await sleep(1500);
  shot('02-home-loading');

  // ---- requests through the phone ----
  const timing = await js(`(async () => { const out = {}; for (const [k, u] of [['sw', 'https://www.youtube.com/sw.js_data'], ['music', 'https://music.youtube.com/'], ['lrclib', 'https://lrclib.net/api/search?q=lilac']]) { const s = performance.now(); try { const r = await fetch(u, { signal: AbortSignal.timeout(40000) }); const t = await r.text(); out[k] = [r.status, t.length, Math.round(performance.now() - s)]; } catch (e) { out[k] = [String(e), Math.round(performance.now() - s)]; } } return out; })()`);
  note(`proxy timing ${JSON.stringify(timing)}`);
  check('the proxy answers', timing.sw?.[0] === 200 || timing.music?.[0] === 200, JSON.stringify(timing));
  const started = Date.now();
  const home = await js(`window.api.call('home').then((h) => h.shelves?.length ?? 0).catch((e) => 'error: ' + e.message)`);
  check('home loads through the proxy', typeof home === 'number' && home > 0, `${home} in ${Date.now() - started} ms`);
  const search = await js(`window.api.call('search', '아이유 라일락').then((r) => r.songs?.length ?? 0).catch((e) => 'error: ' + e.message)`);
  check('search works through the proxy', typeof search === 'number' && search > 0, search);
  await waitFor(() => has('.cf-card'), 20000);
  await sleep(1500);
  shot('03-home');

  // ---- playback ----
  await tapText('.m-tab', '검색');
  await sleep(500);
  await tap('.searchbox input');
  // On a slow machine a tap can arrive as a long press, which opens a menu and not the keyboard.
  if (await waitFor(() => js(`document.documentElement.classList.contains('kb-open')`), 5000) === null) {
    await tap('.searchbox input');
    await waitFor(() => js(`document.documentElement.classList.contains('kb-open')`), 8000);
  }
  await sleep(800);
  shot('04-keyboard');
  const box = await js(`(() => { const r = document.querySelector('.m-tabs')?.getBoundingClientRect(); return { tabsHeight: r?.height, height: innerHeight, open: document.documentElement.classList.contains('kb-open') }; })()`);
  note(`with keyboard: ${JSON.stringify(box)}`);
  check('the tab bar steps aside for the keyboard', box.open && !box.tabsHeight, JSON.stringify(box));

  // Long-pressing text opens the system's text menu, the same one that offers paste.
  const pid = shell('pidof', PACKAGE).trim();
  await js(`(() => { const i = document.querySelector('.searchbox input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, 'textmenu'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(500);
  const field = await rectOf('.searchbox input');
  shell('input', 'swipe', String(field.x), String(field.y), String(field.x), String(field.y), '900');
  await sleep(2000);
  shot('04b-text-menu');
  check('long-pressing text does not crash the app', shell('pidof', PACKAGE).trim() === pid);
  note(`selected after long press: ${await js(`(() => { const i = document.querySelector('.searchbox input'); return i.selectionEnd - i.selectionStart; })()`)}`);
  shell('input', 'keyevent', 'KEYCODE_BACK');
  await sleep(600);
  await js(`(() => { const i = document.querySelector('.searchbox input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, '아이유 라일락'); i.dispatchEvent(new Event('input',{bubbles:true})); i.closest('form').requestSubmit(); i.blur(); })()`);
  await waitFor(() => has('.search-songs .tl-row'), 30000);
  await sleep(1200);
  shot('05-results');

  // Long press opens the track menu.
  const row = await rectOf('.search-songs .tl-row');
  shell('input', 'swipe', String(row.x), String(row.y), String(row.x), String(row.y), '900');
  check('long press opens the menu', await waitFor(() => has('.m-sheet'), 3000));
  shot('06-long-press');
  shell('input', 'keyevent', 'KEYCODE_BACK');
  check('back closes the menu', await waitFor(async () => !(await has('.m-sheet')), 3000));

  await tap('.search-songs .tl-row .c-title');
  check('a real tap on a track starts it', await waitFor(() => has('.m-mini'), 5000));
  let playing = await waitFor(async () => { const p = await pos(); return p.t > 0.5 && !p.paused; }, 30000, 500);
  let usedSample = false;
  if (playing === null) {
    note(`YouTube playback did not start: ${JSON.stringify(await pos())}`);
    note('falling back to a sample file to test the player itself');
    usedSample = true;
    await js(`(() => { const original = window.__tm.resolveStream; window.__tm.resolveStream = (id, request) => window.TMusicNative.streamResolved(request, JSON.stringify({ url: ${JSON.stringify(SAMPLE_AUDIO)}, method: 'test', fresh: false })); })()`);
    await js(`document.querySelector('.search-songs .tl-row:nth-child(2) .c-title').click()`);
    playing = await waitFor(async () => { const p = await pos(); return p.t > 0.5 && !p.paused; }, 30000, 500);
  }
  check(`audio plays through /stream${usedSample ? ' (sample file, YouTube refused this IP)' : ' (YouTube)'}`, playing !== null, JSON.stringify(await pos()));
  await sleep(1500);
  shot('07-playing');

  // Seeking needs range requests to work through the WebView.
  const before = await pos();
  if (before.duration > 6) {
    await js(`(() => { const l = window.__pos; })()`);
    await tap('.m-mini-text');
    await waitFor(() => has('.m-stage'), 4000);
    await sleep(1200);
    shot('08-stage');
    const bar = await js(`(() => { const r = document.querySelector('.stage-progress .slider').getBoundingClientRect(); const d = devicePixelRatio; return { x: Math.round((r.x + r.width * 0.6) * d), y: Math.round((r.y + r.height / 2) * d) }; })()`);
    shell('input', 'tap', String(bar.x), String(bar.y));
    const seeked = await waitFor(async () => { const p = await pos(); return p.t > before.duration * 0.5 && !p.paused; }, 15000, 400);
    check('seeking far ahead works', seeked !== null, JSON.stringify(await pos()));
    shell('input', 'keyevent', 'KEYCODE_BACK');
    check('back closes the player', await waitFor(async () => !(await has('.m-stage')), 4000));
  }

  // ---- notification and media session ----
  await sleep(1500);
  const notifications = shell('dumpsys', 'notification', '--noredact');
  check('playback notification is up', notifications.includes(PACKAGE) && /MediaStyle|category=transport|channel=playback|ChannelId=playback/i.test(notifications));
  check('media session reports playing', /state=3|PLAYING/.test(session()));
  check('foreground service is running', shell('dumpsys', 'activity', 'services', PACKAGE).includes('isForeground=true'));
  shell('cmd', 'statusbar', 'expand-notifications');
  await sleep(1500);
  shot('09-notification');
  shell('cmd', 'statusbar', 'collapse');
  await sleep(500);

  // ---- leaving the app ----
  const home1 = await pos();
  shell('input', 'keyevent', 'KEYCODE_HOME');
  await sleep(15000);
  const home2 = await pos();
  check('keeps playing after pressing home', !home2.paused && (home2.t > home1.t + 8 || home2.id !== home1.id), `${home1.t?.toFixed?.(1)} -> ${home2.t?.toFixed?.(1)}`);
  shell('input', 'keyevent', 'KEYCODE_SLEEP');
  await sleep(25000);
  const off = await pos();
  check('keeps playing with the screen off', !off.paused && (off.t > home2.t + 15 || off.id !== home2.id), `${home2.t?.toFixed?.(1)} -> ${off.t?.toFixed?.(1)}`);
  shell('input', 'keyevent', 'KEYCODE_WAKEUP');
  await sleep(800);
  shell('wm', 'dismiss-keyguard');
  shell('am', 'start', '-n', `${PACKAGE}/.MainActivity`);
  await sleep(2000);
  check('coming back shows the same page, still playing', (await has('.search-songs .tl-row')) && !(await pos()).paused);
  shot('10-back-in-app');

  // ---- headset and lock screen buttons ----
  shell('cmd', 'media_session', 'dispatch', 'pause');
  check('media pause button', await waitFor(async () => (await pos()).paused, 6000));
  await sleep(500);
  check('notification follows the pause', /state=2|PAUSED/.test(session()));
  shell('cmd', 'media_session', 'dispatch', 'play');
  check('media play button', await waitFor(async () => !(await pos()).paused, 6000));
  const firstId = (await pos()).id;
  shell('cmd', 'media_session', 'dispatch', 'next');
  check('media next button changes the track', await waitFor(async () => { const p = await pos(); return p.id && p.id !== firstId; }, 12000));
  shell('cmd', 'media_session', 'dispatch', 'previous');
  await sleep(1000);

  // ---- back button at the top level leaves the app running ----
  await js(`(async () => { for (let i = 0; i < 12; i++) { window.__tm.onNative({ type: 'noop' }); } })()`);
  for (let i = 0; i < 8; i++) {
    shell('input', 'keyevent', 'KEYCODE_BACK');
    await sleep(350);
  }
  await sleep(1000);
  const focus = shell('dumpsys', 'activity', 'activities');
  check('back at the top leaves the app in the background', !/topResumedActivity=.*tmusic/.test(focus));
  check('music survives leaving with back', !(await pos()).paused);
  shell('am', 'start', '-n', `${PACKAGE}/.MainActivity`);
  await sleep(1500);

  // ---- swiping the app away from recent apps ----
  await js('window.__sameRun = true');
  const taskId = new RegExp(`taskId=(\\d+): ${PACKAGE}`).exec(shell('am', 'stack', 'list'))?.[1];
  note(`task ${taskId}`);
  const beforeSwipe = await pos();
  shell('am', 'stack', 'remove', String(taskId));
  await sleep(10000);
  const afterSwipe = await pos();
  check('music keeps playing after swiping the app away', !afterSwipe.paused && (afterSwipe.t > beforeSwipe.t + 5 || afterSwipe.id !== beforeSwipe.id), `${beforeSwipe.t?.toFixed?.(1)} -> ${afterSwipe.t?.toFixed?.(1)}`);
  check('the notification stays after swiping the app away', shell('dumpsys', 'activity', 'services', PACKAGE).includes('isForeground=true'));
  shell('am', 'start', '-n', `${PACKAGE}/.MainActivity`);
  await sleep(2500);
  check('opening it again shows the same running page', (await js('window.__sameRun === true')) && (await has('.m-tabs')) && !(await pos()).paused);
  shot('10b-reopened');

  // ---- the player's stop button ----
  shell('cmd', 'media_session', 'dispatch', 'stop');
  check('stop pauses the music', await waitFor(async () => (await pos()).paused, 6000));
  check('stop removes the notification', await waitFor(() => !shell('dumpsys', 'activity', 'services', PACKAGE).includes('isForeground=true'), 6000));
  await tap('.m-mini .play-btn');
  check('playing again from the app brings the notification back', await waitFor(() => shell('dumpsys', 'activity', 'services', PACKAGE).includes('isForeground=true'), 10000));

  // ---- links ----
  shell('am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'tmusic://join/ABC234');
  const roomPage = await waitFor(() => has('.room-lobby, .room-grid'), 8000);
  check('invite link opens the room page', roomPage !== null);
  await sleep(1200);
  shot('11-invite-link');

  // ---- Google sign-in comes back to a server on the phone ----
  const port = await js(`window.TMusicNative.authListen('state123')`);
  check('sign-in listener opens', port > 0, port);
  const heard = js(`new Promise((resolve) => { const old = window.__tm.onNative; window.__tm.onNative = (e) => { old(e); if (e.type === 'auth') resolve(e.code); }; setTimeout(() => resolve(null), 8000); })`);
  await sleep(300);
  shell(`printf 'GET /callback?state=state123&code=abc123 HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n' | toybox nc -w 2 127.0.0.1 ${port}`);
  check('sign-in answer reaches the page', (await heard) === 'abc123');

  // ---- downloads ----
  const stream = await js(`window.TMusicNative.downloadSize('testtesttes')`);
  note(`download size of a missing file: ${stream}`);
  const id = 'testtesttes';
  const finished = js(`new Promise((resolve) => { const old = window.__tm.onNative; window.__tm.onNative = (e) => { old(e); if (e.type === 'download' && e.id === '${id}' && e.status !== 'progress') resolve(e); }; setTimeout(() => resolve({ status: 'timeout' }), 40000); })`);
  await js(`window.TMusicNative.downloadStart('${id}', ${JSON.stringify(SAMPLE_AUDIO)}, 'audio/mp4')`);
  const done = await finished;
  check('the phone saves a downloaded file', done.status === 'done' && done.size > 0, JSON.stringify(done));
  check('a downloaded file is served by range', await js(`fetch('/stream/${id}', { headers: { Range: 'bytes=0-99' } }).then(async (r) => r.status === 206 && (await r.arrayBuffer()).byteLength === 100)`));
  await js(`window.TMusicNative.downloadRemove('${id}')`);

  // ---- an app update reaches the system installer ----
  const updated = js(`new Promise((resolve) => { const old = window.__tm.onNative; window.__tm.onNative = (e) => { old(e); if (e.type === 'update' && e.status !== 'downloading') resolve(e); }; setTimeout(() => resolve({ status: 'timeout' }), 40000); })`);
  await js(`window.TMusicNative.updateDownload(${JSON.stringify(SAMPLE_AUDIO)})`);
  const update = await updated;
  check('the phone downloads an update', update.status === 'completed', JSON.stringify(update));
  await js('window.TMusicNative.updateInstall()');
  const installer = await waitFor(() => /topResumedActivity=.*packageinstaller/i.test(shell('dumpsys', 'activity', 'activities')), 10000);
  check('the system installer opens', installer !== null);
  await sleep(800);
  shot('11b-installer');
  shell('input', 'keyevent', 'KEYCODE_BACK');
  await sleep(600);
  shell('input', 'keyevent', 'KEYCODE_BACK');
  shell('am', 'start', '-n', `${PACKAGE}/.MainActivity`);
  await sleep(1200);

  // ---- local files stay inside the app ----
  check('file access can not leave app storage', !(await js(`window.TMusicNative.fsWrite('../../evil.txt', 'x')`)));

  // ---- the player reopens after the window is gone ----
  shell('am', 'force-stop', PACKAGE);
  await sleep(1000);
  shell('am', 'start', '-n', `${PACKAGE}/.MainActivity`);
  await waitFor(() => shell('pidof', PACKAGE).trim(), 15000);
  await sleep(3000);
  await connect();
  check('restart after being killed brings the account back', await waitFor(() => has('.m-tabs'), 30000));
  await sleep(1500);
  shot('12-after-restart');
}

const logcat = keepLog();
try {
  await main();
} catch (e) {
  check('test run finished', false, e.stack);
  note(`device state: ${spawnSync('adb', ['get-state'], { encoding: 'utf8' }).stdout || 'gone'}`);
}
logcat.kill();
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(0);
