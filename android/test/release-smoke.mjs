// Checks that a published APK, signed for release, opens on a real Android system. A release build
// can't be scripted from the inside, so this reads the screen the way accessibility services do.
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
const screen = () => { shell('uiautomator', 'dump', '/sdcard/ui.xml'); return shell('cat', '/sdcard/ui.xml'); };

function findNode(xml, text) {
  for (const node of xml.match(/<node [^>]*>/g) || []) {
    if (!node.includes(text)) continue;
    const box = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    if (box) return { enabled: /enabled="true"/.test(node), x: (Number(box[1]) + Number(box[3])) >> 1, y: (Number(box[2]) + Number(box[4])) >> 1 };
  }
  return null;
}

async function waitForNode(text, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const node = findNode(screen(), text);
    if (node) return node;
    await sleep(1500);
  }
  return null;
}

async function main() {
  check('installs', /Success/.test(spawnSync('adb', ['install', '-r', apk], { encoding: 'utf8' }).stdout));
  const info = shell('dumpsys', 'package', PACKAGE);
  check('is a release build', !/flags=\[[^\]]*DEBUGGABLE/.test(info));
  console.log('      version', /versionName=(\S+)/.exec(info)?.[1], /versionCode=(\d+)/.exec(info)?.[1]);
  shell('pm', 'grant', PACKAGE, 'android.permission.POST_NOTIFICATIONS');
  shell('am', 'start', '-n', `${PACKAGE}/.MainActivity`);

  const guest = await waitForNode('게스트로 시작하기', 45000);
  check('login screen opens', guest);
  shot('r1-login');
  const google = findNode(screen(), 'Google로 계속하기');
  check('Google sign-in is set up in this build', google?.enabled, JSON.stringify(google));
  if (!guest) return;

  shell('input', 'tap', String(guest.x), String(guest.y));
  check('guest sign-in reaches the app', await waitForNode('보관함', 45000));
  await sleep(4000);
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
