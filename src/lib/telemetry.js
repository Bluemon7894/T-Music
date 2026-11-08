// Two quiet records for the developer, never shown in the app:
//  - which version each account last opened, in users/{uid}/state/app (removed with the account's data)
//  - what went wrong, in errorReports, which the app may add to but nobody can read back through it.
// Neither holds names, emails, searches or playlists: only ids, the version and what failed.
import { addDoc, collection, doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { api } from './api.js';
import { IS_ANDROID } from './platform.js';

const PLATFORM = IS_ANDROID ? 'android' : 'windows';
const KEEP_DAYS = 30;
const DAILY_LIMIT = 25;
const LIMIT_KEY = 't-music-reports';
const TEXT_MAX = 500;
const SIGN_IN_KEY = 't-music-sign-in-trouble';

// Asked on first use: on Android this module loads before window.api exists.
let version = null;
let asked = null;
const versionReady = () => (asked ??= Promise.resolve().then(() => api.status()).then((s) => { version = s?.version || null; }).catch(() => { asked = null; }));

let recordedFor = null;
export async function recordVersion(uid) {
  if (!uid || recordedFor === uid) return;
  recordedFor = uid;
  await versionReady();
  setDoc(doc(db, 'users', uid, 'state', 'app'), { version, platform: PLATFORM, seenAt: serverTimestamp() }, { merge: true }).catch(() => { recordedFor = null; });
  sendSignInTrouble();
}

// Sign-in trouble mostly happens before there's an account to report it with, so it waits for one.
const reportSignIn = (t) => reportError('sign-in', t.message, { code: t.code, minutesAgo: Math.round((Date.now() - t.at) / 60000) });

export function reportSignInTrouble(e) {
  const trouble = { message: clip(e?.message || e), code: String(e?.code || ''), at: Date.now() };
  if (auth.currentUser) {
    reportSignIn(trouble);
    return;
  }
  try {
    const kept = JSON.parse(localStorage.getItem(SIGN_IN_KEY) || '[]').slice(-4);
    localStorage.setItem(SIGN_IN_KEY, JSON.stringify([...kept, trouble]));
  } catch { /* not worth more */ }
}

function sendSignInTrouble() {
  let kept = [];
  try {
    kept = JSON.parse(localStorage.getItem(SIGN_IN_KEY) || '[]');
    localStorage.removeItem(SIGN_IN_KEY);
  } catch { /* nothing kept */ }
  kept.forEach(reportSignIn);
}

// One report per kind and message per session, and a few dozen a day at most, so a loop of failures
// can't run up the database.
const sent = new Set();
function allowed(key) {
  if (sent.has(key)) return false;
  const today = new Date().toISOString().slice(0, 10);
  let count = { day: today, n: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(LIMIT_KEY) || 'null');
    if (saved?.day === today) count = saved;
  } catch { /* start counting again */ }
  if (count.n >= DAILY_LIMIT) return false;
  sent.add(key);
  try { localStorage.setItem(LIMIT_KEY, JSON.stringify({ day: today, n: count.n + 1 })); } catch { /* still sent */ }
  return true;
}

const clip = (value) => String(value ?? '').slice(0, TEXT_MAX);

// kind: a short label such as 'playback' or 'crash'. detail: plain values only (ids, codes, numbers).
export async function reportError(kind, message, detail = {}) {
  const uid = auth.currentUser?.uid;
  if (!uid || !allowed(`${kind}|${clip(message).slice(0, 120)}`)) return;
  await versionReady();
  const extra = {};
  for (const [key, value] of Object.entries(detail).slice(0, 12)) {
    if (['string', 'number', 'boolean'].includes(typeof value)) extra[key.slice(0, 40)] = typeof value === 'string' ? clip(value) : value;
  }
  addDoc(collection(db, 'errorReports'), {
    uid,
    kind: clip(kind).slice(0, 40),
    message: clip(message),
    detail: extra,
    version: version || 'unknown',
    platform: PLATFORM,
    at: serverTimestamp(),
    expireAt: Timestamp.fromMillis(Date.now() + KEEP_DAYS * 24 * 60 * 60 * 1000),
  }).catch(() => {});
}

// Code errors nothing else caught.
let installed = false;
export function installErrorReporting() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => {
    if (!e.error && !e.message) return;
    reportError('crash', e.message || e.error?.message, { where: `${String(e.filename || '').split('/').pop()}:${e.lineno || 0}`, stack: String(e.error?.stack || '').slice(0, 400) });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    // Network trouble is reported where it matters (playback), not every time a request fails.
    if (/network|fetch|offline|timeout|abort/i.test(String(r?.message || r))) return;
    reportError('crash', r?.message || String(r), { stack: String(r?.stack || '').slice(0, 400) });
  });
}
