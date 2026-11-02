// What went wrong with playback, kept so a problem that can't be reproduced can still be looked at later.
// Only ids and player states; it leaves the device when someone copies it.
const KEY = 't-music-trouble';
const MAX_NOTES = 60;

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
};

export function noteTrouble(kind, detail = {}) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...read(), { at: new Date().toISOString(), kind, ...detail }].slice(-MAX_NOTES)));
  } catch { /* the note isn't worth more trouble */ }
}

export const troubleNotes = () => read();
