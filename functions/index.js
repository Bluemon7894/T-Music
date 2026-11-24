// The only code that runs on a server: when a friend invites someone or asks to be friends and that person
// isn't in the app, their phones get a push right away. Phones register for it in android/.../Push.java and
// keep their addresses in pushTokens/{uid}. A phone that never registers still finds invites by looking
// every fifteen minutes (WakeCheck.java), and the app shows them when it opens.
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';
import { onValueCreated } from 'firebase-functions/v2/database';

initializeApp();

const where = { instance: 't-music-b8301-default-rtdb', region: 'asia-southeast1' };
const GONE = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);
const clip = (text, max) => String(text || '').slice(0, max);

async function pushTo(uid, data) {
  const db = getDatabase();
  // In the app already: it shows the invite itself, so a push would only say it twice.
  const presence = (await db.ref(`presence/${uid}`).get()).val();
  if (presence?.online === true) { console.log('push skipped: in the app'); return; }
  const tokens = Object.keys((await db.ref(`pushTokens/${uid}`).get()).val() || {});
  if (!tokens.length) { console.log('push skipped: no phone registered'); return; }
  const { responses } = await getMessaging().sendEach(tokens.map((token) => ({
    token,
    data,
    android: { priority: 'high', ttl: 2 * 60 * 60 * 1000 },
  })));
  const gone = {};
  responses.forEach((r, i) => { if (!r.success && GONE.has(r.error?.code)) gone[`pushTokens/${uid}/${tokens[i]}`] = null; });
  console.log('push', data.type, 'to', tokens.length, 'phones:', responses.map((r) => (r.success ? 'sent' : r.error?.code)).join(', '));
  if (Object.keys(gone).length) await db.ref().update(gone);
}

export const pushInvite = onValueCreated({ ...where, ref: '/invites/{to}/{id}' }, async (event) => {
  const invite = event.data.val() || {};
  if (!/^[A-Za-z0-9]{6}$/.test(invite.code || '')) return;
  await pushTo(event.params.to, { type: 'invite', id: event.params.id, fromName: clip(invite.fromName, 40), roomName: clip(invite.roomName, 40), code: invite.code });
});

export const pushFriendRequest = onValueCreated({ ...where, ref: '/friendRequests/{to}/{from}' }, async (event) => {
  const request = event.data.val() || {};
  await pushTo(event.params.to, { type: 'friendRequest', id: event.params.from, fromName: clip(request.name, 40) });
});
