import { Client } from '@xhayper/discord-rpc';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const DEFAULT_CLIENT_ID = '1344211029410156554';
const configFile = () => path.join(app.getPath('userData'), 'discord-rpc-config.json');

let client = null;
let enabled = true;
let customClientId = null;
let currentActivity = null;
let connectPromise = null;
let reconnectTimer = null;

function loadConfig() {
  try {
    const raw = fs.readFileSync(configFile(), 'utf8');
    const data = JSON.parse(raw);
    if (typeof data.enabled === 'boolean') enabled = data.enabled;
    if (data.clientId) customClientId = data.clientId;
  } catch {
    // Default: enabled = true
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
        if (currentActivity) {
          applyActivity(currentActivity);
        }
      });

      rpc.on('disconnected', () => {
        client = null;
        scheduleReconnect();
      });

      await rpc.login().catch(() => {
        client = null;
        scheduleReconnect();
      });

      return client;
    } catch {
      client = null;
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
  }, 15000); // Retry every 15s if Discord wasn't running
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

  const { title, artist, thumb, playing, time = 0, duration = 0 } = data;

  const activity = {
    details: (title || '음악 듣는 중').slice(0, 128),
    state: (artist || 'T-Music').slice(0, 128),
    largeImageKey: thumb && /^https?:\/\//.test(thumb) ? thumb : 'logo',
    largeImageText: (title || 'T-Music').slice(0, 128),
    smallImageKey: playing ? 'play' : 'pause',
    smallImageText: playing ? '재생 중' : '일시정지',
    instance: false,
  };

  if (playing && typeof time === 'number' && isFinite(time) && time >= 0) {
    const now = Date.now();
    activity.startTimestamp = Math.floor(now - time * 1000);
    if (duration > 0 && duration > time) {
      activity.endTimestamp = Math.floor(now + (duration - time) * 1000);
    }
  }

  client.user.setActivity(activity).catch(() => {});
}

export function setActivity(data) {
  currentActivity = data;
  if (!enabled) return;
  if (!client) {
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
    client.user.clearActivity().catch(() => {});
  }
}

// Initial load
loadConfig();
if (enabled) {
  connect().catch(() => {});
}
