// Google sign-in, the Android counterpart of electron/auth.js: the user signs in from their browser
// and the answer comes back to a one-time server on the phone (AuthServer.java).
//
// While the user is in the browser Android may start this page over (it reclaims memory from apps in
// the background), so what the page needs to finish is kept in storage and the native side holds the
// answer until a page takes it. A page that starts mid sign-in carries on with resumeGoogleSignIn.
import { Native, onNative } from './native.js';
import { tr } from '../lib/i18n.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// Signing up for the first time can take a while: a new account, a phone check, the consent screen.
const WAIT_MS = 30 * 60 * 1000;
const TOKEN_WAIT_MS = 20000;
const PENDING_KEY = 't-music-google-pending';
const LOST = Symbol('lost'); // the app was closed in between, so the answer had nowhere to go

let cancelPending = null;

async function loadConfig() {
  try {
    const res = await fetch('/auth.config.json');
    if (!res.ok) return null;
    const { clientId, clientSecret } = await res.json();
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  } catch {
    return null;
  }
}

export const isGoogleConfigured = async () => Boolean(await loadConfig());

export function cancelGoogleSignIn() {
  cancelPending?.();
}

const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (size) => base64url(crypto.getRandomValues(new Uint8Array(size)));

function loadPending() {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (pending?.state && Date.now() - pending.at < WAIT_MS) return pending;
  } catch { /* nothing usable */ }
  forgetPending();
  return null;
}

function savePending(pending) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch { /* only matters if the page starts over */ }
}

function forgetPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* nothing to forget */ }
}

function takeAnswer(state) {
  try {
    return JSON.parse(Native.authTake(state) || '{}');
  } catch {
    return {};
  }
}

// Resolves with the code, null if the user cancelled or ran out of time, or LOST.
function waitForCode(pending) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const stops = [];
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stops.forEach((stop) => stop());
      cancelPending = null;
      Native.authCancel();
      forgetPending();
      resolve(value);
    };
    // The event only says the answer is in; it's taken from the native side, so it's used once.
    const check = () => {
      const answer = takeAnswer(pending.state);
      if ('code' in answer) finish(answer.code || null);
      else if (!answer.waiting) finish(LOST);
    };
    stops.push(onNative('auth', check));
    stops.push(onNative('visibility', ({ visible }) => { if (visible) check(); }));
    timer = setTimeout(() => { check(); finish(null); }, Math.max(0, pending.at + WAIT_MS - Date.now()));
    cancelPending = () => finish(null);
    check();
  });
}

async function exchange(config, pending, code) {
  if (code === LOST) throw new Error(tr('로그인하는 동안 앱이 닫혀서 이어가지 못했어요. 다시 시도해 주세요.'));
  if (!code) return null;
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: pending.verifier,
        grant_type: 'authorization_code',
        redirect_uri: pending.redirectUri,
      }),
      signal: AbortSignal.timeout(TOKEN_WAIT_MS),
    });
  } catch (e) {
    throw new Error(e?.name === 'TimeoutError' ? tr('구글이 응답하지 않아요. 다시 시도해 주세요.') : tr('인터넷 연결을 확인해 주세요.'));
  }
  const tokens = await res.json().catch(() => ({}));
  if (!res.ok || !tokens.id_token) throw new Error(tr('구글 로그인에 실패했습니다'));
  return { idToken: tokens.id_token, accessToken: tokens.access_token };
}

// Returns { idToken, accessToken } for Firebase, or null if the user didn't finish signing in.
export async function googleSignIn() {
  const config = await loadConfig();
  if (!config) throw new Error(tr('구글 로그인이 아직 설정되지 않았습니다'));
  cancelGoogleSignIn();

  const verifier = randomString(48);
  const state = randomString(24);
  const port = Native.authListen(state);
  if (port < 0) throw new Error(tr('구글 로그인을 시작하지 못했습니다'));
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  const pending = { state, verifier, redirectUri, url: `${AUTH_URL}?${params}`, at: Date.now() };
  savePending(pending);
  const waiting = waitForCode(pending);
  Native.openExternal(pending.url);
  return exchange(config, pending, await waiting);
}

// True when this page started while a sign-in was under way.
export const hasPendingSignIn = () => Boolean(loadPending());

export async function resumeGoogleSignIn() {
  const pending = loadPending();
  const config = pending && await loadConfig();
  if (!config) return null;
  cancelGoogleSignIn();
  return exchange(config, pending, await waitForCode(pending));
}

// For someone who came back without finishing: the same sign-in, so a late answer still counts.
export function reopenGoogleSignIn() {
  const pending = loadPending();
  if (pending) Native.openExternal(pending.url);
}
