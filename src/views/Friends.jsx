import { useRef, useState } from 'react';
import { Check, Copy, Headphones, MoreHorizontal, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { Avatar } from '../components/Account.jsx';
import { Empty, Thumb } from '../components/common.jsx';
import { useAccount } from '../store/account.js';
import { normalizeFriendCode, useFriends } from '../store/friends.js';
import { usePlayer } from '../store/player.js';
import { toast, useUI } from '../store/ui.js';
import { api } from '../lib/api.js';
import { useEnter } from '../lib/motion.js';
import { artistNames } from '../lib/util.js';
import { tr } from '../lib/i18n.js';

function statusOf(friend) {
  if (!friend.online) return tr('오프라인');
  if (!friend.track) return tr('온라인');
  return friend.playing ? tr('듣는 중') : tr('일시정지');
}

function FriendRow({ uid, friend }) {
  const { inviteFriend, removeFriend } = useFriends.getState();
  const openMenu = useUI((s) => s.openMenu);
  const prompt = useUI((s) => s.prompt);
  const [inviting, setInviting] = useState(false);

  const invite = async () => {
    setInviting(true);
    try { await inviteFriend(uid); } finally { setInviting(false); }
  };
  const confirmRemove = () => prompt({
    title: tr('{0}님을 친구에서 삭제할까요?', friend.name),
    message: tr('서로의 친구 목록에서 사라지고, 다시 친구 요청을 보내야 해요.'),
    submitLabel: tr('삭제'),
    onSubmit: () => removeFriend(uid),
  });

  return (
    <li className={`friend-row ${friend.online ? 'online' : ''}`}>
      <span className="friend-avatar">
        <Avatar user={friend} size={44} />
        <i className={`room-dot ${friend.online ? 'on' : ''}`} />
      </span>
      <div className="friend-text">
        <b>{friend.name || '...'}</b>
        <small>{statusOf(friend)}</small>
      </div>
      {friend.track && (
        <button className="friend-track" onClick={() => usePlayer.getState().playList([friend.track], 0, { name: tr('{0}님이 듣는 곡', friend.name) })} title={tr('이 곡 재생')}>
          <Thumb src={friend.track.thumb} />
          <span>
            <b>{friend.track.title}</b>
            <small>{artistNames(friend.track)}</small>
          </span>
        </button>
      )}
      <div className="friend-actions">
        <button className="btn" disabled={inviting} onClick={invite}><Headphones size={15} />{' '}{tr('같이 듣기 초대')}</button>
        <button className="icon-btn" aria-label={tr('더 보기')} onClick={(e) => openMenu(e, [{ label: tr('친구 삭제'), icon: UserMinus, onClick: confirmRemove }])}><MoreHorizontal size={18} /></button>
      </div>
    </li>
  );
}

export default function Friends() {
  const user = useAccount((s) => s.user);
  const friendCode = useFriends((s) => s.friendCode);
  const friends = useFriends((s) => s.friends);
  const requests = useFriends((s) => s.requests);
  const { addFriend, acceptRequest, declineRequest } = useFriends.getState();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEnter(ref, [Boolean(user)], { step: 40 });

  if (!user) {
    return (
      <div className="page friends" ref={ref}>
        <div className="page-title" data-enter><h1>{tr('친구')}</h1></div>
        <Empty icon={Users} title={tr('로그인이 필요해요')} text={tr('친구 기능은 인터넷에 연결해 로그인해야 쓸 수 있어요.')}>
          <button className="btn" onClick={() => useAccount.getState().leaveOffline()}>{tr('로그인')}</button>
        </Empty>
      </div>
    );
  }

  const list = Object.entries(friends).sort(([, a], [, b]) => Number(b.online) - Number(a.online) || Number(Boolean(b.track)) - Number(Boolean(a.track)) || a.name.localeCompare(b.name));
  const online = list.filter(([, f]) => f.online).length;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const problem = await addFriend(code);
    setBusy(false);
    setError(problem);
    if (!problem) setCode('');
  };

  const copyCode = async () => {
    await api.copyText(friendCode);
    toast(tr('친구 코드를 복사했습니다'));
  };

  return (
    <div className="page friends" ref={ref}>
      <div className="page-title" data-enter><h1>{tr('친구')}</h1></div>

      <div className="friends-top">
        <section className="room-card" data-enter>
          <h3><Users size={16} />{' '}{tr('내 친구 코드')}</h3>
          <div className="room-code-row">
            <div className="room-code friend-code">{friendCode || '········'}</div>
            <button className="btn" onClick={copyCode} disabled={!friendCode}><Copy size={15} />{' '}{tr('복사')}</button>
          </div>
          <p>{tr('이 코드를 친구에게 보내면 나를 추가할 수 있어요.')}</p>
        </section>
        <form className="room-card" data-enter onSubmit={submit}>
          <h3><UserPlus size={16} />{' '}{tr('친구 추가')}</h3>
          <div className="friend-add">
            <input className="friend-code-input" value={code} onChange={(e) => { setCode(normalizeFriendCode(e.target.value)); setError(null); }} placeholder={tr('친구 코드 입력')} spellCheck={false} />
            <button className="btn-primary" disabled={busy || !code}>{tr('요청 보내기')}</button>
          </div>
          {error ? <p className="room-error friend-error" role="alert">{error}</p> : <p>{tr('상대방이 수락하면 친구가 돼요.')}</p>}
        </form>
      </div>

      {requests.length > 0 && (
        <section className="room-card friends-section" data-enter>
          <h3><UserPlus size={16} />{' '}{tr('받은 친구 요청')}{' '}<small>{tr('{0}개', requests.length)}</small></h3>
          <ul className="friend-list">
            {requests.map((r) => (
              <li key={r.uid} className="friend-row">
                <span className="friend-avatar"><Avatar user={r} size={44} /></span>
                <div className="friend-text"><b>{r.name}</b></div>
                <div className="friend-actions">
                  <button className="btn-primary friend-accept" onClick={() => acceptRequest(r.uid).catch(() => toast(tr('수락하지 못했습니다')))}><Check size={15} />{' '}{tr('수락')}</button>
                  <button className="btn" onClick={() => declineRequest(r.uid)}><X size={15} />{' '}{tr('거절')}</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="room-card friends-section" data-enter>
        <h3><Users size={16} />{' '}{tr('친구')}{' '}<small>{tr('{0}명 · {1}명 온라인', list.length, online)}</small></h3>
        {list.length ? (
          <ul className="friend-list">
            {list.map(([uid, friend]) => <FriendRow key={uid} uid={uid} friend={friend} />)}
          </ul>
        ) : (
          <p>{tr('아직 친구가 없어요. 친구 코드를 주고받아 추가해 보세요.')}</p>
        )}
      </section>
    </div>
  );
}
