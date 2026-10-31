// The small synchronous subset of Node's fs that electron/youtube and electron/lyrics use, backed by
// the app's storage on the phone.
import { Native } from '../native.js';

const fs = {
  readFileSync(path) {
    const text = Native.fsRead(path);
    if (text === null || text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  },
  writeFileSync(path, content) {
    if (!Native.fsWrite(path, String(content))) throw new Error(`could not write ${path}`);
  },
  existsSync: (path) => Native.fsExists(path),
  mkdirSync() {}, // writing a file creates its folders
  rmSync: (path) => { Native.fsDelete(path); },
};

export default fs;
