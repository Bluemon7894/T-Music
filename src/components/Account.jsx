import { useEffect, useRef, useState } from 'react';
import { CloudCheck, CloudOff, Copy, Eye, ImagePlus, Library, LogIn, LogOut, Plus, RefreshCw, Settings, Trash2, UserRound, Users, X } from 'lucide-react';
import { useAccount } from '../store/account.js';
import { useFriends } from '../store/friends.js';
import { GENRE_CHOICES, MAX_GENRE_LENGTH, MAX_GENRES, useProfile } from '../store/profile.js';
import { useNav } from '../store/nav.js';
import { useUpdater } from '../store/updater.js';
import { toast, useUI } from '../store/ui.js';
import { api } from '../lib/api.js';
import { photoFromFile } from '../lib/photo.js';
import { useSync } from '../lib/librarySync.js';
import { GoogleMark } from '../views/Login.jsx';
import { THIS_DEVICE } from '../lib/platform.js';
import { tr } from '../lib/i18n.js';

export function Avatar({ user, size = 34 }) {
  const [failed, setFailed] = useState(false);
  if (user?.photo && !failed) {
    return <img className="avatar" style={{ width: size, height: size }} src={user.photo} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} />;
  }
  return <span className="avatar fallback" style={{ width: size, height: size }}><UserRound size={size * 0.55} /></span>;
}

async function connectGoogle() {
  await useAccount.getState().signInWithGoogle();
  const { error } = useAccount.getState();
  if (error) toast(error);
}

function confirmSignOut(user) {
  const signOut = () => useAccount.getState().signOut();
  if (!user.isGuest) {
    signOut();
    return;
  }
  useUI.getState().prompt({
    title: tr('게스트 계정에서 로그아웃할까요?'),
    message: tr('게스트 계정은 다시 로그인할 수 없어서 로그아웃하면 삭제돼요. 보관함과 청취 기록, 친구 목록이 모두 사라지고, 친구들의 목록에서도 빠지며, 들어가 있는 방에서도 나가게 돼요. Google 계정을 연결하면 이 모든 것을 그대로 가져갈 수 있어요.'),
    submitLabel: tr('삭제하고 로그아웃'),
    onSubmit: signOut,
    altLabel: tr('Google 계정 연결'),
    onAlt: connectGoogle,
  });
}

function confirmDelete(user) {
  useUI.getState().prompt({
    title: tr('계정을 삭제할까요?'),
    message: user.isGuest
      ? tr('이 계정의 플레이리스트, 좋아요, 청취 기록이 모두 삭제되고 되돌릴 수 없습니다.')
      : tr('이 계정의 플레이리스트, 좋아요, 청취 기록이 모두 삭제되고 되돌릴 수 없습니다. 확인을 위해 브라우저에서 구글 로그인을 한 번 더 진행합니다.'),
    submitLabel: tr('계정 삭제'),
    onSubmit: async () => {
      await useAccount.getState().deleteAccount();
      const { error } = useAccount.getState();
      if (error) toast(error);
    },
  });
}

const SYNC_LABEL = {
  syncing: { icon: RefreshCw, text: tr('계정과 동기화하는 중'), className: 'spin' },
  synced: { icon: CloudCheck, text: tr('계정에 저장됨') },
  error: { icon: CloudOff, text: tr('동기화 실패 ({0}에는 저장됨)', THIS_DEVICE) },
};

function SyncStatus() {
  const state = useSync((s) => s.state);
  const label = SYNC_LABEL[state];
  if (!label) return null;
  const Icon = label.icon;
  return <small className={`account-sync ${state}`}><Icon size={13} className={label.className} /> {label.text}</small>;
}

export function AccountButton() {
  const user = useAccount((s) => s.user);
  const openMenu = useUI((s) => s.openMenu);

  const friendCode = useFriends((s) => s.friendCode);
  const { go } = useNav.getState();
  const items = user
    ? [
      {
        header: (
          <>
            <Avatar user={user} size={40} />
            <span className="ctx-header-text">
              <b title={user.name}>{user.name}</b>
              <small title={user.email || ''}>{user.isGuest ? tr('게스트 번호 #{0}', user.tag) : user.email}</small>
            </span>
          </>
        ),
      },
      { divider: true },
      { label: tr('내 프로필 보기'), icon: Eye, onClick: () => go('friend', { uid: user.uid }) },
      { label: tr('프로필 및 계정 설정'), icon: Settings, onClick: () => go('settings') },
      ...(friendCode ? [{ label: tr('친구 코드 복사 ({0})', friendCode), icon: Copy, onClick: async () => { await api.copyText(friendCode); toast(tr('친구 코드를 복사했습니다')); } }] : []),
      { label: tr('친구'), icon: Users, onClick: () => go('friends', {}) },
      { label: tr('보관함'), icon: Library, onClick: () => go('library', {}) },
      { label: tr('업데이트 확인'), icon: RefreshCw, onClick: () => useUpdater.getState().check(false) },
      { divider: true },
      ...(user.isGuest ? [{ label: tr('Google 계정 연결'), icon: LogIn, onClick: connectGoogle }] : []),
      { label: tr('로그아웃'), icon: LogOut, onClick: () => confirmSignOut(user) },
    ]
    : [{ label: tr('로그인'), icon: LogIn, onClick: () => useAccount.getState().leaveOffline() }];

  return (
    <button className="account-btn" onClick={(e) => openMenu(e, items)} title={user?.name || tr('로그인')} aria-label={tr('계정')}>
      <Avatar user={user} size={34} />
    </button>
  );
}

const DETAIL_ROWS = [
  { key: 'playlists', title: tr('공개 플레이리스트'), text: tr('플레이리스트 화면에서 공개를 끈 것은 빼고 보여요.') },
  { key: 'topTracks', title: tr('자주 듣는 곡'), text: tr('최근 30일 동안 오래 들은 곡을 보여요.') },
  { key: 'artists', title: tr('자주 듣는 아티스트'), text: tr('최근 30일 동안 오래 들은 아티스트를 보여요.') },
  { key: 'time', title: tr('청취 시간'), text: tr('이번 주와 최근 30일, 60일 청취 시간을 보여요.') },
  { key: 'genres', title: tr('좋아하는 장르'), text: tr('직접 고른 장르와 듣는 음악에서 찾은 장르를 보여요.') },
];

export function FriendPrivacyCard() {
  const user = useAccount((s) => s.user);
  const sharing = useFriends((s) => s.sharing);
  const setSharing = useFriends((s) => s.setSharing);
  if (!user) return null;
  return (
    <section className="set-card" data-enter>
      <h2><UserRound size={18} />{' '}{tr('친구에게 보이는 내 정보')}</h2>
      <p className="muted">{tr('친구에게만 보여요. 친구가 아닌 사람은 볼 수 없어요. 끄면 친구 화면에서 바로 사라져요.')}</p>
      <div className="set-item" onClick={() => setSharing({ online: !sharing.online })}>
        <div className="set-item-text">
          <span className="set-item-title">{tr('온라인 상태 표시')}</span>
          <span className="muted small">{tr('끄면 친구에게 오프라인으로 보이고, 듣는 곡도 보이지 않아요.')}</span>
        </div>
        <div className={`switch ${sharing.online ? 'on' : ''}`} />
      </div>
      <div className={`set-item ${sharing.online ? '' : 'disabled'}`} onClick={() => sharing.online && setSharing({ track: !sharing.track })}>
        <div className="set-item-text">
          <span className="set-item-title">{tr('듣고 있는 곡 표시')}</span>
          <span className="muted small">{tr('끄면 온라인으로만 보이고 무슨 곡을 듣는지는 보이지 않아요.')}</span>
        </div>
        <div className={`switch ${sharing.online && sharing.track ? 'on' : ''}`} />
      </div>
      {DETAIL_ROWS.map(({ key, title, text }) => (
        <div key={key} className="set-item" onClick={() => setSharing({ [key]: !sharing[key] })}>
          <div className="set-item-text">
            <span className="set-item-title">{title}</span>
            <span className="muted small">{text}</span>
          </div>
          <div className={`switch ${sharing[key] ? 'on' : ''}`} />
        </div>
      ))}
    </section>
  );
}

const MAX_SUGGESTIONS = 6;
// Taken apart into letters, so 바 already finds 발라드 while it's still being typed.
const forSearch = (text) => text.normalize('NFKD').toLowerCase().replace(/\s+/g, '');

function GenreField({ genres, onSave }) {
  const [typed, setTyped] = useState('');
  const wanted = forSearch(typed);
  const suggestions = wanted ? GENRE_CHOICES.filter((g) => !genres.includes(g) && forSearch(g).includes(wanted)).slice(0, MAX_SUGGESTIONS) : [];
  const add = (text) => {
    const genre = text.trim().slice(0, MAX_GENRE_LENGTH);
    setTyped('');
    if (!genre || genres.some((g) => g.toLowerCase() === genre.toLowerCase())) return;
    if (genres.length < MAX_GENRES) onSave([...genres, genre]);
    else toast(tr('장르는 {0}개까지 고를 수 있어요', MAX_GENRES));
  };
  return (
    <div className="profile-field">
      <span>{tr('좋아하는 장르')}</span>
      {genres.length > 0 && (
        <div className="profile-genres">
          {genres.map((genre) => (
            <button key={genre} className="chip on" title={tr('빼기')} onClick={() => onSave(genres.filter((g) => g !== genre))}>{genre}<X size={13} /></button>
          ))}
        </div>
      )}
      <div className="profile-genre-add">
        <input
          value={typed}
          maxLength={MAX_GENRE_LENGTH}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(typed); }}
          placeholder={tr('장르를 입력해 보세요')}
          aria-label={tr('장르 추가')}
        />
        <button className="btn" disabled={!typed.trim()} title={tr('장르 추가')} aria-label={tr('장르 추가')} onClick={() => add(typed)}><Plus size={16} /></button>
      </div>
      {suggestions.length > 0 && (
        <div className="profile-genres profile-suggest">
          {suggestions.map((genre) => <button key={genre} className="chip" onClick={() => add(genre)}><Plus size={13} />{genre}</button>)}
        </div>
      )}
    </div>
  );
}

// A name, a picture, and the genres you'd say you like.
function ProfileEditor({ user }) {
  const genres = useProfile((s) => s.genres);
  const sharing = useFriends((s) => s.sharing);
  const { setDisplay } = useAccount.getState();
  const { save } = useProfile.getState();
  const [name, setName] = useState(user.name);
  useEffect(() => setName(user.name), [user.name]);

  const commitName = () => {
    const clean = name.trim();
    if (clean === user.name) return;
    setDisplay({ name: clean }).catch(() => toast(tr('저장하지 못했습니다')));
  };
  const setPhoto = (photo) => setDisplay({ photo }).catch(() => toast(tr('저장하지 못했습니다')));
  const picker = useRef(null);
  const uploaded = String(user.photo || '').startsWith('data:');
  const pickedFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setPhoto(await photoFromFile(file));
    } catch (err) {
      console.warn('[profile]', err);
      toast(tr('이 사진은 쓸 수 없어요. 다른 사진을 골라 주세요.'));
    }
  };

  return (
    <div className="profile-edit">
      <label className="profile-field">
        <span>{tr('보여질 이름')}</span>
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} placeholder={user.googleName || tr('게스트 {0}', user.tag)} />
        <small className="muted">{user.isGuest ? tr('비워 두면 게스트 번호로 보여요. 내 번호는 #{0}이에요.', user.tag) : tr('비워 두면 Google 이름으로 보여요.')}</small>
      </label>
      <div className="profile-field">
        <span>{tr('프로필 사진')}</span>
        <input ref={picker} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickedFile} />
        <div className="profile-photos">
          <button className="profile-photo profile-photo-add" onClick={() => picker.current.click()} title={tr('내 사진 올리기')} aria-label={tr('내 사진 올리기')}><ImagePlus size={20} /></button>
          {uploaded && <span className="profile-photo on" title={tr('내가 올린 사진')}><img src={user.photo} alt="" /></span>}
          <button className={`profile-photo ${!user.photo ? 'on' : ''}`} onClick={() => setPhoto(null)} title={tr('기본 사진')}><UserRound size={20} /></button>
          {user.googlePhoto && <button className={`profile-photo ${user.photo === user.googlePhoto ? 'on' : ''}`} onClick={() => setPhoto(user.googlePhoto)} title={tr('Google 사진')}><img src={user.googlePhoto} alt="" referrerPolicy="no-referrer" /></button>}
        </div>
      </div>
      <GenreField genres={genres} onSave={(next) => save({ genres: next }, sharing)} />
    </div>
  );
}

export function AccountCard() {
  const user = useAccount((s) => s.user);
  const busy = useAccount((s) => s.busy);
  const { cancelGoogle, leaveOffline } = useAccount.getState();

  return (
    <section className="set-card" data-enter>
      <h2><UserRound size={18} />{' '}{tr('계정')}</h2>
      <div className="account-row">
        <Avatar user={user} size={52} />
        <div className="account-text">
          <b>{user ? user.name : tr('오프라인')}</b>
          <small>{!user ? tr('로그인하지 않았어요') : user.isGuest ? tr('게스트 번호 #{0} · {1}에서만 사용', user.tag, THIS_DEVICE) : user.email}</small>
          <SyncStatus />
        </div>
      </div>
      {user && <ProfileEditor user={user} />}
      <div className="row-actions">
        {!user && <button className="btn" onClick={leaveOffline}><LogIn size={15} />{' '}{tr('로그인')}</button>}
        {user?.isGuest && busy !== 'google' && <button className="btn" onClick={connectGoogle}><GoogleMark size={15} />{' '}{tr('Google 계정 연결')}</button>}
        {busy === 'google' && <button className="btn" onClick={cancelGoogle}>{tr('브라우저 로그인 취소')}</button>}
        {user && <button className="btn" onClick={() => confirmSignOut(user)}><LogOut size={15} />{' '}{tr('로그아웃')}</button>}
        {user && <button className="btn" onClick={() => useNav.getState().go('friend', { uid: user.uid })}><Eye size={15} />{' '}{tr('내 프로필 보기')}</button>}
        {user && <button className="btn" onClick={() => confirmDelete(user)}><Trash2 size={15} />{' '}{tr('계정 삭제')}</button>}
      </div>
    </section>
  );
}
