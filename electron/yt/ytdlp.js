// yt-dlp fallback. The binary is downloaded into the app's data folder on first
// run and self-updates daily (`yt-dlp -U`), which is how fixes for YouTube changes
// reach the app without a rebuild.
import { app, net } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const isWin = process.platform === 'win32';
const binName = isWin ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp';
const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binName}`;
const UPDATE_EVERY = 24 * 60 * 60 * 1000;

const dir = () => path.join(app.getPath('userData'), 'bin');
const exe = () => path.join(dir(), isWin ? 'yt-dlp.exe' : 'yt-dlp');
const stampFile = () => path.join(dir(), 'last-update');

export const state = { status: 'idle', version: null, error: null };

function run(args, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    // yt-dlp needs a JS runtime for YouTube; Electron doubles as Node when this env var is set.
    const child = spawn(exe(), args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('yt-dlp timeout')); }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').pop() || `yt-dlp exited ${code}`));
    });
  });
}

async function download() {
  state.status = 'downloading';
  fs.mkdirSync(dir(), { recursive: true });
  const res = await net.fetch(downloadUrl);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const tmp = exe() + '.part';
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  if (!isWin) fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, exe());
  fs.writeFileSync(stampFile(), String(Date.now()));
}

async function updateIfStale() {
  let last = 0;
  try { last = Number(fs.readFileSync(stampFile(), 'utf8')) || 0; } catch { /* never updated */ }
  if (Date.now() - last < UPDATE_EVERY) return;
  state.status = 'updating';
  try {
    await run(['-U'], { timeout: 120000 });
    fs.writeFileSync(stampFile(), String(Date.now()));
  } catch (e) {
    state.error = 'update failed: ' + e.message;
  }
}

let ready = null;
let failedAt = 0;
export function ensure() {
  // Don't make every playback wait on a binary that just failed to start.
  if (!ready && Date.now() - failedAt < 60 * 60 * 1000) return Promise.reject(new Error(state.error || 'yt-dlp unavailable'));
  ready ??= (async () => {
    try {
      if (!fs.existsSync(exe())) await download();
      else await updateIfStale();
      // First launch can take a while: the exe self-extracts and antivirus scans it.
      state.version = (await run(['--version'], { timeout: 90000 })).trim();
      state.status = 'ready';
    } catch (e) {
      state.status = 'error';
      state.error = e.message;
      failedAt = Date.now();
      ready = null; // allow a retry after the cool-down
      throw e;
    }
  })();
  return ready;
}

const jsRuntimeArgs = () => ['--js-runtimes', `node:${process.execPath}`];

export async function resolve(id) {
  await ensure();
  const out = await run([
    '-f', 'bestaudio[ext=m4a]/bestaudio',
    '-j', '--no-playlist', '--no-warnings', '--no-progress',
    ...jsRuntimeArgs(),
    `https://www.youtube.com/watch?v=${id}`,
  ], { timeout: 45000 });
  const j = JSON.parse(out);
  if (!j.url) throw new Error('yt-dlp returned no url');
  const h = j.http_headers || {};
  const headers = {};
  if (h['User-Agent']) headers['User-Agent'] = h['User-Agent'];
  if (h['Accept-Language']) headers['Accept-Language'] = h['Accept-Language'];
  return { url: j.url, headers, mime: j.ext === 'm4a' ? 'audio/mp4' : `audio/${j.ext}`, bitrate: (j.abr || 0) * 1000 };
}
