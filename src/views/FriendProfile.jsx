// What a friend chose to show: what they play, how much they listen, what they like. Anything they keep
// private simply isn't in what they published, so it can't be shown here by mistake.
import { useRef, useState } from 'react';
import { Clock, Copy, Disc3, Headphones, ListMusic, Lock, Mic2, Music2, Pencil, Play, PlusCircle, Tags, UserMinus, Users } from 'lucide-react';
import { Avatar } from '../components/Account.jsx';
import { ErrorMsg, Thumb, useAsync } from '../components/common.jsx';
import TrackList from '../components/TrackList.jsx';
import { useAccount } from '../store/account.js';
import { useFriends } from '../store/friends.js';
import { useLibrary } from '../store/library.js';
import { useNav } from '../store/nav.js';
import { usePlayer } from '../store/player.js';
import { loadFriendView } from '../store/profile.js';
import { useRoom } from '../store/room.js';
import { toast, useUI } from '../store/ui.js';
import { api } from '../lib/api.js';
import { safeTrack } from '../lib/safeTrack.js';
import { useEnter } from '../lib/motion.js';
import { artistNames } from '../lib/util.js';
import { tr } from '../lib/i18n.js';

const hoursAndMinutes = (minutes) => (minutes >= 60 ? tr('{0}시간 {1}분', Math.floor(minutes / 60), minutes % 60) : tr('{0}분', minutes));
const listOf = (value) => (Array.isArray(value) ? value : Object.values(value || {}));

function Nothing({ hidden }) {
  return hidden ? <p className="fp-private"><Lock size={13} />{' '}{tr('공개하지 않았어요')}</p> : <p className="fp-private">{tr('아직 보여줄 내용이 없어요')}</p>;
}

function PublicPlaylist({ list, owner }) {
  const [open, setOpen] = useState(false);
  const tracks = listOf(list.tracks).map(safeTrack).filter(Boolean);
  const context = { name: list.name };
  const copy = () => {
    useLibrary.getState().createPlaylist(list.name, tracks);
    toast(tr('내 플레이리스트로 저장했습니다'));
  };
  return (
    <li className={`fp-playlist ${open ? 'open' : ''}`}>
      <div className="fp-playlist-head" onClick={() => setOpen(!open)}>
        <Thumb src={tracks[0]?.thumb} className="fp-playlist-art" />
        <div className="fp-playlist-text">
          <b title={list.name}>{list.name}</b>
          <small>{tr('{0}곡', list.count)}</small>
        </div>
        <button className="icon-btn" title={tr('재생')} disabled={!tracks.length} onClick={(e) => { e.stopPropagation(); usePlayer.getState().playList(tracks, 0, context); }}><Play size={17} fill="currentColor" /></button>
        <button className="icon-btn" title={tr('내 보관함에 복사')} disabled={!tracks.length} onClick={(e) => { e.stopPropagation(); copy(); }}><PlusCircle size={18} /></button>
      </div>
      {open && <TrackList tracks={tracks} context={{ name: tr('{0}님의 {1}', owner, list.name) }} showAlbum={false} compact animate={false} />}
    </li>
  );
}

export default function FriendProfile({ uid }) {
  const me = useAccount((s) => s.user);
  const friend = useFriends((s) => s.friends[uid]);
  const friendCode = useFriends((s) => s.friendCode);
  const inMyRoom = useRoom((s) => Boolean(s.members[uid]));
  const { inviteFriend, removeFriend } = useFriends.getState();
  const go = useNav((s) => s.go);
  const isMe = uid === me?.uid;
  const person = isMe ? me : friend;
  const res = useAsync(() => loadFriendView(uid), [uid]);
  const ref = useRef(null);
  useEnter(ref, [res.data ? 1 : 0], { step: 40 });

  if (!person) return <ErrorMsg error={tr('친구 목록에 없는 사람이에요.')} />;

  const view = res.data || {};
  const topTracks = listOf(view.topTracks).map(safeTrack).filter(Boolean);
  const minutesOf = Object.fromEntries(listOf(view.topTracks).map((t) => [t.id, t.minutes]));
  const artists = listOf(view.artists);
  const genres = listOf(view.genres);
  const playlists = listOf(view.playlists);
  const time = view.time;
  const hidden = listOf(view.hidden);
  const name = person.name || '...';
  const status = isMe ? null : !friend.online ? tr('오프라인') : friend.track ? (friend.playing ? tr('듣는 중') : tr('일시정지')) : tr('온라인');

  const confirmRemove = () => useUI.getState().prompt({
    title: tr('{0}님을 친구에서 삭제할까요?', name),
    message: tr('서로의 친구 목록에서 사라지고, 다시 친구 요청을 보내야 해요.'),
    submitLabel: tr('삭제'),
    onSubmit: () => { removeFriend(uid); go('friends', {}); },
  });

  return (
    <div className="page friend-profile" ref={ref}>
      <section className="fp-hero" data-enter>
        <span className="fp-avatar">
          <Avatar user={person} size={96} />
          {!isMe && <i className={`room-dot ${friend.online ? 'on' : ''}`} />}
        </span>
        <div className="fp-title">
          <span className="fp-kicker">{isMe ? tr('친구에게 이렇게 보여요') : tr('친구')}</span>
          <h1 title={name}>{name}</h1>
          {view.bio && <p className="fp-bio">{view.bio}</p>}
          {status && <small className={friend.online ? 'on' : ''}>{status}</small>}
        </div>
        <div className="fp-actions">
          {isMe ? (
            <>
              <button className="btn" onClick={() => go('settings')}><Pencil size={15} />{' '}{tr('프로필 편집')}</button>
              {friendCode && <button className="btn" onClick={async () => { await api.copyText(friendCode); toast(tr('친구 코드를 복사했습니다')); }}><Copy size={15} />{' '}{tr('친구 코드 복사')}</button>}
            </>
          ) : (
            <>
              {inMyRoom
                ? <span className="room-badge fp-together"><Headphones size={13} />{' '}{tr('같은 방에 있어요')}</span>
                : <button className="btn-primary" onClick={() => inviteFriend(uid)}><Headphones size={15} />{' '}{tr('같이 듣기 초대')}</button>}
              <button className="btn" onClick={confirmRemove}><UserMinus size={15} />{' '}{tr('친구 삭제')}</button>
            </>
          )}
        </div>
      </section>

      {!isMe && friend.track && (
        <button className="fp-now" data-enter onClick={() => usePlayer.getState().playList([friend.track], 0, { name: tr('{0}님이 듣는 곡', name) })} title={tr('이 곡 재생')}>
          <Thumb src={friend.track.thumb} />
          <span>
            <small><Music2 size={12} />{' '}{friend.playing ? tr('지금 듣는 곡') : tr('일시정지한 곡')}</small>
            <b>{friend.track.title}</b>
            <small>{artistNames(friend.track)}</small>
          </span>
        </button>
      )}

      {res.error && <ErrorMsg error={res.error} onRetry={res.retry} />}

      {!res.loading && !res.error && (
        <div className="fp-grid">
          <section className="room-card" data-enter>
            <h3><Clock size={16} />{' '}{tr('청취 시간')}</h3>
            {time ? (
              <div className="fp-stats">
                <div><b>{hoursAndMinutes(time.week || 0)}</b><span>{tr('이번 주')}</span></div>
                <div><b>{hoursAndMinutes(time.month || 0)}</b><span>{tr('최근 30일')}</span></div>
                <div><b>{hoursAndMinutes(time.total || 0)}</b><span>{tr('최근 60일')}</span></div>
              </div>
            ) : <Nothing hidden={hidden.includes('time')} />}
          </section>

          <section className="room-card" data-enter>
            <h3><Tags size={16} />{' '}{tr('좋아하는 장르')}</h3>
            {genres.length ? <div className="fp-genres">{genres.map((g) => <span key={g} className="fp-genre">{g}</span>)}</div> : <Nothing hidden={hidden.includes('genres')} />}
          </section>

          <section className="room-card fp-wide" data-enter>
            <h3><Mic2 size={16} />{' '}{tr('자주 듣는 아티스트')}</h3>
            {artists.length ? (
              <ol className="fp-artists">
                {artists.map((a) => (
                  <li key={a.name}>
                    <button onClick={() => go('search', { q: a.name })} title={tr('\'{0}\' 검색', a.name)}>{a.name}</button>
                    <small>{hoursAndMinutes(a.minutes || 0)}</small>
                  </li>
                ))}
              </ol>
            ) : <Nothing hidden={hidden.includes('artists')} />}
          </section>

          <section className="room-card fp-wide" data-enter>
            <h3><Disc3 size={16} />{' '}{tr('자주 듣는 곡')}{' '}<small>{tr('최근 30일')}</small></h3>
            {topTracks.length ? (
              <TrackList tracks={topTracks.map((t) => ({ ...t, duration: 0, minutes: minutesOf[t.id] }))} context={{ name: tr('{0}님이 자주 듣는 곡', name) }} showAlbum={false} compact animate={false} />
            ) : <Nothing hidden={hidden.includes('topTracks')} />}
          </section>

          <section className="room-card fp-wide" data-enter>
            <h3><ListMusic size={16} />{' '}{tr('공개 플레이리스트')}</h3>
            {playlists.length ? <ul className="fp-playlists">{playlists.map((p) => <PublicPlaylist key={p.name} list={p} owner={name} />)}</ul> : <Nothing hidden={hidden.includes('playlists')} />}
          </section>
        </div>
      )}
      {!isMe && <p className="fp-note" data-enter><Users size={13} />{' '}{tr('친구가 설정에서 공개한 내용만 보여요.')}</p>}
    </div>
  );
}
