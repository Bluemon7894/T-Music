import { useRef, useState } from 'react';
import { Copy, Crown, Link2, ListMusic, LogOut, Plus, Radio, Users, Wifi, WifiOff, X } from 'lucide-react';
import { Empty, ArtistLinks, Thumb } from '../components/common.jsx';
import { useAccount } from '../store/account.js';
import { inviteLink, normalizeCode, useRoom } from '../store/room.js';
import { toast } from '../store/ui.js';
import { api } from '../lib/api.js';
import { useEnter } from '../lib/motion.js';

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
          <h2>방 만들기</h2>
          <p>지금 듣는 곡부터 시작해요. 내가 방장이 되고, 초대 코드를 친구에게 보내면 돼요.</p>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="방 이름 (선택)" spellCheck={false} />
          <button className="btn-primary room-submit" disabled={busy}>방 만들기</button>
        </form>
        <form className="room-card" data-enter onSubmit={(e) => { e.preventDefault(); join(code); }}>
          <span className="room-card-icon"><Users size={22} /></span>
          <h2>방 들어가기</h2>
          <p>친구에게 받은 6자리 코드를 입력하세요. 초대 링크를 눌러도 바로 들어와요.</p>
          <input className="room-code-input" value={code} onChange={(e) => setCode(normalizeCode(e.target.value))} placeholder="ABC234" spellCheck={false} autoCapitalize="characters" />
          <button className="btn-secondary room-submit" disabled={busy || !code}>들어가기</button>
        </form>
      </div>
      {error && <p className="room-error" data-enter role="alert">{error}</p>}
      <p className="room-hint" data-enter>음원은 각자 PC에서 재생하고, 재생 위치만 서로 맞춰요. 친구도 T-Music이 있어야 해요.</p>
    </>
  );
}

function syncLabel(driftMs, connected) {
  if (!connected) return '연결 중...';
  if (driftMs === null) return '대기 중';
  if (driftMs === 0) return '기준 재생';
  const seconds = (Math.abs(driftMs) / 1000).toFixed(2);
  return `오차 ${seconds}초`;
}

function InRoom() {
  const code = useRoom((s) => s.code);
  const meta = useRoom((s) => s.meta);
  const members = useRoom((s) => s.members);
  const playback = useRoom((s) => s.playback);
  const queue = useRoom((s) => s.queue);
  const connected = useRoom((s) => s.connected);
  const driftMs = useRoom((s) => s.driftMs);
  const uid = useAccount((s) => s.user?.uid);
  const { leave, setControlMode, makeHost, removeFromQueue } = useRoom.getState();

  const isHost = meta?.hostUid === uid;
  const everyone = meta?.controlMode === 'everyone';
  const list = Object.entries(members).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  const hostOnline = Boolean(members[meta?.hostUid]);
  const track = playback?.track;

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
              {connected ? <Wifi size={13} /> : <WifiOff size={13} />} {syncLabel(driftMs, connected)}
            </small>
            <h2 title={meta?.name}>{meta?.name || '같이 듣기'}</h2>
          </div>
          <button className="btn room-leave" onClick={leave}><LogOut size={15} /> 나가기</button>
        </div>
        <div className="room-code-row">
          <div className="room-code" aria-label="초대 코드">{code}</div>
          <button className="btn" onClick={() => copy(code, '초대 코드를 복사했습니다')}><Copy size={15} /> 코드 복사</button>
          <button className="btn" onClick={() => copy(inviteLink(code), '초대 링크를 복사했습니다')}><Link2 size={15} /> 링크 복사</button>
        </div>
        {!hostOnline && <p className="room-note">방장의 연결이 끊겼어요. 30초 안에 돌아오지 않으면 가장 오래 있던 멤버가 방장이 돼요.</p>}
      </section>

      <section className="room-card room-now" data-enter>
        <h3><Radio size={16} /> 지금 함께 듣는 곡</h3>
        {track ? (
          <div className="room-track">
            <Thumb src={track.thumb} />
            <div className="room-track-text">
              <b title={track.title}>{track.title}</b>
              <ArtistLinks artists={track.artists ? Object.values(track.artists) : []} />
              <small>{playback.playing ? '재생 중' : '일시정지'}</small>
            </div>
          </div>
        ) : (
          <p className="muted">{isHost || everyone ? '곡을 재생하면 멤버 모두에게 함께 재생돼요.' : '곡이 시작되길 기다리고 있어요.'}</p>
        )}
        <div className="room-setting">
          <div>
            <b>조작 권한</b>
            <small>{everyone ? '모든 멤버가 재생을 조작할 수 있어요' : '방장만 재생을 조작할 수 있어요'}</small>
          </div>
          {isHost && (
            <div className="seg">
              <button className={!everyone ? 'on' : ''} onClick={() => setControlMode('host')}>방장만</button>
              <button className={everyone ? 'on' : ''} onClick={() => setControlMode('everyone')}>모두</button>
            </div>
          )}
        </div>
      </section>

      <section className="room-card room-members" data-enter>
        <h3><Users size={16} /> 멤버 <small>{list.length}명</small></h3>
        <ul>
          {list.map(([memberUid, m]) => (
            <li key={memberUid}>
              {m.photo
                ? <img className="avatar" src={m.photo} alt="" referrerPolicy="no-referrer" draggable={false} />
                : <span className="avatar fallback"><Users size={15} /></span>}
              <span className="room-member-name">{m.name}{memberUid === uid && <small> (나)</small>}</span>
              {memberUid === meta?.hostUid
                ? <span className="room-badge"><Crown size={12} /> 방장</span>
                : isHost && <button className="text-btn" onClick={() => makeHost(memberUid)}>방장 넘기기</button>}
            </li>
          ))}
        </ul>
      </section>

      <section className="room-card room-queue" data-enter>
        <h3><ListMusic size={16} /> 같이듣기 대기열 <small>{queue.length}곡</small></h3>
        {queue.length ? (
          <ul>
            {queue.map((item) => (
              <li key={item.key}>
                <Thumb src={item.track?.thumb} />
                <span className="room-queue-text">
                  <b title={item.track?.title}>{item.track?.title}</b>
                  <small>{item.byName}님이 추가</small>
                </span>
                {(isHost || item.by === uid) && (
                  <button className="icon-btn" onClick={() => removeFromQueue(item.key)} aria-label="대기열에서 삭제"><X size={15} /></button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">곡을 우클릭해서 대기열에 추가하면 다음 곡으로 재생돼요. 누구나 추가할 수 있어요.</p>
        )}
      </section>
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
      <div className="page-title" data-enter><h1>같이 듣기</h1></div>
      {!user && (
        <Empty icon={Users} title="로그인이 필요해요" text="같이 듣기는 인터넷에 연결해 로그인해야 쓸 수 있어요.">
          <button className="btn" onClick={() => useAccount.getState().leaveOffline()}>로그인</button>
        </Empty>
      )}
      {user && (code ? <InRoom /> : <Lobby />)}
    </div>
  );
}
