import { Client } from '@xhayper/discord-rpc';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

// Verified working YouTube Music Discord RPC Client ID
const DEFAULT_CLIENT_ID = '1177081335727267940';
const ACTIVITY_LISTENING = 2;
const STATUS_SHOWS_DETAILS = 2;
const configFile = () => path.join(app.getPath('userData'), 'discord-rpc-config.json');

let client = null;
let enabled = true;
let customClientId = null;
let currentActivity = null;
let connectPromise = null;
let reconnectTimer = null;
let lastError = null;

function loadConfig() {
  try {
    const raw = fs.readFileSync(configFile(), 'utf8');
    const data = JSON.parse(raw);
    if (typeof data.enabled === 'boolean') enabled = data.enabled;
    if (data.clientId) customClientId = data.clientId;
  } catch {
    enabled = true;
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configFile(), JSON.stringify({ enabled, clientId: customClientId || undefined }), 'utf8');
  } catch {}
}

export function isEnabled() {
  loadConfig();
  return enabled;
}

export function getClientId() {
  loadConfig();
  return customClientId || DEFAULT_CLIENT_ID;
}

export function getStatus() {
  loadConfig();
  return {
    enabled,
    connected: Boolean(client && client.user),
    user: client?.user ? { username: client.user.username, id: client.user.id } : null,
    clientId: getClientId(),
    isCustom: Boolean(customClientId),
    error: lastError,
  };
}

export async function setEnabled(val) {
  enabled = Boolean(val);
  saveConfig();
  if (!enabled) {
    clearActivity();
    await disconnect();
  } else {
    connect();
  }
  return enabled;
}

export async function setClientId(id) {
  customClientId = id?.trim() || null;
  saveConfig();
  if (enabled) {
    await disconnect();
    connect();
  }
  return getClientId();
}

async function connect() {
  if (!enabled) return null;
  if (client) return client;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      const clientId = getClientId();
      const rpc = new Client({ clientId });

      rpc.on('ready', () => {
        client = rpc;
        lastError = null;
        if (currentActivity) {
          applyActivity(currentActivity);
        }
      });

      rpc.on('disconnected', () => {
        client = null;
        scheduleReconnect();
      });

      rpc.transport.on('close', (e) => {
        if (e && e.message) lastError = e.message;
      });

      await rpc.login().catch((err) => {
        client = null;
        lastError = err?.message || 'Discord 연결 실패';
        rpc.destroy().catch(() => {});
        scheduleReconnect();
      });

      return client;
    } catch (err) {
      client = null;
      lastError = err?.message || 'Discord 클라이언트 오류';
      scheduleReconnect();
      return null;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}

function scheduleReconnect() {
  if (!enabled || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch(() => {});
  }, 10000);
}

async function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (client) {
    try {
      await client.destroy();
    } catch {}
    client = null;
  }
}

function applyActivity(data) {
  if (!client || !client.user) return;
  if (!enabled) return;

  const { id, title, artist, thumb, playing, time = 0, duration = 0 } = data;

  // Discord has no field for ranking activities: its client picks which one to show. Declaring this
  // as music ("듣는 중", not the default "하는 중") with the song title as the status text is what we control.
  const activity = {
    type: ACTIVITY_LISTENING,
    statusDisplayType: STATUS_SHOWS_DETAILS,
    details: (title || '음악 듣는 중').slice(0, 128),
    state: (artist || 'T-Music').slice(0, 128),
    instance: false,
  };

  // Large thumbnail image
  if (thumb && /^https?:\/\//.test(thumb)) {
    activity.largeImageKey = thumb;
    activity.largeImageText = (title || 'T-Music').slice(0, 128);
  }

  // Playback timer
  if (playing && typeof time === 'number' && isFinite(time) && time >= 0) {
    const now = Date.now();
    activity.startTimestamp = Math.floor(now - time * 1000);
    if (duration > 0 && duration > time) {
      activity.endTimestamp = Math.floor(now + (duration - time) * 1000);
    }
  }

  // Clickable button
  if (id && /^[\w-]{11}$/.test(id)) {
    activity.buttons = [
      { label: 'YouTube에서 듣기', url: `https://www.youtube.com/watch?v=${id}` },
    ];
  }

  try {
    client.user.setActivity(activity).catch((err) => {
      // If setting with buttons/images failed, retry with simple text
      if (activity.buttons || activity.largeImageKey) {
        delete activity.buttons;
        delete activity.largeImageKey;
        delete activity.largeImageText;
        client.user.setActivity(activity).catch(() => {});
      }
    });
  } catch {}
}

export function setActivity(data) {
  currentActivity = data;
  if (!enabled) return;
  if (!client || !client.user) {
    connect().then(() => {
      if (currentActivity === data) applyActivity(data);
    }).catch(() => {});
  } else {
    applyActivity(data);
  }
}

export function clearActivity() {
  currentActivity = null;
  if (client && client.user) {
    try {
      client.user.clearActivity().catch(() => {});
    } catch {}
  }
}

// Initial load
loadConfig();
if (enabled) {
  connect().catch(() => {});
}
