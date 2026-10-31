// App updates from GitHub. Android releases are tagged android-vX.Y.Z and are never marked as the
// repository's latest release, because that one is what the desktop app updates from.
import { Native, onNative } from './native.js';
import { tr } from '../lib/i18n.js';

const RELEASES = 'https://api.github.com/repos/Bluemon7894/T-Music/releases?per_page=50';
const TAG = /^android-v(\d+(\.\d+)*)$/;

const listeners = new Set();
let current = '';
let downloadUrl = null;
let downloaded = false;

export const setCurrentVersion = (version) => { current = version; };

function isNewer(next, base) {
  const a = next.split('.').map(Number);
  const b = base.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

export async function checkUpdate() {
  const res = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'T-Music-App' } });
  if (!res.ok) throw new Error(tr('GitHub 응답 오류 ({0})', res.status));
  const releases = await res.json();
  const release = releases.find((r) => !r.draft && TAG.test(r.tag_name) && r.assets?.some((a) => a.name.endsWith('.apk')));
  if (!release) return { hasUpdate: false, currentVersion: current };
  const latestVersion = TAG.exec(release.tag_name)[1];
  const apk = release.assets.find((a) => a.name.endsWith('.apk'));
  downloadUrl = apk.browser_download_url;
  return {
    hasUpdate: isNewer(latestVersion, current),
    currentVersion: current,
    latestVersion,
    releaseName: release.name || release.tag_name,
    releaseNotes: release.body || '',
    releaseUrl: release.html_url,
    downloadUrl,
    assetSize: apk.size,
    downloaded,
  };
}

export function downloadUpdate() {
  if (!downloadUrl) throw new Error(tr('업데이트를 먼저 확인해 주세요'));
  Native.updateDownload(downloadUrl);
}

export function installUpdate() {
  Native.updateInstall();
}

export function onUpdateProgress(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

onNative('update', (event) => {
  if (event.status === 'completed') downloaded = true;
  for (const listener of listeners) listener(event);
});
