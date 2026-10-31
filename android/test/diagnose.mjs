// Temporary: which build opens on a fresh install, and on the second launch?
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE = 'com.bluemon7894.tmusic';
const OUT = 'android/test/out';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => spawnSync('adb', args, { encoding: 'utf8', timeout: 90000, maxBuffer: 128 * 1024 * 1024 }).stdout || '';
const shell = (...args) => adb('shell', ...args);
const shot = (name) => fs.writeFileSync(path.join(OUT, `${name}.png`), execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, timeout: 30000 }));
const screen = () => { shell('uiautomator', 'dump', '/sdcard/ui.xml'); return shell('cat', '/sdcard/ui.xml'); };
const state = () => { const xml = screen(); return { broken: xml.includes('not available') || xml.includes('ERR_'), login: xml.includes('게스트로 시작하기') }; };

async function open(label) {
  shell('am', 'start', '-n', `${PACKAGE}/.MainActivity`);
  await sleep(25000);
  const seen = state();
  shot(label);
  console.log(`RESULT ${label}: ${JSON.stringify(seen)}`);
}

for (const [name, apk] of JSON.parse(process.argv[2])) {
  shell('pm', 'uninstall', PACKAGE);
  adb('logcat', '-c');
  console.log(`INSTALL ${name}: ${spawnSync('adb', ['install', '-r', apk], { encoding: 'utf8' }).stdout.trim()}`);
  shell('pm', 'grant', PACKAGE, 'android.permission.POST_NOTIFICATIONS');
  await open(`${name}-1-fresh`);
  shell('am', 'force-stop', PACKAGE);
  await sleep(1000);
  await open(`${name}-2-restart`);
  const log = adb('logcat', '-d', '-v', 'time');
  fs.writeFileSync(path.join(OUT, `${name}-app.txt`), log.split('\n').filter((l) => /TMusic|tmusic|AssetManager|FATAL|cr_Aw|chromium/.test(l)).join('\n'));
  console.log(`MISSING ${name}: ${(log.match(/missing app file[^\n]*/g) || []).slice(0, 3).join(' | ')}`);
  shell('am', 'force-stop', PACKAGE);
}
process.exit(0);
