// Builds the Android app without Gradle: only the SDK's build tools and a JDK are needed.
//   node scripts/build-android.mjs            signed release APK in release/
//   node scripts/build-android.mjs --debug    debuggable APK, signed with a throwaway key
// The release key lives in android/release.keystore with its password in android/keystore.properties.
// Neither is in git. Lose them and installed apps can no longer be updated, so keep a backup.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// aapt2 can't open paths with non-English folder names, so everything below is relative to the project.
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const DEBUG = process.argv.includes('--debug');
const MIN_SDK = '26';
const TARGET_SDK = '35';
const BUILD_TOOLS = '35.0.0';

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA || os.homedir(), 'Android', 'Sdk');
const tools = path.join(sdk, 'build-tools', BUILD_TOOLS);
const androidJar = path.join(sdk, 'platforms', `android-${TARGET_SDK}`, 'android.jar');
if (!fs.existsSync(androidJar) || !fs.existsSync(tools)) {
  console.error(`Android SDK not found in ${sdk}. Install "platforms;android-${TARGET_SDK}" and "build-tools;${BUILD_TOOLS}".`);
  process.exit(1);
}

const win = process.platform === 'win32';
const tool = (name) => path.join(tools, name + (win ? (['d8', 'apksigner'].includes(name) ? '.bat' : '.exe') : ''));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], shell: cmd.endsWith('.bat'), ...opts });

// On Windows only some of the JDK's programs are on the PATH.
const javaHome = /java\.home = (.+)/.exec(spawnSync('java', ['-XshowSettings:properties', '-version'], { encoding: 'utf8' }).stderr)[1].trim();
const jdk = (name) => path.join(javaHome, 'bin', name);

const version = JSON.parse(fs.readFileSync(path.join('android', 'version.json'), 'utf8'));
const out = 'build-android';
const www = path.join(out, 'assets', 'www');

function listFiles(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listFiles(p, ext);
    return p.endsWith(ext) ? [p] : [];
  });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
    else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'res-flat'), { recursive: true });
fs.mkdirSync(path.join(out, 'gen'), { recursive: true });
fs.mkdirSync(path.join(out, 'classes'), { recursive: true });
fs.mkdirSync(path.join(out, 'dex'), { recursive: true });

console.log('web app');
const vite = path.join('node_modules', 'vite', 'bin', 'vite.js');
execFileSync(process.execPath, [vite, 'build', '--config', 'vite.android.config.js', '--mode', 'android', '--logLevel', 'warn'], { stdio: 'inherit' });
copyDir(path.join('dist-android'), www);
fs.renameSync(path.join(www, 'android.html'), path.join(www, 'index.html'));

// The same desktop OAuth client as the Windows app. Its secret ships with every install by Google's design.
const authConfig = path.join('electron', 'auth.config.json');
if (fs.existsSync(authConfig)) fs.copyFileSync(authConfig, path.join(www, 'auth.config.json'));

console.log('resources');
const resDir = path.join('android', 'res');
const flat = path.join(out, 'res-flat');
run(tool('aapt2'), ['compile', '--dir', resDir, '-o', path.join(flat, 'res.zip')]);

const unsigned = path.join(out, 'unsigned.apk');
run(tool('aapt2'), [
  'link', '-o', unsigned,
  '-I', androidJar,
  '--manifest', path.join('android', 'AndroidManifest.xml'),
  '--java', path.join(out, 'gen'),
  '--min-sdk-version', MIN_SDK,
  '--target-sdk-version', TARGET_SDK,
  '--version-code', String(version.code),
  '--version-name', version.name,
  '-A', path.join(out, 'assets'),
  ...(DEBUG ? ['--debug-mode'] : []),
  path.join(flat, 'res.zip'),
]);

console.log('code');
const sources = [...listFiles(path.join('android', 'java'), '.java'), ...listFiles(path.join(out, 'gen'), '.java')];
const argFile = path.join(out, 'javac-args.txt');
fs.writeFileSync(argFile, sources.map((s) => `"${s.replace(/\\/g, '/')}"`).join('\n'));
run('javac', ['-nowarn', '-Xlint:none', '-source', '8', '-target', '8', '-encoding', 'UTF-8', '-bootclasspath', [androidJar, path.join(tools, 'core-lambda-stubs.jar')].join(path.delimiter), '-d', path.join(out, 'classes'), `@${argFile}`]);
const jar = path.join(out, 'classes.jar');
run(jdk('jar'), ['cf', jar, '-C', path.join(out, 'classes'), '.']);
run(tool('d8'), [...(DEBUG ? ['--debug'] : ['--release']), '--min-api', MIN_SDK, '--lib', androidJar, '--output', path.join(out, 'dex'), jar]);
run(tool('aapt'), ['add', path.relative(path.join(out, 'dex'), unsigned), 'classes.dex'], { cwd: path.join(out, 'dex') });

console.log('signing');
const aligned = path.join(out, 'aligned.apk');
run(tool('zipalign'), ['-f', '-p', '4', unsigned, aligned]);

function keytool(keystore, password) {
  run(jdk('keytool'), ['-genkeypair', '-keystore', keystore, '-alias', 'tmusic', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '36500',
    '-storepass', password, '-keypass', password, '-dname', 'CN=T-Music'], { stdio: 'ignore' });
}

let keystore;
let password;
if (DEBUG) {
  keystore = path.join(out, 'debug.keystore');
  password = 'debugdebug';
  keytool(keystore, password);
} else {
  keystore = path.join('android', 'release.keystore');
  const props = path.join('android', 'keystore.properties');
  if (!fs.existsSync(keystore)) {
    password = randomBytes(24).toString('hex');
    keytool(keystore, password);
    fs.writeFileSync(props, `password=${password}\n`);
    console.log('created a new release key in android/release.keystore. Back it up with android/keystore.properties.');
  } else {
    password = /password=(.+)/.exec(fs.readFileSync(props, 'utf8'))[1].trim();
  }
}

fs.mkdirSync(path.join('release'), { recursive: true });
const apk = path.join('release', DEBUG ? 'T-Music-Android-debug.apk' : `T-Music-Android-${version.name}.apk`);
run(tool('apksigner'), ['sign', '--ks', keystore, '--ks-pass', `pass:${password}`, '--key-pass', `pass:${password}`, '--min-sdk-version', MIN_SDK, '--out', apk, aligned]);
run(tool('apksigner'), ['verify', '--min-sdk-version', MIN_SDK, apk]);
fs.rmSync(`${apk}.idsig`, { force: true });
console.log(`${apk} ${(fs.statSync(apk).size / 1048576).toFixed(1)} MB`);
