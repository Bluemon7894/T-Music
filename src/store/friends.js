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
import { OFFLINE_MESSAGE, waitForConnection, within } from '../lib/online.js';
import { safePhoto, safeTrack } from '../lib/safeTrack.js';
import { useNav } from './nav.js';
import { usePlayer } from './player.js';
import { useRadio } from './radio.js';
import { photoToShow, useProfile } from './profile.js';
import { useRoom } from './room.js';
import { toast, useUI } from './ui.js';
import { record } from './undo.js';
import { tr } from '../lib/i18n.js';
import { isLocalId } from '../../electron/localId.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const INVITE_LIFETIME_MS = 6 * 60 * 60 * 1000;
const PRESENCE_DELAY_MS = 800;
// Listening details stay private until someone chooses to show them: nobody agreed to this when they signed up.
// Shown until someone turns it off.
const DEFAULT_SHARING = { online: true, track: true, playlists: true, topTracks: true, time: true, artists: true, genres: true };
const OFFLINE_CLEANUP_MS = 4000;
const PRESENCE_RETRY_MS = 5000;

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
    name: (user.displayName || google?.displayName || tr('게스트 {0}', user.uid.slice(0, 4).toUpperCase())).slice(0, 40),
    photo: photoToShow(user),
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
    const radio = useRadio.getState();
    // The radio channel goes in its own field: older versions don't know it and simply show "online".
    if (sharing.track && radio.on && radio.station) {
      const s = radio.station;
      return {
        online: true,
        track: null,
        playing: !radio.paused,
        radio: {
          id: String(s.id || '').slice(0, 80),
          kind: s.kind === 'youtube' ? 'youtube' : 'station',
          name: String(s.name || '').slice(0, 80),
          band: s.band === 'AM' ? 'AM' : 'FM',
          freq: Number(s.freq) || 0,
          ...(s.url ? { url: String(s.url).slice(0, 500) } : {}),
          ...(s.videoId ? { videoId: String(s.videoId).slice(0, 20) } : {}),
          ...(s.logo ? { logo: safePhoto(s.logo) } : {}),
          hls: s.hls === true,
        },
        updatedAt: serverTimestamp(),
      };
    }
    const track = sharing.track && !isLocalId(player.current()?.id) ? safeTrack(player.current()) : null;
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
    let stopPresence = null;
    let retry = null;
    let stopped = false;
    // The server drops a listener it refuses, for instance right after signing in, and it never comes
    // back by itself. Without this, a friend stays "offline" until the app restarts.
    const listen = () => {
      stopPresence = onValue(dbRef('presence', uid), (snap) => {
        const p = snap.val();
        const radio = p?.online && p.radio && typeof p.radio.name === 'string' ? {
          id: String(p.radio.id || '').slice(0, 80),
          kind: p.radio.kind === 'youtube' ? 'youtube' : 'station',
          name: p.radio.name.slice(0, 80),
          band: p.radio.band === 'AM' ? 'AM' : 'FM',
          freq: Number(p.radio.freq) || 0,
          url: typeof p.radio.url === 'string' ? p.radio.url.slice(0, 500) : null,
          videoId: typeof p.radio.videoId === 'string' ? p.radio.videoId.slice(0, 20) : null,
          logo: safePhoto(p.radio.logo),
          hls: p.radio.hls === true,
        } : null;
        patchFriend(uid, { online: p?.online === true, track: p?.online ? safeTrack(p.track) : null, radio, playing: p?.playing === true });
      }, () => {
        patchFriend(uid, { online: false, track: null, playing: false });
        if (!stopped) retry = setTimeout(listen, PRESENCE_RETRY_MS);
      });
    };
    listen();
    const stopProfile = onValue(dbRef('profiles', uid), (snap) => {
      const p = snap.val() || {};
      patchFriend(uid, { name: p.name || tr('알 수 없음'), photo: safePhoto(p.photo) });
    });
    friendWatchers.set(uid, () => {
      stopped = true;
      clearTimeout(retry);
      stopPresence?.();
      stopProfile();
    });
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
    const requests = Object.entries(snap.val() || {}).map(([uid, r]) => ({ uid, name: r.name || tr('알 수 없음'), photo: safePhoto(r.photo) })).sort((a, b) => (a.uid < b.uid ? -1 : 1));
    // Someone who asked and then deleted their guest account: there's nobody left to accept.
    for (const r of requests) {
      dbGet(dbRef('profiles', r.uid)).then((p) => { if (!p.exists()) remove(dbRef('friendRequests', myUid(), r.uid)).catch(() => {}); }).catch(() => {});
    }
    for (const r of requests) {
      if (!announced.has(`request:${r.uid}`)) toast(tr('{0}님이 친구 요청을 보냈어요', r.name));
      notify(`request:${r.uid}`, tr('친구 요청'), tr('{0}님이 친구 요청을 보냈어요', r.name), () => useNav.getState().go('friends', {}));
    }
    set({ requests });
  };

  const onInvites = (snap) => {
    const now = Date.now();
    const invites = [];
    for (const [id, invite] of Object.entries(snap.val() || {})) {
      if (now - (invite.at || 0) > INVITE_LIFETIME_MS || invite.code === useRoom.getState().code) {
        remove(dbRef('invites', myUid(), id)).catch(() => {});
        continue;
      }
      invites.push({ id, ...invite, fromPhoto: safePhoto(invite.fromPhoto) });
      notify(`invite:${id}`, tr('같이 듣기 초대'), tr('{0}님이 같이 듣자고 해요', invite.fromName || tr('친구')), () => useUI.getState().setMini(false));
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
    sentRequests: {}, // people asked this session, so the button doesn't offer it twice

    start() {
      const uid = myUid();
      if (!uid) return;
      get().stop();
      announced = new Set();
      ensureProfile(uid).catch((e) => console.warn('[friends]', e));
      useProfile.getState().start(() => get().sharing);
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
        // A late "gone" note from an old connection or another device says offline while we're right here.
        onValue(presenceRef(), (snap) => {
          if (connected && get().sharing.online && snap.val()?.online !== true) schedulePresence();
        }),
        useRadio.subscribe((s, prev) => {
          if (s.station !== prev.station || s.on !== prev.on || s.paused !== prev.paused) schedulePresence();
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
      set({ friendCode: null, friends: {}, requests: [], invites: [], sharing: DEFAULT_SHARING, sentRequests: {} });
    },

    // Signing out: look offline right away instead of waiting for the connection to drop.
    async goOffline() {
      const uid = myUid();
      get().stop();
      if (!uid) return;
      const presence = dbRef('presence', uid);
      await within(onDisconnect(presence).cancel(), OFFLINE_CLEANUP_MS).catch(() => {});
      await within(remove(presence), OFFLINE_CLEANUP_MS).catch(() => {});
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
      const { sharing } = get();
      const before = Object.fromEntries(Object.keys(patch).map((key) => [key, sharing[key]]));
      set({ sharing: { ...sharing, ...patch } });
      update(dbRef('profiles', myUid(), 'sharing'), patch).catch(() => toast(tr('설정을 저장하지 못했습니다')));
      useProfile.getState().publishSoon(get().sharing);
      record(tr('공개 설정 변경'), () => get().setSharing(before));
    },

    // Returns an error message, or null if the request went out.
    async addFriend(text) {
      const code = normalizeFriendCode(text);
      if (code.length !== CODE_LENGTH) return tr('친구 코드는 {0}자리입니다.', CODE_LENGTH);
      if (code === get().friendCode) return tr('내 코드는 추가할 수 없어요.');
      try {
        await waitForConnection();
        const target = (await dbGet(dbRef('friendCodes', code))).val();
        if (!target) return tr('이 코드의 사용자를 찾을 수 없어요.');
        if (get().friends[target]) return tr('이미 친구예요.');
        if (get().requests.some((r) => r.uid === target)) {
          await get().acceptRequest(target);
          return null;
        }
        await dbSet(dbRef('friendRequests', target, myUid()), myProfile());
        set({ sentRequests: { ...get().sentRequests, [target]: true } });
        toast(tr('친구 요청을 보냈어요'));
        return null;
      } catch (e) {
        console.warn('[friends]', e);
        return OFFLINE_MESSAGE;
      }
    },

    // For someone we can already see, such as a member of the same room: no code needed.
    async requestFriend(uid) {
      if (!uid || uid === myUid() || get().friends[uid]) return;
      if (get().requests.some((r) => r.uid === uid)) {
        await get().acceptRequest(uid).catch(() => toast(OFFLINE_MESSAGE));
        return;
      }
      set({ sentRequests: { ...get().sentRequests, [uid]: true } });
      try {
        await waitForConnection();
        await dbSet(dbRef('friendRequests', uid, myUid()), myProfile());
        toast(tr('친구 요청을 보냈어요'));
      } catch (e) {
        console.warn('[friends]', e);
        const { [uid]: _, ...rest } = get().sentRequests;
        set({ sentRequests: rest });
        toast(OFFLINE_MESSAGE);
      }
    },

    async acceptRequest(uid) {
      const me = myUid();
      const since = Date.now();
      await waitForConnection();
      await update(ref(rtdb), {
        [`friends/${me}/${uid}`]: { since },
        [`friends/${uid}/${me}`]: { since },
        [`friendRequests/${me}/${uid}`]: null,
      });
      toast(tr('친구가 되었어요'));
    },

    declineRequest(uid) {
      remove(dbRef('friendRequests', myUid(), uid)).catch(() => toast(tr('처리하지 못했습니다')));
    },

    removeFriend(uid) {
      const me = myUid();
      update(ref(rtdb), { [`friends/${me}/${uid}`]: null, [`friends/${uid}/${me}`]: null }).catch(() => toast(tr('삭제하지 못했습니다')));
      // Being friends again takes both people, so this asks.
      record(tr('친구 삭제'), () => get().requestFriend(uid));
    },

    // Invites into the room we're in, opening one first if we aren't in any.
    async inviteFriend(uid) {
      const room = useRoom.getState();
      if (room.members[uid]) {
        toast(tr('이미 같은 방에 있어요'));
        return;
      }
      if (!room.code) await room.create();
      else if (!room.attached) await room.follow();
      const { code, meta } = useRoom.getState();
      if (!code) {
        toast(tr('방을 만들지 못했습니다'));
        return;
      }
      useRoom.getState().pardon(uid);
      try {
        await waitForConnection();
        const { name, photo } = myProfile();
        await dbSet(push(dbRef('invites', uid)), { from: myUid(), fromName: name, ...(photo ? { fromPhoto: photo } : {}), code, roomName: String(meta?.name || '').slice(0, 40), at: serverTimestamp() });
        toast(tr('{0}님을 초대했어요', get().friends[uid]?.name || tr('친구')));
      } catch (e) {
        console.warn('[friends]', e);
        toast(tr('초대를 보내지 못했습니다'));
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

    // What a guest needs noted down before it stops being the signed-in account.
    moveOutPlan() {
      onDisconnect(presenceRef()).cancel().catch(() => {});
      return { ids: Object.keys(get().friends), friendCode: get().friendCode };
    },

    // A guest becoming an existing Google account. The new account can't vouch for itself, so the guest,
    // still able to act through its token, leaves a note for each friend. The rules then let the new
    // account stand in, and the guest's own traces go at the same moment.
    async moveInto(guestUid, guestToken, { ids, friendCode }) {
      const me = myUid();
      const changes = {
        [`presence/${guestUid}`]: null,
        [`profiles/${guestUid}`]: null,
        [`friendProfiles/${guestUid}`]: null,
        [`friendRequests/${guestUid}`]: null,
        [`invites/${guestUid}`]: null,
        ...(friendCode ? { [`friendCodes/${friendCode}`]: null } : {}),
      };
      for (const friend of ids) {
        if (friend === me) continue;
        changes[`friendMoves/${me}/${friend}`] = guestUid;
        changes[`friends/${guestUid}/${friend}`] = null;
        changes[`friends/${friend}/${guestUid}`] = null;
      }
      try {
        const res = await fetch(`${rtdb.app.options.databaseURL}/.json?auth=${guestToken}`, { method: 'PATCH', body: JSON.stringify(changes) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const since = Date.now();
        const adopt = {};
        for (const friend of ids) {
          if (friend === me) continue;
          adopt[`friends/${me}/${friend}`] = { since };
          adopt[`friends/${friend}/${me}`] = { since };
        }
        if (Object.keys(adopt).length) await update(ref(rtdb), adopt);
        await remove(dbRef('friendMoves', me));
      } catch (e) {
        console.warn('[friends]', e);
        toast(tr('친구를 옮기지 못했어요. 친구 코드로 다시 추가해 주세요.'));
      }
    },

    // The account is going away for good: leave nothing behind in other people's lists.
    async deleteEverything() {
      const uid = myUid();
      if (!uid) return;
      const { friends, friendCode } = get();
      const code = friendCode || (await within(dbGet(dbRef('profiles', uid, 'friendCode')), OFFLINE_CLEANUP_MS).catch(() => null))?.val();
      const friendIds = Object.keys(friends);
      const asked = Object.keys(get().sentRequests);
      await get().goOffline();
      const changes = {
        ...Object.fromEntries(asked.map((other) => [`friendRequests/${other}/${uid}`, null])),
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
      await within(update(ref(rtdb), changes), OFFLINE_CLEANUP_MS).catch((e) => console.warn('[friends]', e));
    },
  };
});
