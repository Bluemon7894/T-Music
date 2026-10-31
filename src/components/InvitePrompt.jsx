import { useLayoutEffect, useRef } from 'react';
import { Headphones } from 'lucide-react';
import { useFriends } from '../store/friends.js';
import { animate, ease } from '../lib/motion.js';
import { Avatar } from './Account.jsx';
import { tr } from '../lib/i18n.js';

// A friend's invitation to listen together, shown over whatever page is open.
export default function InvitePrompt() {
  const invite = useFriends((s) => s.invites[0]);
  const { acceptInvite, declineInvite } = useFriends.getState();
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (ref.current) animate(ref.current, { opacity: [0, 1], translateY: [24, 0], ease: ease.bouncy });
  }, [invite?.id]);

  if (!invite) return null;
  return (
    <div className="invite-card" ref={ref} role="alertdialog" aria-label={tr('같이 듣기 초대')}>
      <Avatar user={{ photo: invite.fromPhoto }} size={44} />
      <div className="invite-text">
        <b>{invite.fromName || tr('친구')}{tr('님의 초대')}</b>
        <small>{invite.roomName || tr('같이 듣기')}{tr('에서 같이 들어요')}</small>
      </div>
      <div className="invite-actions">
        <button className="btn-primary" onClick={() => acceptInvite(invite)}><Headphones size={15} />{' '}{tr('같이 듣기')}</button>
        <button className="btn" onClick={() => declineInvite(invite)}>{tr('거절')}</button>
      </div>
    </div>
  );
}
