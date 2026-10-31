// Offline downloads, the Android counterpart of electron/downloads.js. The phone writes the files
// (Downloads.java); this keeps the list and decides what to fetch next.
import { Native, onNative } from './native.js';
import * as stream from '../../electron/youtube/stream.js';

const MAX_PARALLEL = 2;
const MAX_ATTEMPTS = 3;
const INDEX = 'downloads/index.json';

let index = null; // id -> { track, size, mime, date }
const jobs = new Map(); // id -> { track, status, received, total, error, attempts }
const listeners = new Set();
let running = 0;

function load() {
  if (index) return index;
  try { index = JSON.parse(Native.fsRead(INDEX)) || {}; } catch { index = {}; }
  for (const id of Object.keys(index)) if (Native.downloadSize(id) < 0) delete index[id];
  return index;
}

const save = () => Native.fsWrite(INDEX, JSON.stringify(index));

export function snapshot() {
  load();
  const items = Object.values(index).sort((a, b) => b.date - a.date).map((e) => ({ ...e.track, size: e.size, date: e.date }));
  return {
    items,
    jobs: [...jobs.values()].map(({ track, status, received, total, error }) => ({ track, status, received, total, error })),
    totalSize: items.reduce((n, i) => n + (i.size || 0), 0),
    dir: '',
  };
}

let emitTimer = null;
function emit() {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    const state = snapshot();
    for (const listener of listeners) listener(state);
  }, 150);
}

export function onDownloads(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const localFile = (id) => Boolean(load()[id]);

export function enqueue(tracks) {
  load();
  let added = 0;
  for (const t of tracks) {
    if (!/^[\w-]{11}$/.test(t?.id) || index[t.id] || jobs.has(t.id)) continue;
    jobs.set(t.id, { track: t, status: 'queued', received: 0, total: 0, attempts: 0 });
    added++;
  }
  pump();
  emit();
  return added;
}

function pump() {
  for (const job of jobs.values()) {
    if (running >= MAX_PARALLEL) break;
    if (job.status === 'queued') start(job);
  }
}

async function start(job) {
  running++;
  job.status = 'downloading';
  job.received = 0;
  emit();
  try {
    const s = await stream.resolve(job.track.id);
    job.source = s;
    Native.downloadStart(job.track.id, s.url, s.mime || 'audio/mp4');
  } catch (e) {
    fail(job, e.message);
  }
}

function finish() {
  running--;
  emit();
  pump();
}

function fail(job, error) {
  job.status = 'error';
  job.error = String(error || '다운로드하지 못했습니다').slice(0, 160);
  finish();
}

onNative('download', ({ id, status, received, total, size, mime, error }) => {
  const job = jobs.get(id);
  if (!job) return;
  if (status === 'progress') {
    job.received = received;
    job.total = total;
    emit();
  } else if (status === 'done') {
    load()[id] = { track: job.track, size, mime, date: Date.now() };
    save();
    jobs.delete(id);
    finish();
  } else if (status === 'cancelled') {
    jobs.delete(id);
    finish();
  } else if (status === 'rejected') {
    // The URL was refused, which usually means it expired.
    stream.invalidate(id, job.source?.method, job.source?.fresh);
    job.attempts++;
    if (job.attempts >= MAX_ATTEMPTS) { fail(job, '곡을 받을 수 없습니다'); return; }
    job.status = 'queued';
    finish();
  } else if (status === 'error') {
    fail(job, error);
  }
});

export function cancel(id) {
  const job = jobs.get(id);
  if (!job) return;
  if (job.status === 'downloading') Native.downloadCancel(id);
  else jobs.delete(id);
  emit();
}

export function retry(id) {
  const job = jobs.get(id);
  if (job?.status !== 'error') return;
  Object.assign(job, { status: 'queued', received: 0, total: 0, error: null, attempts: 0 });
  pump();
  emit();
}

export function remove(ids) {
  load();
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    if (!index[id]) continue;
    Native.downloadRemove(id);
    delete index[id];
  }
  save();
  emit();
}
