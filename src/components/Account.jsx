import { useState } from 'react';
import { CloudCheck, CloudOff, LogIn, LogOut, RefreshCw, Trash2, UserRound } from 'lucide-react';
import { useAccount } from '../store/account.js';
import { useFriends } from '../store/friends.js';
import { toast, useUI } from '../store/ui.js';
import { useSync } from '../lib/librarySync.js';
import { GoogleMark } from '../views/Login.jsx';

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
    title: '게스트 계정에서 로그아웃할까요?',
    message: '구글 계정을 연결하지 않으면 이 계정의 기록이 모두 사라지고 되돌릴 수 없습니다.',
    submitLabel: '로그아웃',
    onSubmit: signOut,
  });
}

function confirmDelete(user) {
  useUI.getState().prompt({
    title: '계정을 삭제할까요?',
    message: user.isGuest
      ? '이 계정의 플레이리스트, 좋아요, 청취 기록이 모두 삭제되고 되돌릴 수 없습니다.'
      : '이 계정의 플레이리스트, 좋아요, 청취 기록이 모두 삭제되고 되돌릴 수 없습니다. 확인을 위해 브라우저에서 구글 로그인을 한 번 더 진행합니다.',
    submitLabel: '계정 삭제',
    onSubmit: async () => {
      await useAccount.getState().deleteAccount();
      const { error } = useAccount.getState();
      if (error) toast(error);
    },
  });
}

const SYNC_LABEL = {
  syncing: { icon: RefreshCw, text: '계정과 동기화하는 중', className: 'spin' },
  synced: { icon: CloudCheck, text: '계정에 저장됨' },
  error: { icon: CloudOff, text: '동기화 실패 (이 PC에는 저장됨)' },
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

  const items = user
    ? [
      ...(user.isGuest ? [{ label: 'Google 계정 연결', icon: LogIn, onClick: connectGoogle }] : []),
      { label: '로그아웃', icon: LogOut, onClick: () => confirmSignOut(user) },
    ]
    : [{ label: '로그인', icon: LogIn, onClick: () => useAccount.getState().leaveOffline() }];

  return (
    <button className="account-btn" onClick={(e) => openMenu(e, items)} title={user?.name || '로그인'} aria-label="계정">
      <Avatar user={user} size={34} />
    </button>
  );
}

export function FriendPrivacyCard() {
  const user = useAccount((s) => s.user);
  const sharing = useFriends((s) => s.sharing);
  const setSharing = useFriends((s) => s.setSharing);
  if (!user) return null;
  return (
    <section className="set-card" data-enter>
      <h2><UserRound size={18} /> 친구에게 보이는 내 정보</h2>
      <p className="muted">친구에게만 보여요. 친구가 아닌 사람은 볼 수 없어요.</p>
      <div className="set-item" onClick={() => setSharing({ online: !sharing.online })}>
        <div className="set-item-text">
          <span className="set-item-title">온라인 상태 표시</span>
          <span className="muted small">끄면 친구에게 오프라인으로 보이고, 듣는 곡도 보이지 않아요.</span>
        </div>
        <div className={`switch ${sharing.online ? 'on' : ''}`} />
      </div>
      <div className={`set-item ${sharing.online ? '' : 'disabled'}`} onClick={() => sharing.online && setSharing({ track: !sharing.track })}>
        <div className="set-item-text">
          <span className="set-item-title">듣고 있는 곡 표시</span>
          <span className="muted small">끄면 온라인으로만 보이고 무슨 곡을 듣는지는 보이지 않아요.</span>
        </div>
        <div className={`switch ${sharing.online && sharing.track ? 'on' : ''}`} />
      </div>
    </section>
  );
}

export function AccountCard() {
  const user = useAccount((s) => s.user);
  const busy = useAccount((s) => s.busy);
  const { cancelGoogle, leaveOffline } = useAccount.getState();

  return (
    <section className="set-card" data-enter>
      <h2><UserRound size={18} /> 계정</h2>
      <div className="account-row">
        <Avatar user={user} size={52} />
        <div className="account-text">
          <b>{user ? user.name : '오프라인'}</b>
          <small>{!user ? '로그인하지 않았어요' : user.isGuest ? '게스트 계정 (이 PC에서만 사용)' : user.email}</small>
          <SyncStatus />
        </div>
      </div>
      <div className="row-actions">
        {!user && <button className="btn" onClick={leaveOffline}><LogIn size={15} /> 로그인</button>}
        {user?.isGuest && busy !== 'google' && <button className="btn" onClick={connectGoogle}><GoogleMark size={15} /> Google 계정 연결</button>}
        {busy === 'google' && <button className="btn" onClick={cancelGoogle}>브라우저 로그인 취소</button>}
        {user && <button className="btn" onClick={() => confirmSignOut(user)}><LogOut size={15} /> 로그아웃</button>}
        {user && <button className="btn" onClick={() => confirmDelete(user)}><Trash2 size={15} /> 계정 삭제</button>}
      </div>
    </section>
  );
}
