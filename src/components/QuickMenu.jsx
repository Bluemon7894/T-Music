// The quick menu's own page, drawn in its overlay window. The screen behind dims, and a glass panel
// slides in from the left with what's playing, six tiles, what's next and friends online.
// Arrow keys move between controls, Enter presses, Esc (or the shortcut again) closes.
import { useEffect, useRef, useState } from 'react';
import { Disc3, Heart, Bookmark, BookmarkCheck, ListMusic, Pause, Play, PictureInPicture2, Plus, Radio, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Users, Volume1, Volume2, VolumeX } from 'lucide-react';
import { api } from '../lib/api.js';
import { tr } from '../lib/i18n.js';
import logo from '../assets/logo-mark.png';

const send = (command, arg) => api.quickCommand(command, arg).catch(() => {});
const fmt = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function Art({ src, className = '' }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  return src && !broken
    ? <img className={`qm-art ${className}`} src={src} alt="" draggable={false} onError={() => setBroken(true)} />
    : <span className={`qm-art qm-art-empty ${className}`}><img src={logo} alt="" draggable={false} /></span>;
}

function Tile({ icon: Icon, label, sub, on, disabled, onClick }) {
  return (
    <button className={`qm-tile ${on ? 'on' : ''}`} onClick={onClick} disabled={disabled} data-nav>
      <Icon size={22} />
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </button>
  );
}

function Volume({ volume, muted }) {
  const ref = useRef(null);
  const value = muted ? 0 : volume;
  const set = (e) => {
    const r = ref.current.getBoundingClientRect();
    send('volume', Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  const Icon = value === 0 ? VolumeX : value < 0.5 ? Volume1 : Volume2;
  return (
    <div className="qm-volume">
      <button className="qm-icon" onClick={() => send('mute')} data-nav aria-label={tr('음소거')}><Icon size={18} /></button>
      <div
        ref={ref}
        className="qm-vol-track"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); set(e); }}
        onPointerMove={(e) => { if (e.buttons) set(e); }}
      >
        <i style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

export default function QuickMenu() {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const panel = useRef(null);

  useEffect(() => {
    const offs = [
      api.onQuick('quick-state', setState),
      api.onQuick('quick-open', () => {
        setOpen(true);
        setTimeout(() => panel.current?.querySelector('[data-nav]')?.focus(), 60);
      }),
      api.onQuick('quick-close', () => setOpen(false)),
    ];
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); send('close'); return; }
      if (e.key === ' ' && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); send('toggle'); return; }
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const items = [...(panel.current?.querySelectorAll('[data-nav]:not(:disabled)') || [])];
      if (!items.length) return;
      const here = items.indexOf(document.activeElement);
      if (here < 0) { items[0].focus(); return; }
      const from = items[here].getBoundingClientRect();
      const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
      let best = null;
      let bestScore = Infinity;
      for (const el of items) {
        if (el === items[here]) continue;
        const r = el.getBoundingClientRect();
        const dx = (r.left + r.width / 2) - (from.left + from.width / 2);
        const dy = (r.top + r.height / 2) - (from.top + from.height / 2);
        const along = dx * dir[0] + dy * dir[1];
        if (along <= 2) continue;
        const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
        const score = along + across * 2.5;
        if (score < bestScore) { bestScore = score; best = el; }
      }
      best?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => { offs.forEach((off) => off()); window.removeEventListener('keydown', onKey); };
  }, []);

  const s = state;
  const radio = s?.radio;
  const radioOn = Boolean(radio?.on);
  const title = radioOn ? radio.station?.name : s?.track?.title;
  const sub = radioOn ? (radio.station ? `${radio.station.band} ${radio.station.freq}` : '') : s?.track?.artist;
  const art = radioOn ? radio.station?.logo : s?.track?.thumb;
  const playing = radioOn ? radio.phase !== 'ending' : s?.playing;
  const progress = !radioOn && s?.duration ? Math.min(1, s.time / s.duration) : 0;

  return (
    <div className={`qm ${open ? 'open' : ''}`} onPointerDown={(e) => { if (e.target === e.currentTarget) send('close'); }}>
      <aside className="qm-panel" ref={panel}>
        <div className="qm-brand"><img src={logo} alt="" draggable={false} /><b>T-Music</b><kbd>Esc</kbd></div>

        <section className="qm-now">
          <div className="qm-now-bg" style={{ backgroundImage: art ? `url("${art}")` : undefined }} />
          <button className="qm-now-main" onClick={() => send('openApp')} data-nav title={tr('앱 열기')}>
            <Art src={art} />
            <span className="qm-now-text">
              <small>{radioOn ? tr('라디오') : tr('지금 재생 중')}</small>
              <b>{title || tr('재생할 곡을 골라보세요')}</b>
              <em>{sub || ''}</em>
            </span>
          </button>
          {radioOn ? (
            <div className="qm-progress qm-live"><span>{tr('ON AIR')}</span><div><i /></div><span>{tr('실시간')}</span></div>
          ) : (
            <div className="qm-progress"><span>{fmt(s?.time)}</span><div><i style={{ width: `${progress * 100}%` }} /></div><span>{fmt(s?.duration)}</span></div>
          )}
          <div className="qm-controls">
            <button className="qm-icon" onClick={() => send('prev')} data-nav aria-label={tr('이전')}><SkipBack size={20} fill="currentColor" /></button>
            <button className="qm-play" onClick={() => send('toggle')} data-nav aria-label={playing ? tr('일시정지') : tr('재생')}>
              {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
            </button>
            <button className="qm-icon" onClick={() => send('next')} data-nav aria-label={tr('다음')}><SkipForward size={20} fill="currentColor" /></button>
            <Volume volume={s?.volume ?? 1} muted={s?.muted} />
          </div>
        </section>

        <section className="qm-tiles">
          {radioOn
            ? <Tile icon={radio.saved ? BookmarkCheck : Bookmark} label={tr('주파수 저장')} on={radio.saved} onClick={() => send('like')} disabled={!radio.station} />
            : <Tile icon={Heart} label={tr('좋아요')} on={s?.liked} onClick={() => send('like')} disabled={!s?.track} />}
          <Tile icon={Shuffle} label={tr('셔플')} on={s?.shuffle} onClick={() => send('shuffle')} disabled={radioOn} />
          <Tile icon={s?.repeat === 'one' ? Repeat1 : Repeat} label={tr('반복')} sub={{ off: tr('끔'), all: tr('전체'), one: tr('한 곡') }[s?.repeat || 'off']} on={s?.repeat && s.repeat !== 'off'} onClick={() => send('repeat')} disabled={radioOn} />
          <Tile icon={Radio} label={tr('라디오')} sub={radioOn && radio.station ? `${radio.station.band} ${radio.station.freq}` : tr('끔')} on={radioOn} onClick={() => send('radio')} />
          <Tile icon={Disc3} label={tr('무대')} sub={s?.deck === 'cassette' ? tr('카세트') : tr('턴테이블')} onClick={() => send('deck')} disabled={radioOn} />
          <Tile icon={PictureInPicture2} label={tr('미니')} on={s?.mini} onClick={() => send('mini')} />
        </section>

        <section className="qm-next">
          <h3><ListMusic size={14} />{' '}{radioOn ? tr('저장한 주파수') : tr('다음 곡')}</h3>
          {radioOn ? (
            radio.stations?.length ? radio.stations.map((st) => (
              <button key={st.id} className={`qm-row ${st.id === radio.station?.id ? 'on' : ''}`} onClick={() => send('tune', st.id)} data-nav>
                <Art src={st.logo} className="small" />
                <span><b>{st.name}</b><small>{st.band} {st.freq}</small></span>
              </button>
            )) : <p className="qm-empty">{tr('라디오에서 주파수를 저장하면 여기에 보여요')}</p>
          ) : s?.next?.length ? s.next.map((t, i) => (
            <button key={t.key || t.index || i} className="qm-row" onClick={() => send('jump', t.index)} disabled={!Number.isInteger(t.index)} data-nav>
              <Art src={t.thumb} className="small" />
              <span><b>{t.title}</b><small>{t.artist}</small></span>
            </button>
          )) : <p className="qm-empty">{tr('대기열이 비어 있어요')}</p>}
        </section>

        <section className="qm-friends">
          {s?.room ? (
            <div className="qm-room"><Users size={16} /><b>{s.room.name}</b><small>{tr('{0}명 듣는 중', s.room.count)}</small></div>
          ) : (
            <span className="qm-friends-label">{s?.friends?.length ? tr('접속 중 친구 {0}명', s.friends.length) : tr('접속 중인 친구가 없어요')}</span>
          )}
          <div className="qm-avatars">
            {s?.friends?.map((f) => (
              <button key={f.uid} className="qm-avatar" onClick={() => send('invite', f.uid)} title={tr('{0}님을 같이 듣기에 초대', f.name)} data-nav>
                {f.photo ? <img src={f.photo} alt="" draggable={false} /> : <span>{(f.name || '?').slice(0, 1)}</span>}
                <i />
              </button>
            ))}
            {!s?.room && <button className="qm-avatar add" onClick={() => send('room')} title={tr('같이 듣기 방 만들기')} data-nav><Plus size={16} /></button>}
          </div>
        </section>
      </aside>
    </div>
  );
}
