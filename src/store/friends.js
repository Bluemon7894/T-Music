// Friends live in Realtime Database because presence and invites need to arrive instantly.
// Friendships are mutual: a request can only be turned into a friendship by the person who got it,
// and only friends can read each other's presence (enforced by database.rules.json).
import { create } from 'zustand';
import {
  get as dbGet,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set as dbSet,
  update,
} from 'firebase/database';
import { auth, rtdb } from '../lib/firebase.js';
import { api } from '../lib/api.js';
import { safeTrack } from '../lib/safeTrack.js';
import { useNav } from './nav.js';
import { usePlayer } from './player.js';
import { useRoom } from './room.js';
import { toast, useUI } from './ui.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const INVITE_LIFETIME_MS = 6 * 60 * 60 * 1000;
const PRESENCE_DELAY_MS = 800;
const DEFAULT_SHARING = { online: true, track: true };

const dbRef = (...parts) => ref(rtdb, parts.join('/'));
const myUid = () => auth.currentUser?.uid ?? null;

export const normalizeFriendCode = (text) => String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

function myProfile() {
  const user = auth.currentUser;
  const google = user.providerData.find((p) => p.providerId === 'google.com');
  return {
    name: (user.displayName || google?.displayName || `게스트 ${user.uid.slice(0, 4).toUpperCase()}`).slice(0, 40),
    photo: (user.photoURL || google?.photoURL || '').slice(0, 500) || null,
  };
}

export const useFriends = create((set, get) => {
  let stopListening = [];
  const friendWatchers = new Map();
  let presenceTimer = null;
  let connected = false;
  let lastProfile = '';
  let announced = new Set();

  const presenceRef = () => dbRef('presence', myUid());

  const presenceValue = () => {
    const { sharing } = get();
    if (!sharing.online) return null;
    const player = usePlayer.getState();
    const track = sharing.track ? safeTrack(player.current()) : null;
    return { online: true, track, playing: Boolean(track && player.playing), updatedAt: serverTimestamp() };
  };

  const publishPresence = async () => {
    clearTimeout(presenceTimer);
    presenceTimer = null;
    if (!connected || !myUid()) return;
    const value = presenceValue();
    try {
      if (value) {
        await onDisconnect(presenceRef()).set({ online: false, lastSeen: serverTimestamp() });
        await dbSet(presenceRef(), value);
      } else {
        await onDisconnect(presenceRef()).cancel();
        await remove(presenceRef());
      }
    } catch (e) {
      console.warn('[friends]', e);
    }
  };

  const schedulePresence = () => {
    clearTimeout(presenceTimer);
    presenceTimer = setTimeout(publishPresence, PRESENCE_DELAY_MS);
  };

  const patchFriend = (uid, patch) => {
    const { friends } = get();
    if (friends[uid]) set({ friends: { ...friends, [uid]: { ...friends[uid], ...patch } } });
  };

  const watchFriend = (uid) => {
    const stops = [
      onValue(dbRef('profiles', uid), (snap) => {
        const p = snap.val() || {};
        patchFriend(uid, { name: p.name || '알 수 없음', photo: p.photo || null });
      }),
      onValue(dbRef('presence', uid), (snap) => {
        const p = snap.val();
        patchFriend(uid, { online: p?.online === true, track: p?.online ? safeTrack(p.track) : null, playing: p?.playing === true });
      }, () => patchFriend(uid, { online: false, track: null, playing: false })),
    ];
    friendWatchers.set(uid, () => stops.forEach((stop) => stop()));
  };

  const onFriends = (snap) => {
    const ids = Object.keys(snap.val() || {});
    const current = get().friends;
    const friends = {};
    for (const uid of ids) friends[uid] = current[uid] || { name: '', photo: null, online: false, track: null, playing: false };
    set({ friends });
    for (const uid of ids) if (!friendWatchers.has(uid)) watchFriend(uid);
    for (const [uid, stop] of friendWatchers) {
      if (ids.includes(uid)) continue;
      stop();
      friendWatchers.delete(uid);
    }
  };

  const notify = (key, title, body, onClick) => {
    if (announced.has(key)) return;
    announced.add(key);
    if (document.hasFocus()) return;
    try {
      const n = new Notification(title, { body });
      n.onclick = () => {
        api.showWindow().catch(() => {});
        onClick?.();
      };
    } catch { /* the in-app card still shows */ }
  };

  const onRequests = (snap) => {
    const requests = Object.entries(snap.val() || {}).map(([uid, r]) => ({ uid, name: r.name || '알 수 없음', photo: r.photo || null })).sort((a, b) => (a.uid < b.uid ? -1 : 1));
    for (const r of requests) {
      if (!announced.has(`request:${r.uid}`)) toast(`${r.name}님이 친구 요청을 보냈어요`);
      notify(`request:${r.uid}`, '친구 요청', `${r.name}님이 친구 요청을 보냈어요`, () => useNav.getState().go('friends', {}));
    }
    set({ requests });
  };

  const onInvites = (snap) => {
    const now = Date.now();
    const invites = [];
    for (const [id, invite] of Object.entries(snap.val() || {})) {
      if (now - (invite.at || 0) > INVITE_LIFETIME_MS) {
        remove(dbRef('invites', myUid(), id)).catch(() => {});
        continue;
      }
      invites.push({ id, ...invite });
      notify(`invite:${id}`, '같이 듣기 초대', `${invite.fromName || '친구'}님이 같이 듣자고 해요`, () => useUI.getState().setMini(false));
    }
    set({ invites });
  };

  const ensureProfile = async (uid) => {
    const profile = (await dbGet(dbRef('profiles', uid))).val() || {};
    let friendCode = profile.friendCode;
    for (let attempt = 0; !friendCode && attempt < 5; attempt++) {
      const code = randomCode();
      const { committed } = await runTransaction(dbRef('friendCodes', code), (current) => (current ? undefined : uid));
      if (committed) friendCode = code;
    }
    const mine = myProfile();
    lastProfile = JSON.stringify(mine);
    await update(dbRef('profiles', uid), { ...mine, friendCode });
    set({ friendCode });
  };

  return {
    friendCode: null,
    friends: {},
    requests: [],
    invites: [],
    sharing: DEFAULT_SHARING,

    start() {
      const uid = myUid();
      if (!uid) return;
      get().stop();
      announced = new Set();
      ensureProfile(uid).catch((e) => console.warn('[friends]', e));
      stopListening = [
        onValue(dbRef('profiles', uid, 'sharing'), (snap) => {
          set({ sharing: { ...DEFAULT_SHARING, ...snap.val() } });
          publishPresence();
        }),
        onValue(dbRef('friends', uid), onFriends),
        onValue(dbRef('friendRequests', uid), onRequests),
        onValue(dbRef('invites', uid), onInvites),
        onValue(ref(rtdb, '.info/connected'), (snap) => {
          connected = snap.val() === true;
          if (connected) publishPresence();
        }),
        usePlayer.subscribe((s, prev) => {
          if (s.queue[s.index]?.id !== prev.queue[prev.index]?.id || s.playing !== prev.playing) schedulePresence();
        }),
      ];
    },

    stop() {
      clearTimeout(presenceTimer);
      presenceTimer = null;
      connected = false;
      for (const stop of stopListening) stop();
      stopListening = [];
      for (const stop of friendWatchers.values()) stop();
      friendWatchers.clear();
      set({ friendCode: null, friends: {}, requests: [], invites: [], sharing: DEFAULT_SHARING });
    },

    // Signing out: look offline right away instead of waiting for the connection to drop.
    async goOffline() {
      const uid = myUid();
      get().stop();
      if (!uid) return;
      const presence = dbRef('presence', uid);
      await onDisconnect(presence).cancel().catch(() => {});
      await remove(presence).catch(() => {});
    },

    // A guest connecting Google gets a real name and photo without changing accounts.
    syncProfile() {
      const uid = myUid();
      if (!uid || !get().friendCode) return;
      const mine = myProfile();
      const json = JSON.stringify(mine);
      if (json === lastProfile) return;
      lastProfile = json;
      update(dbRef('profiles', uid), mine).catch(() => {});
    },

    setSharing(patch) {
      update(dbRef('profiles', myUid(), 'sharing'), patch).catch(() => toast('설정을 저장하지 못했습니다'));
    },

    // Returns an error message, or null if the request went out.
    async addFriend(text) {
      const code = normalizeFriendCode(text);
      if (code.length !== CODE_LENGTH) return `친구 코드는 ${CODE_LENGTH}자리입니다.`;
      if (code === get().friendCode) return '내 코드는 추가할 수 없어요.';
      try {
        const target = (await dbGet(dbRef('friendCodes', code))).val();
        if (!target) return '이 코드의 사용자를 찾을 수 없어요.';
        if (get().friends[target]) return '이미 친구예요.';
        if (get().requests.some((r) => r.uid === target)) {
          await get().acceptRequest(target);
          return null;
        }
        await dbSet(dbRef('friendRequests', target, myUid()), myProfile());
        toast('친구 요청을 보냈어요');
        return null;
      } catch (e) {
        console.warn('[friends]', e);
        return '친구 요청을 보내지 못했습니다. 인터넷 연결을 확인해 주세요.';
      }
    },

    async acceptRequest(uid) {
      const me = myUid();
      const since = Date.now();
      await update(ref(rtdb), {
        [`friends/${me}/${uid}`]: { since },
        [`friends/${uid}/${me}`]: { since },
        [`friendRequests/${me}/${uid}`]: null,
      });
      toast('친구가 되었어요');
    },

    declineRequest(uid) {
      remove(dbRef('friendRequests', myUid(), uid)).catch(() => toast('처리하지 못했습니다'));
    },

    removeFriend(uid) {
      const me = myUid();
      update(ref(rtdb), { [`friends/${me}/${uid}`]: null, [`friends/${uid}/${me}`]: null }).catch(() => toast('삭제하지 못했습니다'));
    },

    // Invites into the room we're in, opening one first if we aren't in any.
    async inviteFriend(uid) {
      const room = useRoom.getState();
      if (!room.code) await room.create();
      else if (!room.attached) await room.follow();
      const { code, meta } = useRoom.getState();
      if (!code) {
        toast('방을 만들지 못했습니다');
        return;
      }
      try {
        const { name, photo } = myProfile();
        await dbSet(push(dbRef('invites', uid)), { from: myUid(), fromName: name, ...(photo ? { fromPhoto: photo } : {}), code, roomName: String(meta?.name || '').slice(0, 40), at: serverTimestamp() });
        toast(`${get().friends[uid]?.name || '친구'}님을 초대했어요`);
      } catch (e) {
        console.warn('[friends]', e);
        toast('초대를 보내지 못했습니다');
      }
    },

    async acceptInvite(invite) {
      remove(dbRef('invites', myUid(), invite.id)).catch(() => {});
      useUI.getState().setMini(false);
      useNav.getState().go('room', {});
      await useRoom.getState().join(invite.code);
      const { code, error } = useRoom.getState();
      if (code !== invite.code && error) toast(error);
    },

    declineInvite(invite) {
      remove(dbRef('invites', myUid(), invite.id)).catch(() => {});
    },

    // The account is going away for good: leave nothing behind in other people's lists.
    async deleteEverything() {
      const uid = myUid();
      if (!uid) return;
      const { friends, friendCode } = get();
      const code = friendCode || (await dbGet(dbRef('profiles', uid, 'friendCode')).catch(() => null))?.val();
      const friendIds = Object.keys(friends);
      await get().goOffline();
      const changes = {
        [`presence/${uid}`]: null,
        [`profiles/${uid}`]: null,
        [`friendRequests/${uid}`]: null,
        [`invites/${uid}`]: null,
        ...(code ? { [`friendCodes/${code}`]: null } : {}),
      };
      for (const friend of friendIds) {
        changes[`friends/${uid}/${friend}`] = null;
        changes[`friends/${friend}/${uid}`] = null;
      }
      await update(ref(rtdb), changes).catch((e) => console.warn('[friends]', e));
    },
  };
});
