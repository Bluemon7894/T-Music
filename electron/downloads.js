// Offline downloads: audio files saved under the app's data folder, with an index
// so the stream protocol can serve them without touching the network.
import { app, net, shell, BrowserWindow, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import * as stream from './youtube/stream.js';

const MAX_PARALLEL = 2;
const configFile = () => path.join(app.getPath('userData'), 'downloads-config.json');

function getCustomDir() {
  try {
    const raw = fs.readFileSync(configFile(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.dir && fs.existsSync(parsed.dir)) return parsed.dir;
  } catch {}
  return null;
}

const dir = () => getCustomDir() || path.join(app.getPath('userData'), 'downloads');
const indexFile = () => path.join(dir(), 'index.json');

let index = null; // id -> { track, file, size, mime, date }
const jobs = new Map(); // id -> { track, status, received, total, error, controller }
let running = 0;

function load() {
  if (index) return index;
  fs.mkdirSync(dir(), { recursive: true });
  try { index = JSON.parse(fs.readFileSync(indexFile(), 'utf8')); } catch { index = {}; }
  for (const [id, e] of Object.entries(index)) if (!fs.existsSync(e.file)) delete index[id];
  return index;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(indexFile(), JSON.stringify(index)); } catch { /* retried on next change */ }
  }, 300);
}

let emitTimer = null;
function emit() {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    const state = snapshot();
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('downloads', state);
  }, 150);
}

function snapshot() {
  load();
  const items = Object.values(index).sort((a, b) => b.date - a.date).map((e) => ({ ...e.track, size: e.size, date: e.date }));
  return {
    items,
    jobs: [...jobs.values()].map(({ track, status, received, total, error }) => ({ track, status, received, total, error })),
    totalSize: items.reduce((n, i) => n + (i.size || 0), 0),
    dir: dir(),
  };
}

export function localFile(id) {
  const e = load()[id];
  return e && fs.existsSync(e.file) ? e : null;
}

export function list() {
  return snapshot();
}

export function enqueue(tracks) {
  load();
  let added = 0;
  for (const t of tracks) {
    if (!t?.id || index[t.id] || jobs.has(t.id)) continue;
    jobs.set(t.id, { track: t, status: 'queued', received: 0, total: 0 });
    added++;
  }
  pump();
  emit();
  return added;
}

function pump() {
  for (const job of jobs.values()) {
    if (running >= MAX_PARALLEL) break;
    if (job.status === 'queued') run(job);
  }
}

// googlevideo throttles one long request to roughly playback speed, but serves
// short ranged requests at full speed — so fetch the file in 1 MB pieces
// (some clients' URLs reject anything larger).
const CHUNK = 1024 * 1024;

async function fetchChunk(s, start, signal) {
  const res = await net.fetch(s.url, {
    headers: { ...s.headers, Range: `bytes=${start}-${start + CHUNK - 1}` },
    signal,
    bypassCustomProtocolHandlers: true,
  });
  if (res.status !== 206 && res.status !== 200) {
    res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }
  const total = Number(res.headers.get('content-range')?.split('/')[1]) || Number(res.headers.get('content-length')) || 0;
  return { res, total, mime: res.headers.get('content-type') };
}

// First chunk, retrying with other resolve methods if a URL is rejected.
async function openSource(id, signal) {
  const exclude = [];
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const s = await stream.resolve(id, { exclude });
    try {
      const first = await fetchChunk(s, 0, signal);
      return { s, first };
    } catch (e) {
      if (signal.aborted) throw e;
      lastError = e;
    }
    stream.invalidate(id, s.method, s.fresh);
    if (s.fresh) exclude.push(s.method);
  }
  throw lastError || new Error('download failed');
}

async function run(job) {
  const id = job.track.id;
  running++;
  job.status = 'downloading';
  job.controller = new AbortController();
  const { signal } = job.controller;
  emit();
  let tmp = null;
  try {
    const { s, first } = await openSource(id, signal);
    job.total = first.total;
    const mime = first.mime || s.mime || 'audio/mp4';
    const ext = /webm/.test(mime) ? 'webm' : 'm4a';
    const file = path.join(dir(), `${id}.${ext}`);
    tmp = file + '.part';
    const out = fs.createWriteStream(tmp);
    const counter = () => new Transform({
      transform(chunk, _enc, cb) {
        job.received += chunk.length;
        emit();
        cb(null, chunk);
      },
    });
    let res = first.res;
    for (;;) {
      await pipeline(Readable.fromWeb(res.body), counter(), out, { end: false });
      if (!job.total || job.received >= job.total) break;
      res = (await fetchChunk(s, job.received, signal)).res;
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    fs.renameSync(tmp, file);
    index[id] = { track: job.track, file, size: fs.statSync(file).size, mime, date: Date.now() };
    save();
    jobs.delete(id);
  } catch (e) {
    if (tmp) fs.rm(tmp, { force: true }, () => {});
    if (signal.aborted) jobs.delete(id);
    else { job.status = 'error'; job.error = String(e.message || e).slice(0, 160); }
  } finally {
    running--;
    emit();
    pump();
  }
}

export function cancel(id) {
  const job = jobs.get(id);
  if (!job) return;
  if (job.status === 'downloading') job.controller.abort();
  else jobs.delete(id);
  emit();
}

export function retry(id) {
  const job = jobs.get(id);
  if (job?.status !== 'error') return;
  Object.assign(job, { status: 'queued', received: 0, total: 0, error: null });
  pump();
  emit();
}

export function remove(ids) {
  load();
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    const e = index[id];
    if (!e) continue;
    fs.rm(e.file, { force: true }, () => {});
    delete index[id];
  }
  save();
  emit();
}

export function openFolder() {
  load();
  return shell.openPath(dir());
}

export async function chooseFolder() {
  const [win] = BrowserWindow.getAllWindows();
  const res = await dialog.showOpenDialog(win, {
    title: '다운로드 저장 폴더 선택',
    defaultPath: dir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!res.canceled && res.filePaths?.[0]) {
    const selected = res.filePaths[0];
    fs.mkdirSync(selected, { recursive: true });
    try {
      fs.writeFileSync(configFile(), JSON.stringify({ dir: selected }), 'utf8');
    } catch {}
    index = null; // force reload from new dir
    load();
    emit();
    return dir();
  }
  return dir();
}
