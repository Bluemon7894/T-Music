// What went wrong with playback, kept so a problem that can't be reproduced can still be looked at later.
// Only ids and player states; it leaves the device when someone copies it.
import { reportError } from './telemetry.js';

const KEY = 't-music-trouble';
const MAX_NOTES = 60;

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
};

export function noteTrouble(kind, detail = {}) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...read(), { at: new Date().toISOString(), kind, ...detail }].slice(-MAX_NOTES)));
  } catch { /* the note isn't worth more trouble */ }
  // The same note goes to the developer (see telemetry.js), unless the phone was simply offline.
  if (!detail.offline) reportError('playback', kind, detail);
}

export const troubleNotes = () => read();
