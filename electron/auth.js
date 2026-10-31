// Google sign-in for a desktop app: Google blocks embedded login windows, so the user signs in
// from their own browser and the result comes back to a one-time server on this computer.
import { app, shell, BrowserWindow } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { say } from './lang.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, 'auth.config.json');
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const WAIT_MS = 5 * 60 * 1000;

let cancelPending = null;

function loadConfig() {
  try {
    const { clientId, clientSecret } = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  } catch {
    return null;
  }
}

export const isGoogleConfigured = () => Boolean(loadConfig());

export function cancelGoogleSignIn() {
  cancelPending?.();
}

const base64url = (buf) => buf.toString('base64url');

function resultPage(title, text) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;height:100vh;display:grid;place-content:center;text-align:center;background:#0a0712;color:#f5f3ff;font-family:system-ui,sans-serif">
<h1 style="font-size:24px;margin:0 0 8px">${title}</h1><p style="margin:0;color:#c4b5fd">${text}</p></body></html>`;
}

// Resolves with the authorization code, or null if the user cancelled or never finished.
function waitForCode(config, verifier) {
  const state = base64url(crypto.randomBytes(24));
  return new Promise((resolve, reject) => {
    let timer = null;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback' || url.searchParams.get('state') !== state) {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(code
        ? resultPage(say('로그인되었습니다', 'Signed in'), say('이 창을 닫고 T-Music으로 돌아가세요.', 'Close this window and go back to T-Music.'))
        : resultPage(say('로그인이 취소되었습니다', 'Sign-in cancelled'), say('이 창을 닫아도 됩니다.', 'You can close this window.')));
      finish(code ? { code, redirectUri: redirectUri() } : null);
    });
    const redirectUri = () => `http://127.0.0.1:${server.address().port}/callback`;
    const finish = (value) => {
      clearTimeout(timer);
      cancelPending = null;
      server.close();
      server.closeAllConnections();
      resolve(value);
    };
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri(),
        response_type: 'code',
        scope: 'openid email profile',
        state,
        code_challenge: base64url(crypto.createHash('sha256').update(verifier).digest()),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      timer = setTimeout(() => finish(null), WAIT_MS);
      cancelPending = () => finish(null);
      shell.openExternal(`${AUTH_URL}?${params}`).catch((e) => {
        finish(null);
        reject(e);
      });
    });
  });
}

// Returns { idToken, accessToken } for Firebase, or null if the user didn't finish signing in.
export async function googleSignIn() {
  const config = loadConfig();
  if (!config) throw new Error('구글 로그인이 아직 설정되지 않았습니다');
  cancelGoogleSignIn();

  const verifier = base64url(crypto.randomBytes(48));
  const result = await waitForCode(config, verifier);
  if (!result) return null;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: result.code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: result.redirectUri,
    }),
  });
  const tokens = await res.json().catch(() => ({}));
  if (!res.ok || !tokens.id_token) throw new Error('구글 로그인에 실패했습니다');

  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    win.show();
    win.focus();
  }
  app.focus({ steal: true });
  return { idToken: tokens.id_token, accessToken: tokens.access_token };
}
