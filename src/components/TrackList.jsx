import { useRef, useState } from 'react';
import { Heart, Clock3, ListPlus, ListEnd, Disc3, User, Plus, Trash2, Radio, ArrowDownToLine, Play, MoreHorizontal, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, GripVertical } from 'lucide-react';
import { usePlayer } from '../store/player.js';
import { useLibrary } from '../store/library.js';
import { useNav } from '../store/nav.js';
import { useUI, toast } from '../store/ui.js';
import { useDownloads, download, removeDownload } from '../store/downloads.js';
import { api } from '../lib/api.js';
import { fmtTime } from '../lib/util.js';
import { burst, useEnter } from '../lib/motion.js';
import { Thumb, ArtistLinks, Equalizer } from './common.jsx';
import DownloadButton from './DownloadButton.jsx';

export async function startRadio(track) {
  try {
    const more = await api.related(track.id);
    usePlayer.getState().playList([track, ...more], 0, { name: `${track.title} 라디오` });
  } catch {
    toast('라디오를 시작할 수 없습니다');
  }
}

export function trackMenuItems(track, extra = []) {
  const p = usePlayer.getState();
  const lib = useLibrary.getState();
  const nav = useNav.getState();
  const liked = lib.isLiked(track.id);
  const downloaded = useDownloads.getState().done.has(track.id);
  const artist = track.artists?.find((a) => a.id);
  return [
    { label: '다음에 재생', icon: ListPlus, onClick: () => p.playNext(track) },
    { label: '대기열에 추가', icon: ListEnd, onClick: () => p.addToQueue(track) },
    { label: '이 곡으로 라디오 시작', icon: Radio, onClick: () => startRadio(track) },
    { divider: true },
    {
      label: '플레이리스트에 추가', icon: Plus,
      submenu: [
        {
          label: '새 플레이리스트',
          icon: Plus,
          onClick: () => {
            lib.createPlaylist(track.title, [track]);
            toast('새 플레이리스트를 만들었습니다');
          },
        },
        ...lib.playlists.map((pl) => ({
          label: pl.name,
          onClick: () => {
            const added = lib.addToPlaylist(pl.id, track);
            if (added > 0) {
              toast(`'${pl.name}'에 추가했습니다`);
            } else {
              toast(`'${pl.name}'에 이미 있는 곡입니다`);
            }
          },
        })),
      ],
    },
    { label: liked ? '좋아요 취소' : '좋아요', icon: Heart, onClick: () => lib.toggleLike(track) },
    downloaded
      ? { label: '다운로드 삭제', icon: Trash2, onClick: () => removeDownload(track.id) }
      : { label: '다운로드', icon: ArrowDownToLine, onClick: () => download(track) },
    lib.recent.some((t) => t.id === track.id) && {
      label: '최근 들은 곡에서 삭제',
      icon: Trash2,
      onClick: () => {
        lib.removeRecent(track.id);
        toast('최근 들은 곡에서 삭제했습니다');
      },
    },
    { divider: true },
    artist && { label: '아티스트로 이동', icon: User, onClick: () => nav.go('artist', { id: artist.id }) },
    track.album?.id && { label: '앨범으로 이동', icon: Disc3, onClick: () => nav.go('album', { id: track.album.id }) },
    ...extra,
  ].filter(Boolean);
}

export function LikeButton({ track, size = 16, className = '' }) {
  const liked = useLibrary((s) => s.liked.some((t) => t.id === track.id));
  const toggle = useLibrary((s) => s.toggleLike);
  const ref = useRef(null);
  return (
    <button
      ref={ref}
      className={`icon-btn like ${liked ? 'on' : ''} ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!liked) burst(ref.current);
        toggle(track);
        toast(liked ? '좋아요 표시한 곡에서 삭제했습니다' : '좋아요 표시한 곡에 추가했습니다');
      }}
      aria-label="좋아요"
    >
      <Heart size={size} fill={liked ? 'currentColor' : 'none'} />
    </button>
  );
}

export default function TrackList({ tracks, context, showAlbum = true, showThumb = true, numbered = true, onRemove, onReorder, compact, animate = true, playSingle = false }) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id);
  const playing = usePlayer((s) => s.playing);
  const playList = usePlayer((s) => s.playList);
  const openMenu = useUI((s) => s.openMenu);
  const go = useNav((s) => s.go);
  const ref = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  useEnter(ref, [animate ? tracks.length : 0], { step: 18, delay: 20 });

  const hasAlbum = showAlbum && !compact;

  const play = (i) => {
    if (tracks[i].id === currentId) {
      usePlayer.getState().toggle();
    } else if (playSingle) {
      playList([tracks[i]], 0, context);
    } else {
      playList(tracks, i, context);
    }
  };

  return (
    <div ref={ref} className={`tracklist ${compact ? 'compact' : ''} ${hasAlbum ? '' : 'no-album'}`}>
      {!compact && (
        <div className="tl-head">
          <span className="c-num">{onReorder ? <GripVertical size={14} title="드래그하여 순서 변경" /> : '#'}</span>
          <span>제목</span>
          {hasAlbum && <span className="c-album">앨범</span>}
          <span className="c-dur"><Clock3 size={15} /></span>
        </div>
      )}
      {tracks.map((t, i) => {
        const isCur = t.id === currentId;
        const reorderMenu = onReorder
          ? [
              { divider: true },
              i > 0 && { label: '위로 이동', icon: ChevronUp, onClick: () => onReorder(i, i - 1) },
              i < tracks.length - 1 && { label: '아래로 이동', icon: ChevronDown, onClick: () => onReorder(i, i + 1) },
              i > 0 && { label: '맨 위로 이동', icon: ChevronsUp, onClick: () => onReorder(i, 0) },
              i < tracks.length - 1 && { label: '맨 아래로 이동', icon: ChevronsDown, onClick: () => onReorder(i, tracks.length - 1) },
            ].filter(Boolean)
          : [];
        const extra = [
          ...(onRemove ? [{ divider: true }, { label: '이 플레이리스트에서 삭제', icon: Trash2, onClick: () => onRemove(i) }] : []),
          ...reorderMenu,
        ];
        return (
          <div
            key={t.id + ':' + i}
            data-enter={animate && i < 30 ? '' : undefined}
            className={`tl-row ${isCur ? 'current' : ''} ${onReorder ? 'reorderable' : ''} ${dragOverIdx === i ? 'drag-over' : ''}`}
            draggable={true}
            onDragStart={(e) => {
              try {
                e.dataTransfer.setData('application/json', JSON.stringify(t));
                e.dataTransfer.setData('text/plain', t.id);
                e.dataTransfer.effectAllowed = onReorder ? 'copyMove' : 'copy';
                if (onReorder) {
                  e.dataTransfer.setData('text/reorder-from', String(i));
                }
              } catch {}
            }}
            onDragOver={(e) => {
              if (onReorder) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverIdx !== i) setDragOverIdx(i);
              }
            }}
            onDragLeave={() => {
              if (dragOverIdx === i) setDragOverIdx(null);
            }}
            onDrop={(e) => {
              if (onReorder) {
                e.preventDefault();
                setDragOverIdx(null);
                const reorderFrom = e.dataTransfer.getData('text/reorder-from') || e.dataTransfer.getData('text/plain');
                const from = parseInt(reorderFrom, 10);
                if (!isNaN(from) && from !== i) onReorder(from, i);
              }
            }}
            onDoubleClick={() => play(i)}
            onMouseEnter={() => api.prefetch(t.id)}
            onContextMenu={(e) => openMenu(e, trackMenuItems(t, extra))}
          >
            <span className="c-num">
              {onReorder && <GripVertical size={13} className="drag-handle" title="끌어서 순서 변경" />}
              {numbered ? <span className="num">{isCur ? <Equalizer playing={playing} /> : i + 1}</span> : isCur && <span className="num"><Equalizer playing={playing} /></span>}
              <button className="row-play" onClick={() => play(i)} aria-label="재생">
                {isCur && playing ? <span className="pause-glyph" /> : <Play size={14} fill="currentColor" />}
              </button>
            </span>
            <span className="c-title">
              {showThumb && <Thumb src={t.thumb} className="tl-thumb" />}
              <span className="tl-text">
                <span className="tl-name">{t.title}</span>
                <ArtistLinks artists={t.artists} className="tl-artist" />
              </span>
            </span>
            {hasAlbum && (
              <span className="c-album">
                {t.album?.id ? <a onClick={() => go('album', { id: t.album.id })}>{t.album.name}</a> : t.album?.name || ''}
              </span>
            )}
            <span className="c-dur">
              <LikeButton track={t} className="hover-show" />
              <DownloadButton track={t} className="hover-show" size={16} />
              <span className="dur">{fmtTime(t.duration)}</span>
              <button className="icon-btn hover-show" onClick={(e) => openMenu(e, trackMenuItems(t, extra))} aria-label="더 보기"><MoreHorizontal size={18} /></button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
