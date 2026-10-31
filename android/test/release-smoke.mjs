// Checks that a published APK, signed for release, opens on a real Android system. A release build
// can't be scripted from the inside, so this looks at the screen's pixels and at the device log, and
// keeps screenshots to look at.
//   node android/test/release-smoke.mjs path/to/T-Music-Android.apk
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE = 'com.bluemon7894.tmusic';
const OUT = 'android/test/out';
const apk = process.argv[2];

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${String(detail).slice(0, 200)})` : ''}`);
};
const adb = (...args) => spawnSync('adb', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 128 * 1024 * 1024 }).stdout || '';
const shell = (...args) => adb('shell', ...args);
const shot = (name) => fs.writeFileSync(path.join(OUT, `${name}.png`), execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, timeout: 30000 }));

// The screen as raw pixels: a 16-byte header with the size, then 4 bytes per pixel.
function pixels() {
  const raw = execFileSync('adb', ['exec-out', 'screencap'], { maxBuffer: 128 * 1024 * 1024, timeout: 30000 });
  const width = raw.readUInt32LE(0);
  const height = raw.readUInt32LE(4);
  return { height, at: (x, y) => { const i = 16 + (y * width + x) * 4; return [raw[i], raw[i + 1], raw[i + 2]]; } };
}

// The Google button is the only big pure white shape on the login screen. It's grey when not set up.
function googleButton() {
  const screen = pixels();
  const x = 180;
  let top = -1;
  for (let y = 400; y < screen.height - 200; y++) {
    const white = screen.at(x, y).every((v) => v > 245);
    if (white && top < 0) top = y;
    if (!white && top >= 0) return y - top > 80 ? { top, bottom: y } : null;
  }
  return null;
}

async function main() {
  adb('logcat', '-c');
  check('installs', /Success/.test(spawnSync('adb', ['install', '-r', apk], { encoding: 'utf8' }).stdout));
  const info = shell('dumpsys', 'package', PACKAGE);
  check('is a release build', !/flags=\[[^\]]*DEBUGGABLE/.test(info));
  console.log('      version', /versionName=(\S+)/.exec(info)?.[1], /versionCode=(\d+)/.exec(info)?.[1]);
  shell('pm', 'grant', PACKAGE, 'android.permission.POST_NOTIFICATIONS');
  shell('am', 'start', '-n', `${PACKAGE}/.MainActivity`);

  let google = null;
  for (let i = 0; i < 30 && !google; i++) {
    await sleep(1500);
    google = googleButton();
  }
  shot('r1-login');
  check('login screen opens with Google sign-in set up', google, JSON.stringify(google));
  check('the app found its own files', !adb('logcat', '-d').includes('missing app file /index.html'));
  if (!google) return;

  // The guest button sits below it: 10dp apart and 50dp tall, at this phone's 2.625 pixels per dp.
  const guestY = Math.round(google.bottom + (10 + 25) * 2.625);
  shell('input', 'tap', '540', String(guestY));
  let left = false;
  for (let i = 0; i < 25 && !left; i++) {
    await sleep(1500);
    left = !googleButton();
  }
  check('guest sign-in leaves the login screen', left);
  await sleep(6000);
  shot('r2-home');
  check('the app is still running', shell('pidof', PACKAGE).trim());
  const crashes = adb('logcat', '-d', '-b', 'crash');
  check('nothing crashed', !crashes.includes(PACKAGE), crashes.slice(0, 200));
}

try {
  await main();
} catch (e) {
  check('test run finished', false, e.stack);
}
fs.writeFileSync(path.join(OUT, 'logcat.txt'), adb('logcat', '-d', '-t', '6000'));
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.filter((r) => r.ok).length} passed, ${results.filter((r) => !r.ok).length} failed`);
process.exit(0);
