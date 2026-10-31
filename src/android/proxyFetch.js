// A web page can't call other sites without their permission or choose its own User-Agent, and the
// catalog and lyrics code needs both. Those requests go through the phone instead (ProxyHandler.java).
// Firebase talks to its own servers directly and doesn't come through here.
import { Native } from './native.js';

const PROXIED = /^https:\/\/([^/]+\.)?(youtube\.com|googlevideo\.com|lrclib\.net|music\.163\.com|qq\.com|kugou\.com|naver\.com|api\.github\.com|oauth2\.googleapis\.com)(\/|$)/i;

const realFetch = window.fetch.bind(window);

function urlOf(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function bodyOf(input, init) {
  if (init.body != null) return String(init.body);
  if (input instanceof Request && input.method !== 'GET' && input.method !== 'HEAD') return input.clone().text();
  return null;
}

window.fetch = async (input, init = {}) => {
  const url = urlOf(input);
  if (!PROXIED.test(url)) return realFetch(input, init);
  const headers = {};
  new Headers(init.headers || (input instanceof Request ? input.headers : undefined)).forEach((value, name) => { headers[name] = value; });
  if (init.body instanceof URLSearchParams) headers['content-type'] ??= 'application/x-www-form-urlencoded';
  const token = Native.proxyPrepare(JSON.stringify({
    url,
    method: init.method || (input instanceof Request ? input.method : 'GET'),
    headers,
    body: await bodyOf(input, init),
  }));
  const signal = init.signal || (input instanceof Request ? input.signal : undefined);
  const res = await realFetch(`/__proxy/${token}`, { signal });
  // Reported the way fetch reports having no connection.
  if (res.headers.get('x-proxy-error')) throw new TypeError('Failed to fetch');
  return res;
};
