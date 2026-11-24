// Waking a friend whose app isn't running. A phone looks in a box of its own every fifteen minutes or so
// (android/.../WakeCheck.java) and shows what it finds as a notification. The box's address is random and
// only the owner's friends can read it, in friendWake. A computer can't be reached while the app is closed:
// it sees the ordinary invite the next time it opens.
import { get as dbGet, push, ref, remove, serverTimestamp, set as dbSet, update } from 'firebase/database';
import { rtdb } from './firebase.js';
import { IS_ANDROID } from './platform.js';

const native = () => (IS_ANDROID ? window.TMusicNative : null);
const newSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 32);

// Where Firebase sends this phone a push (functions/index.js), kept under the account while signed in.
let stopTokenWatch = null;
async function savePushToken(uid, token) {
  if (!token || token.length < 20 || /[.$#[\]/]/.test(token)) return;
  await update(ref(rtdb), { [`pushTokens/${uid}/${token}`]: Date.now() }).catch(() => {});
}

// Signed in on a phone: make sure friends can reach it.
export async function openWakeBox(uid) {
  const phone = native();
  if (!phone?.setWakeBox || !uid) return;
  if (phone.pushToken) {
    stopTokenWatch?.();
    const { onNative } = await import('../android/native.js');
    stopTokenWatch = onNative('pushToken', ({ token }) => savePushToken(uid, token));
    savePushToken(uid, phone.pushToken());
  }
  let secret = phone.wakeBox() || '';
  if (secret) {
    const owner = (await dbGet(ref(rtdb, `wakeOwners/${secret}`)).catch(() => null))?.val();
    if (owner && owner !== uid) secret = ''; // another account used this phone before
  }
  if (!secret) {
    secret = newSecret();
    await dbSet(ref(rtdb, `wakeOwners/${secret}`), uid);
  }
  await update(ref(rtdb), { [`friendWake/${uid}/${secret}`]: true });
  // What woke it last time has been seen by now.
  await remove(ref(rtdb, `wakeBox/${secret}`)).catch(() => {});
  phone.setWakeBox(secret);
}

// Signed out on this phone: nobody should wake it for that account any more.
export async function closeWakeBox(uid) {
  const phone = native();
  if (!phone?.setWakeBox) return;
  const secret = phone.wakeBox() || '';
  phone.setWakeBox('');
  stopTokenWatch?.();
  stopTokenWatch = null;
  const token = phone.pushToken?.() || '';
  if (!uid) return;
  const gone = {};
  if (secret) Object.assign(gone, { [`friendWake/${uid}/${secret}`]: null, [`wakeBox/${secret}`]: null, [`wakeOwners/${secret}`]: null });
  if (token && !/[.$#[\]/]/.test(token)) gone[`pushTokens/${uid}/${token}`] = null;
  if (Object.keys(gone).length) await update(ref(rtdb), gone).catch(() => {});
}

// Returns how many of the friend's phones were reached.
const WAKE_KEEP_MS = 2 * 60 * 60 * 1000; // a phone shows nothing older than this (WakeCheck.FRESH_MS)

export async function wakeFriend(uid, invite) {
  const boxes = Object.keys((await dbGet(ref(rtdb, `friendWake/${uid}`)).catch(() => null))?.val() || {});
  let reached = 0;
  for (const secret of boxes) {
    // What this sender left before and the phone never picked up goes, so a box can't pile up.
    const box = (await dbGet(ref(rtdb, `wakeBox/${secret}`)).catch(() => null))?.val() || {};
    const stale = Object.entries(box).filter(([, w]) => w?.from === invite.from && Date.now() - (Number(w.at) || 0) > WAKE_KEEP_MS);
    if (stale.length) await update(ref(rtdb), Object.fromEntries(stale.map(([id]) => [`wakeBox/${secret}/${id}`, null]))).catch(() => {});
    try {
      await dbSet(push(ref(rtdb, `wakeBox/${secret}`)), { ...invite, at: serverTimestamp() });
      reached++;
    } catch { /* that phone was signed out */ }
  }
  return reached;
}
