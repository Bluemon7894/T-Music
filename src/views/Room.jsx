import { useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Crown, GripVertical, Headphones, HeadphoneOff, Link2, ListMusic, LogOut, Mic2, Plus, Radio, Send, Share2, UserPlus, Users, Wifi, WifiOff, X } from 'lucide-react';
import { Empty, ArtistLinks, Thumb } from '../components/common.jsx';
import LyricsView from '../components/layout/LyricsView.jsx';
import { safePhoto, safeTrack } from '../lib/safeTrack.js';
import { useFriends } from '../store/friends.js';
import { usePlayer } from '../store/player.js';
import { useAccount } from '../store/account.js';
import { inviteLink, normalizeCode, useRoom } from '../store/room.js';
import { toast, useUI } from '../store/ui.js';
import { api } from '../lib/api.js';
import { useEnter } from '../lib/motion.js';
import { IS_ANDROID } from '../lib/platform.js';
import { tr } from '../lib/i18n.js';

function Lobby() {
  const busy = useRoom((s) => s.busy);
  const error = useRoom((s) => s.error);
  const { create, join } = useRoom.getState();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  return (
    <>
      <div className="room-lobby">
        <form className="room-card" data-enter onSubmit={(e) => { e.preventDefault(); create(name); }}>
          <span className="room-card-icon"><Plus size={22} /></span>
          <h2>{tr('방 만들기')}</h2>
          <p>{tr('지금 듣는 곡부터 시작해요. 내가 방장이 되고, 초대 코드를 친구에게 보내면 돼요.')}</p>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={tr('방 이름 (선택)')} spellCheck={false} />
          <button className="btn-primary room-submit" disabled={busy}>{tr('방 만들기')}</button>
        </form>
        <form className="room-card" data-enter onSubmit={(e) => { e.preventDefault(); join(code); }}>
          <span className="room-card-icon"><Users size={22} /></span>
          <h2>{tr('방 들어가기')}</h2>
          <p>{tr('친구에게 받은 6자리 코드를 입력하세요. 초대 링크를 눌러도 바로 들어와요.')}</p>
          <input className="room-code-input" value={code} onChange={(e) => setCode(normalizeCode(e.target.value))} placeholder="ABC234" spellCheck={false} autoCapitalize="characters" />
          <button className="btn-secondary room-submit" disabled={busy || !code}>{tr('들어가기')}</button>
        </form>
      </div>
      {error && <p className="room-error" data-enter role="alert">{error}</p>}
      <p className="room-hint" data-enter>{tr('음원은 각자')}{' '}{IS_ANDROID ? tr('기기') : 'PC'}{tr('에서 재생하고, 재생 위치만 서로 맞춰요. 친구도 T-Music이 있어야 해요.')}</p>
    </>
  );
}

function FriendInvites({ members }) {
  const friends = useFriends((s) => s.friends);
  const inviteFriend = useFriends((s) => s.inviteFriend);
  const list = Object.entries(friends).filter(([uid]) => !members[uid]).sort(([, a], [, b]) => Number(b.online) - Number(a.online));
  return (
    <section className="room-card room-friends" data-enter>
      <h3><Send size={16} />{' '}{tr('친구 초대')}</h3>
      {list.length ? (
        <ul>
          {list.map(([uid, f]) => (
            <li key={uid}>
              <i className={`room-dot ${f.online ? 'on' : ''}`} />
              <span className="room-member-name">{f.name || '...'}</span>
              <button className="text-btn" onClick={() => inviteFriend(uid)}>{tr('초대')}</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{tr('초대할 친구가 없어요. 친구 메뉴에서 친구를 추가하거나, 위의 코드를 보내 주세요.')}</p>
      )}
    </section>
  );
}

function syncLabel(driftMs, connected, attached) {
  if (!attached) return tr('듣고 있지 않음');
  if (!connected) return tr('연결 중...');
  if (driftMs === null) return tr('대기 중');
  if (driftMs === 0) return tr('기준 재생');
  const seconds = (Math.abs(driftMs) / 1000).toFixed(2);
  return tr('오차 {0}초', seconds);
}

function InRoom() {
  const code = useRoom((s) => s.code);
  const meta = useRoom((s) => s.meta);
  const members = useRoom((s) => s.members);
  const playback = useRoom((s) => s.playback);
  const queue = useRoom((s) => s.queue);
  const modes = useRoom((s) => s.modes);
  const connected = useRoom((s) => s.connected);
  const driftMs = useRoom((s) => s.driftMs);
  const attached = useRoom((s) => s.attached);
  const uid = useAccount((s) => s.user?.uid);
  const playerTrackId = usePlayer((s) => s.queue[s.index]?.id);
  const friends = useFriends((s) => s.friends);
  const friendRequests = useFriends((s) => s.requests);
  const sentRequests = useFriends((s) => s.sentRequests);
  const requestFriend = useFriends((s) => s.requestFriend);
  const { leave, follow, pause, setControlMode, makeHost, kick, removeFromQueue, moveInQueue } = useRoom.getState();
  const [dropAt, setDropAt] = useState(null);

  const isHost = meta?.hostUid === uid;
  const everyone = meta?.controlMode === 'everyone';
  const canReorder = isHost || everyone;
  const list = Object.entries(members).sort((a, b) => Number(Boolean(b[1].listening)) - Number(Boolean(a[1].listening)) || (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  const listening = list.filter(([, m]) => m.listening).length;
  const hostListening = Boolean(members[meta?.hostUid]?.listening);
  const track = safeTrack(playback?.track);

  const confirmLeave = () => useUI.getState().prompt({
    title: tr('방에서 나갈까요?'),
    message: list.length > 1 ? tr('다시 들어오려면 초대 코드가 필요해요. 잠시 혼자 듣고 싶다면 혼자 듣기를 눌러 주세요.') : tr('마지막 멤버라서 나가면 방이 삭제됩니다.'),
    submitLabel: tr('나가기'),
    onSubmit: leave,
  });

  const confirmKick = (memberUid, name) => useUI.getState().prompt({
    title: tr('{0}님을 내보낼까요?', name),
    message: tr('방에서 바로 나가게 되고, 방장이 다시 초대하기 전에는 코드로도 들어올 수 없어요.'),
    submitLabel: tr('내보내기'),
    onSubmit: () => kick(memberUid),
  });

  const copy = async (text, done) => {
    await api.copyText(text);
    toast(done);
  };

  return (
    <div className="room-grid">
      <section className="room-card room-hero" data-enter>
        <div className="room-hero-top">
          <div className="room-title">
            <small className={connected ? 'room-live on' : 'room-live'}>
              {connected ? <Wifi size={13} /> : <WifiOff size={13} />} {syncLabel(driftMs, connected, attached)}
            </small>
            <h2 title={meta?.name}>{meta?.name || tr('같이 듣기')}</h2>
          </div>
          <div className="row-actions room-hero-actions">
            {attached
              ? <button className="btn" onClick={pause}><HeadphoneOff size={15} />{' '}{tr('혼자 듣기')}</button>
              : <button className="btn-primary room-follow" onClick={follow}><Headphones size={15} />{' '}{tr('같이 듣기 시작')}</button>}
            <button className="btn room-leave" onClick={confirmLeave}><LogOut size={15} />{' '}{tr('나가기')}</button>
          </div>
        </div>
        <div className="room-code-row">
          <div className="room-code" aria-label={tr('초대 코드')}>{code}</div>
          <button className="btn" onClick={() => copy(code, tr('초대 코드를 복사했습니다'))}><Copy size={15} />{' '}{tr('코드 복사')}</button>
          <button className="btn" onClick={() => copy(inviteLink(code), tr('초대 링크를 복사했습니다'))}><Link2 size={15} />{' '}{tr('링크 복사')}</button>
          {IS_ANDROID && <button className="btn" onClick={() => api.shareText(tr('T-Music 같이 듣기에 초대합니다. 초대 코드: {0}', code))}><Share2 size={15} />{' '}{tr('보내기')}</button>}
        </div>
        {!attached && <p className="room-note">{tr('이 방에 계속 들어와 있어요. 시작을 누르면 지금 방의 곡을 같이 들어요.')}</p>}
        {attached && !hostListening && listening > 1 && <p className="room-note">{tr('방장이 자리를 비웠어요. 30초 안에 돌아오지 않으면 가장 오래 있던 멤버가 대신 방장이 돼요.')}</p>}
      </section>

      <section className="room-card room-now" data-enter>
        <h3><Radio size={16} />{' '}{tr('지금 함께 듣는 곡')}</h3>
        {track ? (
          <div className="room-track">
            <Thumb src={track.thumb} />
            <div className="room-track-text">
              <b title={track.title}>{track.title}</b>
              <ArtistLinks artists={track.artists ? Object.values(track.artists) : []} />
              <small>{playback.playing ? tr('재생 중') : tr('일시정지')}</small>
            </div>
          </div>
        ) : (
          <p className="muted">{isHost || everyone ? tr('곡을 재생하면 멤버 모두에게 함께 재생돼요.') : tr('곡이 시작되길 기다리고 있어요.')}</p>
        )}
        <div className="room-setting">
          <div>
            <b>{tr('조작 권한')}</b>
            <small>{everyone ? tr('모든 멤버가 곡을 추가하고 재생을 조작할 수 있어요') : tr('방장만 곡을 추가하고 재생을 조작할 수 있어요')}</small>
            <small>{tr('시작·끝 효과음:')}{' '}{meta?.sounds ? tr('켜짐') : tr('꺼짐')}{' '}{tr('(방장 설정)')}</small>
          </div>
          {isHost && (
            <div className="seg">
              <button className={!everyone ? 'on' : ''} onClick={() => setControlMode('host')}>{tr('방장만')}</button>
              <button className={everyone ? 'on' : ''} onClick={() => setControlMode('everyone')}>{tr('모두')}</button>
            </div>
          )}
        </div>
      </section>

      <section className="room-card room-members" data-enter>
        <h3><Users size={16} />{' '}{tr('멤버')}{' '}<small>{tr('{0}명 · {1}명 듣는 중', list.length, listening)}</small></h3>
        <ul>
          {list.map(([memberUid, m]) => (
            <li key={memberUid}>
              {safePhoto(m.photo)
                ? <img className="avatar" src={safePhoto(m.photo)} alt="" referrerPolicy="no-referrer" draggable={false} />
                : <span className="avatar fallback"><Users size={15} /></span>}
              <i className={`room-dot ${m.listening ? 'on' : ''}`} title={m.listening ? tr('듣는 중') : tr('자리 비움')} />
              <span className="room-member-name">{m.name}{memberUid === uid && <small>{' '}{tr('(나)')}</small>}</span>
              <span className="room-member-actions">
                {memberUid !== uid && !friends[memberUid] && (
                  sentRequests[memberUid]
                    ? <span className="room-member-sent"><Check size={13} />{' '}{tr('요청함')}</span>
                    : (
                      <button className="text-btn" onClick={() => requestFriend(memberUid)}>
                        <UserPlus size={13} /> {friendRequests.some((r) => r.uid === memberUid) ? tr('요청 수락') : tr('친구 추가')}
                      </button>
                    )
                )}
                {memberUid === meta?.hostUid
                  ? <span className="room-badge"><Crown size={12} />{' '}{tr('방장')}</span>
                  : isHost && <button className="text-btn" onClick={() => makeHost(memberUid)}>{tr('방장 넘기기')}</button>}
                {isHost && memberUid !== uid && memberUid !== meta?.ownerUid && (
                  <button className="text-btn room-kick" onClick={() => confirmKick(memberUid, m.name)}>{tr('내보내기')}</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="room-card room-queue" data-enter>
        <h3><ListMusic size={16} />{' '}{tr('같이듣기 대기열')}{' '}<small>{tr('{0}곡', queue.length)}{modes?.shuffle ? tr(' · 셔플') : ''}{modes?.repeat === 'all' ? tr(' · 전체 반복') : modes?.repeat === 'one' ? tr(' · 한 곡 반복') : ''}</small></h3>
        {queue.length ? (
          <ul>
            {queue.map((item, i) => (
              <li
                key={item.key}
                className={dropAt === i ? 'drop-target' : ''}
                draggable={canReorder && !IS_ANDROID}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/room-queue', String(i));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes('text/room-queue')) return;
                  e.preventDefault();
                  if (dropAt !== i) setDropAt(i);
                }}
                onDragLeave={() => setDropAt(null)}
                onDragEnd={() => setDropAt(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropAt(null);
                  const from = parseInt(e.dataTransfer.getData('text/room-queue'), 10);
                  if (Number.isInteger(from)) moveInQueue(from, i);
                }}
              >
                {canReorder && <GripVertical size={15} className="room-queue-grip" />}
                <span className="room-queue-index">{i + 1}</span>
                <Thumb src={item.track?.thumb} />
                <span className="room-queue-text">
                  <b title={item.track?.title}>{item.track?.title}</b>
                  <small>{tr('{0}님이 추가', item.byName)}</small>
                </span>
                {canReorder && (
                  <span className="room-queue-move">
                    <button className="icon-btn" disabled={i === 0} onClick={() => moveInQueue(i, i - 1)} aria-label={tr('위로')}><ChevronUp size={15} /></button>
                    <button className="icon-btn" disabled={i === queue.length - 1} onClick={() => moveInQueue(i, i + 1)} aria-label={tr('아래로')}><ChevronDown size={15} /></button>
                  </span>
                )}
                {canReorder && (
                  <button className="icon-btn" onClick={() => removeFromQueue(item.key)} aria-label={tr('대기열에서 삭제')}><X size={15} /></button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{IS_ANDROID ? tr('곡의 ⋯ 버튼으로 대기열에 추가하면') : tr('곡을 우클릭해서 대기열에 추가하면')}{' '}{tr('다음 곡으로 재생돼요.')}{' '}{everyone ? tr('누구나 추가할 수 있어요.') : tr('지금은 방장만 추가할 수 있어요.')}</p>
        )}
      </section>

      <FriendInvites members={members} />

      {attached && track && playerTrackId === track.id && (
        <section className="room-card room-lyrics" data-enter>
          <h3><Mic2 size={16} />{' '}{tr('가사')}</h3>
          <LyricsView key={track.id} track={track} variant="panel" />
        </section>
      )}
    </div>
  );
}

export default function Room() {
  const code = useRoom((s) => s.code);
  const user = useAccount((s) => s.user);
  const ref = useRef(null);
  useEnter(ref, [Boolean(code), Boolean(user)], { step: 50 });

  return (
    <div className="page room" ref={ref}>
      <div className="page-title" data-enter><h1>{tr('같이 듣기')}</h1></div>
      {!user && (
        <Empty icon={Users} title={tr('로그인이 필요해요')} text={tr('같이 듣기는 인터넷에 연결해 로그인해야 쓸 수 있어요.')}>
          <button className="btn" onClick={() => useAccount.getState().leaveOffline()}>{tr('로그인')}</button>
        </Empty>
      )}
      {user && (code ? <InRoom /> : <Lobby />)}
    </div>
  );
}
