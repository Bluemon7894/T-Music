import electron from 'electron';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { URL } from 'url';

const { app, shell } = electron || {};

const REPO = 'Bluemon7894/T-Music';

let downloadedInstallerPath = null;
let downloading = false;

function compareVersions(v1, v2) {
  const clean = (v) => String(v || '').replace(/^v/, '').trim();
  const parts1 = clean(v1).split('.').map((p) => parseInt(p, 10) || 0);
  const parts2 = clean(v2).split('.').map((p) => parseInt(p, 10) || 0);
  const max = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < max; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

let githubToken = process.env.GITHUB_TOKEN || null;

// Try to auto-resolve token from gh CLI if available
if (!githubToken) {
  try {
    const { execSync } = await import('child_process');
    const tok = execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
    if (tok && tok.startsWith('gh')) githubToken = tok;
  } catch {}
}

export function setGithubToken(token) {
  githubToken = token || null;
}

function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const headers = {
      'User-Agent': 'T-Music-App',
      Accept: 'application/vnd.github.v3+json',
    };
    if (githubToken) {
      headers.Authorization = `Bearer ${githubToken}`;
    }
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers,
    };
    https.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchJson(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`GitHub API returned status ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

export async function checkUpdate() {
  const currentVersion = app?.getVersion ? app.getVersion() : '0.2.2';
  try {
    const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    const tagName = release.tag_name || '';
    const latestVersion = tagName.replace(/^v/, '');
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    // Find the Windows .exe installer asset
    const exeAsset = Array.isArray(release.assets)
      ? release.assets.find((a) => a.name && a.name.endsWith('.exe'))
      : null;

    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      tagName,
      releaseName: release.name || tagName,
      releaseNotes: release.body || '',
      releaseUrl: release.html_url || `https://github.com/${REPO}/releases/latest`,
      downloadUrl: exeAsset?.browser_download_url || null,
      assetName: exeAsset?.name || null,
      assetSize: exeAsset?.size || 0,
      downloaded: Boolean(downloadedInstallerPath && fs.existsSync(downloadedInstallerPath)),
    };
  } catch (err) {
    console.error('[updater] checkUpdate error:', err);
    return {
      hasUpdate: false,
      currentVersion,
      error: err.message,
    };
  }
}

function downloadFileWithRedirect(targetUrl, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    function request(curUrl, depth = 0) {
      if (depth > 8) return reject(new Error('Too many redirects'));
      const u = new URL(curUrl);
      const isHttps = u.protocol === 'https:';
      const client = isHttps ? https : http;

      const headers = {
        'User-Agent': 'T-Music-App',
        Accept: 'application/octet-stream',
      };
      if (githubToken && (u.hostname === 'api.github.com' || u.hostname === 'github.com')) {
        headers.Authorization = `Bearer ${githubToken}`;
      }

      const req = client.get(
        curUrl,
        { headers },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return request(res.headers.location, depth + 1);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`Download failed with status ${res.statusCode}`));
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let received = 0;
          const file = fs.createWriteStream(destPath);

          res.on('data', (chunk) => {
            received += chunk.length;
            if (onProgress && total > 0) {
              onProgress({
                percent: Math.min(100, Math.round((received / total) * 100)),
                received,
                total,
              });
            }
          });

          res.pipe(file);

          file.on('finish', () => {
            file.close(() => resolve(destPath));
          });

          file.on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
          });
        }
      );

      req.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }

    request(targetUrl);
  });
}

export async function downloadUpdate(webContents) {
  if (downloading) {
    throw new Error('이미 업데이트를 다운로드 중입니다.');
  }

  const info = await checkUpdate();
  if (!info.downloadUrl) {
    throw new Error('최신 버전의 설치 파일(.exe)을 찾을 수 없습니다.');
  }

  const tempDir = app.getPath('temp');
  const fileName = info.assetName || `T-Music-Setup-${info.latestVersion}.exe`;
  const targetPath = path.join(tempDir, fileName);

  downloading = true;
  try {
    webContents?.send('update-progress', { status: 'downloading', percent: 0 });
    await downloadFileWithRedirect(info.downloadUrl, targetPath, (progress) => {
      webContents?.send('update-progress', {
        status: 'downloading',
        ...progress,
      });
    });
    downloadedInstallerPath = targetPath;
    webContents?.send('update-progress', { status: 'completed', percent: 100, path: targetPath });
    return { success: true, path: targetPath };
  } catch (err) {
    webContents?.send('update-progress', { status: 'error', error: err.message });
    throw err;
  } finally {
    downloading = false;
  }
}

export async function installUpdate() {
  if (!downloadedInstallerPath || !fs.existsSync(downloadedInstallerPath)) {
    throw new Error('다운로드된 설치 파일이 없습니다.');
  }

  const installerPath = downloadedInstallerPath;
  console.log('[updater] Launching installer:', installerPath);

  // Launch installer detached and quit current app.
  try {
    if (shell?.openPath) {
      await shell.openPath(installerPath);
    } else {
      const child = spawn(installerPath, [], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    }
  } catch (err) {
    console.warn('[updater] shell.openPath failed, falling back to spawn:', err);
    const child = spawn(installerPath, [], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }

  // Delay slightly so the installer process is active, then exit cleanly
  setTimeout(() => {
    app.quit();
  }, 800);

  return { success: true };
}
