// What came in for this account: invites to listen together, including the ones sent while the app was
// closed, and friend requests. Everything here is also what the bell in the top bar counts.
import { useRef } from 'react';
import { Bell, Check, Headphones, UserPlus, X } from 'lucide-react';
import { Avatar } from '../components/Account.jsx';
import { Empty } from '../components/common.jsx';
import { useFriends } from '../store/friends.js';
import { useEnter } from '../lib/motion.js';
import { toast } from '../store/ui.js';
import { tr } from '../lib/i18n.js';

const ago = (at) => {
  const minutes = Math.max(0, Math.round((Date.now() - (Number(at) || Date.now())) / 60000));
  if (minutes < 1) return tr('방금');
  if (minutes < 60) return tr('{0}분 전', minutes);
  return tr('{0}시간 전', Math.round(minutes / 60));
};

export default function Inbox() {
  const invites = useFriends((s) => s.invites);
  const requests = useFriends((s) => s.requests);
  const { acceptInvite, declineInvite, acceptRequest, declineRequest } = useFriends.getState();
  const ref = useRef(null);
  useEnter(ref, [invites.length + requests.length]);

  return (
    <div className="page inbox" ref={ref}>
      <div className="page-title" data-enter><h1>{tr('알림')}</h1></div>
      {!invites.length && !requests.length && (
        <Empty icon={Bell} title={tr('새 알림이 없어요')} text={tr('친구가 같이 듣자고 하거나 친구 요청을 보내면 여기에 모여요.')} />
      )}

      {invites.length > 0 && (
        <section className="room-card inbox-section" data-enter>
          <h3><Headphones size={16} />{' '}{tr('같이 듣기 초대')}{' '}<small>{tr('{0}개', invites.length)}</small></h3>
          <ul className="inbox-list">
            {invites.map((invite) => (
              <li key={invite.id}>
                <Avatar user={{ photo: invite.fromPhoto }} size={40} />
                <div className="inbox-text">
                  <b>{tr('{0}님이 같이 듣자고 해요', invite.fromName || tr('친구'))}</b>
                  <small>{invite.roomName || tr('같이 듣기')}{' · '}{ago(invite.at)}</small>
                </div>
                <div className="inbox-actions">
                  <button className="btn-primary" onClick={() => acceptInvite(invite)}><Headphones size={15} />{' '}{tr('같이 듣기')}</button>
                  <button className="icon-btn" onClick={() => declineInvite(invite)} aria-label={tr('지우기')} title={tr('지우기')}><X size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {requests.length > 0 && (
        <section className="room-card inbox-section" data-enter>
          <h3><UserPlus size={16} />{' '}{tr('받은 친구 요청')}{' '}<small>{tr('{0}개', requests.length)}</small></h3>
          <ul className="inbox-list">
            {requests.map((r) => (
              <li key={r.uid}>
                <Avatar user={r} size={40} />
                <div className="inbox-text">
                  <b>{tr('{0}님의 친구 요청', r.name)}</b>
                  <small>{tr('수락하면 서로 듣는 곡을 볼 수 있어요')}</small>
                </div>
                <div className="inbox-actions">
                  <button className="btn-primary" onClick={() => acceptRequest(r.uid).catch(() => toast(tr('수락하지 못했습니다')))}><Check size={15} />{' '}{tr('수락')}</button>
                  <button className="icon-btn" onClick={() => declineRequest(r.uid)} aria-label={tr('거절')} title={tr('거절')}><X size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// The bell next to settings, with how many things are waiting.
export function InboxButton({ route, go }) {
  const count = useFriends((s) => s.invites.length + s.requests.length);
  return (
    <button className={`icon-btn circle glass inbox-btn ${route.name === 'inbox' ? 'on' : ''}`} onClick={() => go('inbox')} title={tr('알림')} aria-label={count ? tr('알림 {0}개', count) : tr('알림')}>
      <Bell size={17} />
      {count > 0 && <b className="inbox-badge">{count > 9 ? '9+' : count}</b>}
    </button>
  );
}
