import electron from 'electron';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { URL } from 'url';
import crypto from 'crypto';

const { app, shell } = electron || {};

const REPO = 'Bluemon7894/T-Music';
const REQUEST_TIMEOUT_MS = 30000;

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

function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const headers = {
      'User-Agent': 'T-Music-App',
      Accept: 'application/vnd.github.v3+json',
    };
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers,
    };
    const req = https.get(options, (res) => {
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
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('GitHub 응답이 없습니다')));
  });
}

export async function checkUpdate() {
  const currentVersion = app.getVersion();
  try {
    const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    const tagName = release.tag_name || '';
    const latestVersion = tagName.replace(/^v/, '');
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    // Find the Windows .exe installer asset
    const exeAsset = Array.isArray(release.assets)
      ? release.assets.find((a) => a.name && a.name.endsWith('.exe') && (a.state === 'uploaded' || !a.state)) ||
        release.assets.find((a) => a.name && a.name.endsWith('.exe'))
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
      manifestUrl: release.assets?.find?.((a) => a.name === 'latest.yml')?.browser_download_url || null,
      assetId: exeAsset?.id || null,
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
      if (depth > 10) return reject(new Error('Too many redirects'));
      const u = new URL(curUrl);
      const isHttps = u.protocol === 'https:';
      const client = isHttps ? https : http;

      const headers = {
        'User-Agent': 'T-Music-App',
        Accept: 'application/octet-stream',
      };

      const req = client.get(
        curUrl,
        { headers },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, curUrl).href;
            return request(redirectUrl, depth + 1);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`Download failed with status ${res.statusCode}`));
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let received = 0;
          const file = fs.createWriteStream(destPath);
          const fail = (err) => {
            file.destroy();
            fs.unlink(destPath, () => {});
            reject(err);
          };

          res.on('aborted', () => fail(new Error('다운로드가 중간에 끊겼습니다')));
          res.on('error', fail);
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
            file.close(() => {
              if (total > 0 && received !== total) fail(new Error('다운로드가 중간에 끊겼습니다'));
              else resolve(destPath);
            });
          });

          file.on('error', fail);
        }
      );

      req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('다운로드 응답이 없습니다')));

      req.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }

    request(targetUrl);
  });
}

// Refuse to run an installer that isn't the file the release says it published.
async function verifyInstaller(filePath, manifestUrl) {
  if (!manifestUrl) return;
  const manifestPath = `${filePath}.yml`;
  await downloadFileWithRedirect(manifestUrl, manifestPath);
  const manifest = await fs.promises.readFile(manifestPath, 'utf8');
  await fs.promises.unlink(manifestPath).catch(() => {});
  const expected = /^sha512:\s*(\S+)/m.exec(manifest)?.[1];
  if (!expected) return;
  const hash = crypto.createHash('sha512');
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath).on('data', (d) => hash.update(d)).on('end', resolve).on('error', reject);
  });
  if (hash.digest('base64') !== expected) {
    await fs.promises.unlink(filePath).catch(() => {});
    throw new Error('내려받은 설치 파일이 올바르지 않습니다. 다시 시도해 주세요.');
  }
}

export async function downloadUpdate(webContents) {
  if (downloading) {
    throw new Error('이미 업데이트를 다운로드 중입니다.');
  }

  const info = await checkUpdate();
  if (!info.downloadUrl && !info.assetId) {
    throw new Error('최신 버전의 설치 파일(.exe)을 찾을 수 없습니다.');
  }

  const tempDir = app.getPath('temp');
  const fileName = info.assetName || `T-Music-Setup-${info.latestVersion}.exe`;
  const targetPath = path.join(tempDir, fileName);

  downloading = true;
  try {
    webContents?.send('update-progress', { status: 'downloading', percent: 0 });

    const tryDownload = async (url) => {
      await downloadFileWithRedirect(url, targetPath, (progress) => {
        webContents?.send('update-progress', {
          status: 'downloading',
          ...progress,
        });
      });
    };

    let downloadErr = null;

    // 1. Primary attempt: direct browser_download_url
    if (info.downloadUrl) {
      try {
        console.log('[updater] Downloading via browser_download_url:', info.downloadUrl);
        await tryDownload(info.downloadUrl);
        await verifyInstaller(targetPath, info.manifestUrl);
        downloadedInstallerPath = targetPath;
        webContents?.send('update-progress', { status: 'completed', percent: 100, path: targetPath });
        return { success: true, path: targetPath };
      } catch (err) {
        console.warn('[updater] Primary downloadUrl failed:', err.message);
        downloadErr = err;
      }
    }

    // 2. Secondary fallback: GitHub API asset endpoint
    if (info.assetId) {
      const apiAssetUrl = `https://api.github.com/repos/${REPO}/releases/assets/${info.assetId}`;
      try {
        console.log('[updater] Trying GitHub API asset fallback:', apiAssetUrl);
        await tryDownload(apiAssetUrl);
        await verifyInstaller(targetPath, info.manifestUrl);
        downloadedInstallerPath = targetPath;
        webContents?.send('update-progress', { status: 'completed', percent: 100, path: targetPath });
        return { success: true, path: targetPath };
      } catch (fallbackErr) {
        console.warn('[updater] Fallback asset download failed:', fallbackErr.message);
        downloadErr = fallbackErr;
      }
    }

    throw downloadErr || new Error('업데이트 설치 파일 다운로드에 실패했습니다.');
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
      // Reports failure by returning a message, not by throwing.
      const problem = await shell.openPath(installerPath);
      if (problem) throw new Error(problem);
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
