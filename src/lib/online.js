// Firebase writes don't fail while offline, they wait until the connection returns. That's right
// for syncing in the background, but anything someone is waiting on needs a deadline.
import { onValue, ref } from 'firebase/database';
import { rtdb } from './firebase.js';

const CONNECT_WAIT_MS = 8000;

export const OFFLINE_MESSAGE = '인터넷에 연결되지 않았습니다. 연결을 확인해 주세요.';

export function within(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(OFFLINE_MESSAGE)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export function waitForConnection(ms = CONNECT_WAIT_MS) {
  return new Promise((resolve, reject) => {
    let stop = null;
    const timer = setTimeout(() => {
      stop?.();
      reject(new Error(OFFLINE_MESSAGE));
    }, ms);
    stop = onValue(ref(rtdb, '.info/connected'), (snap) => {
      if (snap.val() !== true) return;
      clearTimeout(timer);
      setTimeout(() => stop?.(), 0); // this can run before onValue has returned
      resolve();
    });
  });
}
