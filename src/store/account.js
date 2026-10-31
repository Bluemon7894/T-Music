import { create } from 'zustand';
import {
  GoogleAuthProvider,
  deleteUser,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInAnonymously,
  signInWithCredential,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth, firebaseConfig } from '../lib/firebase.js';
import { api, errorText } from '../lib/api.js';
import { deleteCloudData, startLibrarySync, stopLibrarySync } from '../lib/librarySync.js';
import { deleteOwnedShares, startSharedPlaylists, stopSharedPlaylists } from '../lib/sharedPlaylists.js';
import { useFriends } from './friends.js';
import { forgetLibrary, libraryData, setLibraryOwner } from './library.js';
import { resetPlayer } from './player.js';
import { useRoom } from './room.js';

const AUTH_ERRORS = {
  'auth/network-request-failed': '인터넷 연결을 확인해 주세요.',
  'auth/configuration-not-found': '로그인 서비스가 아직 설정되지 않았습니다.',
  'auth/operation-not-allowed': '이 로그인 방식이 아직 켜져 있지 않습니다.',
  'auth/admin-restricted-operation': '이 로그인 방식이 아직 켜져 있지 않습니다.',
  'auth/too-many-requests': '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  'auth/user-disabled': '사용이 중지된 계정입니다.',
  'auth/invalid-credential': '구글 로그인에 실패했습니다. 다시 시도해 주세요.',
  'auth/user-mismatch': '이 계정과 다른 구글 계정으로 로그인했습니다.',
};

const describe = (e) => AUTH_ERRORS[e?.code] || (e?.code ? '로그인에 실패했습니다.' : errorText(e));
const isOffline = (e) => e?.code === 'auth/network-request-failed';

function toAccount(user) {
  if (!user) return null;
  const google = user.providerData.find((p) => p.providerId === GoogleAuthProvider.PROVIDER_ID);
  return {
    uid: user.uid,
    isGuest: user.isAnonymous,
    name: user.displayName || google?.displayName || '게스트',
    email: user.email || google?.email || null,
    photo: user.photoURL || google?.photoURL || null,
  };
}

// The Firebase SDK can only delete the signed-in user, and by this point that's someone else.
function deleteAccountByToken(idToken) {
  return fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${firebaseConfig.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  }).catch(() => {});
}

async function googleCredential() {
  const tokens = await api.googleSignIn();
  return tokens && GoogleAuthProvider.credential(tokens.idToken, tokens.accessToken);
}

export const useAccount = create((set, get) => {
  let owner;
  let carriedOver = null; // a guest's library on its way into the Google account they signed into

  const publish = () => {
    const user = auth.currentUser;
    const uid = user?.uid ?? null;
    if (uid !== owner) {
      stopSharedPlaylists();
      stopLibrarySync();
      setLibraryOwner(uid, carriedOver);
      carriedOver = null;
      owner = uid;
      if (uid) {
        startLibrarySync(uid);
        startSharedPlaylists();
        useRoom.getState().resume();
        useFriends.getState().start();
      } else {
        useFriends.getState().stop();
      }
    }
    if (uid) useFriends.getState().syncProfile();
    set({ status: user ? 'signedIn' : 'signedOut', user: toAccount(user), offline: user ? false : get().offline });
  };

  const attempt = async (busy, work) => {
    set({ busy, error: null, canContinueOffline: false });
    try {
      await work();
      return true;
    } catch (e) {
      set({ error: describe(e), canContinueOffline: isOffline(e) });
      return false;
    } finally {
      set({ busy: null });
      publish();
    }
  };

  // That Google account already has its own data: move the guest's library into it, then remove
  // the guest account. If the sign-in fails, the guest's copy on this computer is uploaded again.
  const mergeGuestInto = async (credential) => {
    const guest = auth.currentUser;
    const guestToken = await guest.getIdToken();
    const data = libraryData();
    useRoom.getState().disconnect();
    await useFriends.getState().deleteEverything();
    stopSharedPlaylists();
    stopLibrarySync();
    await deleteCloudData(guest.uid).catch(() => {});
    carriedOver = data;
    try {
      await signInWithCredential(auth, credential);
    } catch (e) {
      carriedOver = null;
      startLibrarySync(guest.uid);
      startSharedPlaylists();
      useFriends.getState().start();
      throw e;
    }
    forgetLibrary(guest.uid);
    deleteAccountByToken(guestToken);
  };

  // A guest or a deleted account is gone for good, so it really leaves its room and ends its
  // shares. A Google account signing out stays in its room and comes back to it next time.
  const leaveEverything = async ({ forGood }) => {
    const room = useRoom.getState();
    if (forGood) await room.leave();
    else room.disconnect();
    resetPlayer();
    await (forGood ? useFriends.getState().deleteEverything() : useFriends.getState().goOffline());
    if (forGood) await deleteOwnedShares();
    stopSharedPlaylists();
    stopLibrarySync();
  };

  // Registered here so the first state arrives once the saved session has been read from disk.
  onAuthStateChanged(auth, publish);

  return {
    status: 'loading', // loading | signedOut | signedIn
    user: null,
    busy: null, // guest | google
    error: null,
    offline: false, // using downloads without an account because there's no internet
    canContinueOffline: false,

    signInAsGuest: () => attempt('guest', () => signInAnonymously(auth)),

    // A guest keeps their uid and data when they connect Google. If that Google account already
    // exists, linking is refused and the guest's data moves into the existing account instead.
    signInWithGoogle: () => attempt('google', async () => {
      const credential = await googleCredential();
      if (!credential) return;
      if (!auth.currentUser?.isAnonymous) {
        await signInWithCredential(auth, credential);
        return;
      }
      try {
        await linkWithCredential(auth.currentUser, credential);
      } catch (e) {
        if (e?.code !== 'auth/credential-already-in-use') throw e;
        await mergeGuestInto(GoogleAuthProvider.credentialFromError(e) || credential);
      }
    }),

    cancelGoogle: () => api.cancelGoogleSignIn(),

    continueOffline: () => set({ offline: true, error: null, canContinueOffline: false }),
    leaveOffline: () => set({ offline: false }),

    // A guest account can't be signed back into, so leaving deletes it. If that fails offline,
    // the orphaned empty account does no harm.
    async signOut() {
      const user = auth.currentUser;
      set({ status: 'loading' }); // removing a guest's data takes a few seconds
      await leaveEverything({ forGood: Boolean(user?.isAnonymous) });
      if (user?.isAnonymous) {
        await deleteCloudData(user.uid).catch(() => {});
        forgetLibrary(user.uid);
        await deleteUser(user).catch(() => {});
      }
      await firebaseSignOut(auth);
      set({ error: null });
      publish();
    },

    // Deleting needs a fresh login. Asking first means cancelling can't leave a half-deleted account.
    deleteAccount: () => attempt('google', async () => {
      const user = auth.currentUser;
      if (!user) return;
      if (!user.isAnonymous) {
        const credential = await googleCredential();
        if (!credential) return;
        await reauthenticateWithCredential(user, credential);
      }
      set({ status: 'loading' });
      await leaveEverything({ forGood: true });
      await deleteCloudData(user.uid);
      forgetLibrary(user.uid, { everything: !user.isAnonymous });
      await deleteUser(user);
    }),
  };
});
