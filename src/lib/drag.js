// Dragging music around the app. Whatever is picked up (a track, an album, a playlist, an artist) travels
// as one description, and everything it can land on reads that same description.
import { useState } from 'react';
import { api } from './api.js';
import { IS_ANDROID } from './platform.js';
import { useLibrary } from '../store/library.js';
import { useNav } from '../store/nav.js';
import { usePlayer } from '../store/player.js';
import { useRoom } from '../store/room.js';
import { download } from '../store/downloads.js';
import { toast } from '../store/ui.js';
import { together } from '../store/undo.js';
import { tr } from './i18n.js';

const TYPE = 'application/x-tmusic';

// Only what's needed to find it again. A long playlist is fetched when it lands, not when it's picked up.
export function dragProps(makePayload) {
  if (IS_ANDROID) return {};
  return {
    draggable: true,
    onDragStart: (e) => {
      const payload = makePayload();
      if (!payload) { e.preventDefault(); return; }
      try {
        e.dataTransfer.setData(TYPE, JSON.stringify(payload));
        e.dataTransfer.setData('text/plain', payload.title || '');
        e.dataTransfer.effectAllowed = 'copyMove';
      } catch { /* the drop just won't find anything */ }
    },
  };
}

export const trackPayload = (track) => ({ kind: 'track', title: track.title, track });
export const tracksPayload = (tracks, title) => ({ kind: 'tracks', title, tracks });

export function itemPayload(item) {
  if (item.kind === 'track') return trackPayload(item);
  if (item.kind === 'album' || item.kind === 'playlist' || item.kind === 'artist') return { kind: item.kind, id: item.id, title: item.title || item.name, item };
  if (item.kind === 'local') return { kind: 'local', id: item.id, title: item.title || item.name };
  if (item.kind === 'liked') return { kind: 'liked', title: item.title };
  return null;
}

const hasMusic = (e) => e.dataTransfer.types.includes(TYPE);

function read(e) {
  try { return JSON.parse(e.dataTransfer.getData(TYPE)); } catch { return null; }
}

export async function tracksOf(payload) {
  switch (payload?.kind) {
    case 'track': return [payload.track];
    case 'tracks': return payload.tracks;
    case 'album': return (await api.album(payload.id)).tracks || [];
    case 'playlist': return (await api.playlist(payload.id)).tracks || [];
    case 'artist': return (await api.artist(payload.id)).songs || [];
    case 'local': return useLibrary.getState().playlists.find((p) => p.id === payload.id)?.tracks || [];
    case 'liked': return useLibrary.getState().liked;
    default: return [];
  }
}

// `land(payload)` runs on a drop; `move` for a reorder within the same list.
export function useDrop(land, { enabled = true, effect = 'copy' } = {}) {
  const [over, setOver] = useState(false);
  if (IS_ANDROID || !enabled) return { over: false, dropProps: {} };
  return {
    over,
    dropProps: {
      onDragOver: (e) => {
        if (!hasMusic(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = effect;
        if (!over) setOver(true);
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOver(false);
      },
      onDrop: (e) => {
        if (!hasMusic(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const payload = read(e);
        if (payload) Promise.resolve(land(payload)).catch((err) => {
          console.warn('[drop]', err);
          toast(tr('옮기지 못했어요. 인터넷 연결을 확인해 주세요.'));
        });
      },
    },
  };
}

const landed = (text) => (tracks) => { if (tracks.length) toast(text(tracks)); return tracks; };

export async function dropOnQueue(payload) {
  const tracks = await tracksOf(payload);
  if (tracks.length) usePlayer.getState().addToQueue(tracks);
}

export async function dropOnPlayer(payload) {
  const tracks = await tracksOf(payload);
  if (tracks.length) usePlayer.getState().playList(tracks, 0, payload.kind === 'track' ? null : { name: payload.title });
}

// Onto "같이 듣기": over to that page, and into its queue. Without a room yet, the music waits for one.
export async function dropOnRoom(payload) {
  useNav.getState().go('room', {});
  const tracks = await tracksOf(payload);
  if (!tracks.length) return;
  const room = useRoom.getState();
  if (!room.code) {
    useRoom.setState({ pendingTracks: tracks });
    toast(tr('방을 만들거나 들어가면 {0}곡을 대기열에 넣을게요', tracks.length));
    return;
  }
  if (!room.attached) await room.follow();
  usePlayer.getState().addToQueue(tracks);
}

export async function dropOnPlaylist(playlist, payload) {
  const tracks = await tracksOf(payload);
  const added = useLibrary.getState().addToPlaylist(playlist.id, tracks);
  toast(added > 0 ? tr('\'{0}\'에 {1}곡을 추가했습니다', playlist.name, added) : tr('\'{0}\'에 이미 있는 곡입니다', playlist.name));
}

export async function dropOnNewPlaylist(payload) {
  const tracks = await tracksOf(payload);
  if (!tracks.length) return;
  const id = useLibrary.getState().createPlaylist(payload.title || tracks[0].title, tracks);
  useNav.getState().go('local', { id });
  toast(tr('새 플레이리스트에 {0}곡을 추가했습니다', tracks.length));
}

export async function dropOnLiked(payload) {
  const tracks = await tracksOf(payload);
  const lib = useLibrary.getState();
  const fresh = tracks.filter((t) => !lib.isLiked(t.id));
  if (!fresh.length) {
    toast(tr('\'좋아요 표시한 곡\'에 이미 있는 곡입니다'));
    return;
  }
  together(tr('좋아요'), () => { for (const track of fresh.reverse()) useLibrary.getState().toggleLike(track); });
  toast(tr('\'좋아요 표시한 곡\'에 {0}곡을 추가했습니다', fresh.length));
}

export async function dropOnDownloads(payload) {
  const tracks = await tracksOf(payload);
  landed((list) => tr('{0}곡을 다운로드합니다', list.length))(tracks);
  if (tracks.length) download(tracks);
}

// Onto the library: an album or artist is saved as itself, a playlist is copied, songs are liked.
export async function dropOnLibrary(payload) {
  const lib = useLibrary.getState();
  if (payload.kind === 'album') {
    if (!lib.savedAlbums.some((a) => a.id === payload.id)) lib.toggleSavedAlbum(payload.item);
    toast(tr('보관함에 저장했습니다'));
  } else if (payload.kind === 'artist') {
    if (!lib.followed.some((a) => a.id === payload.id)) lib.toggleFollow(payload.item);
    toast(tr('팔로우했습니다'));
  } else if (payload.kind === 'playlist') {
    const tracks = await tracksOf(payload);
    lib.createPlaylist(payload.title, tracks, { source: payload.id, thumb: payload.item?.thumb });
    toast(tr('내 플레이리스트로 저장했습니다'));
  } else {
    await dropOnLiked(payload);
  }
}

export async function dropOnSearch(payload) {
  const text = payload.kind === 'track' ? `${payload.track.title} ${payload.track.artists?.[0]?.name || ''}`.trim() : payload.title;
  if (text) useNav.getState().go('search', { q: text });
}
