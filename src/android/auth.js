// Google sign-in, the Android counterpart of electron/auth.js: the user signs in from their browser
// and the answer comes back to a one-time server on the phone (AuthServer.java).
import { Native, onNative } from './native.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const WAIT_MS = 5 * 60 * 1000;

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

function waitForCode() {
  return new Promise((resolve) => {
    let timer = null;
    let stop = null;
    const finish = (value) => {
      clearTimeout(timer);
      stop();
      cancelPending = null;
      Native.authCancel();
      resolve(value);
    };
    stop = onNative('auth', ({ code }) => finish(code || null));
    timer = setTimeout(() => finish(null), WAIT_MS);
    cancelPending = () => finish(null);
  });
}

// Returns { idToken, accessToken } for Firebase, or null if the user didn't finish signing in.
export async function googleSignIn() {
  const config = await loadConfig();
  if (!config) throw new Error('구글 로그인이 아직 설정되지 않았습니다');
  cancelGoogleSignIn();

  const verifier = randomString(48);
  const state = randomString(24);
  const port = Native.authListen(state);
  if (port < 0) throw new Error('구글 로그인을 시작하지 못했습니다');
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
  const waiting = waitForCode();
  Native.openExternal(`${AUTH_URL}?${params}`);
  const code = await waiting;
  if (!code) return null;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const tokens = await res.json().catch(() => ({}));
  if (!res.ok || !tokens.id_token) throw new Error('구글 로그인에 실패했습니다');
  return { idToken: tokens.id_token, accessToken: tokens.access_token };
}
