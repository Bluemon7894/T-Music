// The radio page: the dial, what's on now for the chosen band and region, and saved frequencies.
// The list refreshes every minute while the page is open, or right away with the button.
import { useEffect, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Power, RefreshCw, MonitorPlay, RadioTower } from 'lucide-react';
import { useRadio, COUNTRIES, REFRESH_MS } from '../store/radio.js';
import { useLibrary } from '../store/library.js';
import { useRoom } from '../store/room.js';
import { burst, useEnter } from '../lib/motion.js';
import { Thumb, Empty, Equalizer } from '../components/common.jsx';
import RadioDial, { BANDS } from '../components/RadioDial.jsx';
import { tr } from '../lib/i18n.js';

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return tr('방금 갱신');
  if (s < 60) return tr('{0}초 전 갱신', s);
  return tr('{0}분 전 갱신', Math.floor(s / 60));
}

function ChannelRow({ c, current, playing, onPick }) {
  const band = BANDS[c.band];
  return (
    <button className={`radio-row ${current ? 'on' : ''}`} onClick={() => onPick(c)}>
      <span className="radio-freq">{band.fmt(c.freq)}<small>{c.band}</small></span>
      <Thumb src={c.logo} className="radio-logo" />
      <span className="radio-text">
        <b>{c.name}</b>
        <small>
          {c.kind === 'youtube' ? <><MonitorPlay size={12} />{' '}{c.channel || 'YouTube'}</> : <><RadioTower size={12} />{' '}{c.tags?.slice(0, 2).join(' · ') || tr('방송국')}</>}
        </small>
      </span>
      {current ? <Equalizer playing={playing} /> : <i className="radio-live" title={tr('방송 중')} />}
    </button>
  );
}

export default function Radio() {
  const { channels, band, country, loading, error, updatedAt, station, phase, buffering, failed } = useRadio();
  const { refresh, setBand, setCountry, tune, toggle, step, toggleSave } = useRadio.getState();
  const savedStations = useLibrary((s) => s.savedStations);
  const saved = useLibrary((s) => station && s.savedStations.some((x) => x.id === station.id));
  const roomRadio = useRoom((s) => (s.attached ? s.radio : null));
  const inRoom = useRoom((s) => s.attached);
  const [, tick] = useState(0);
  const ref = useRef(null);
  useEnter(ref, [], { step: 40 });

  useEffect(() => {
    if (!useRadio.getState().channels.length || Date.now() - useRadio.getState().updatedAt > REFRESH_MS) refresh();
    const auto = setInterval(refresh, REFRESH_MS);
    const clock = setInterval(() => tick((n) => n + 1), 5000);
    return () => { clearInterval(auto); clearInterval(clock); };
  }, [refresh]);

  const on = phase !== 'off';
  const list = channels.filter((c) => c.band === band);
  const bandOf = station && on ? station.band : band;
  const current = on ? station : null;

  return (
    <div className="page radio-page" ref={ref}>
      <div className="page-title" data-enter>
        <h1>{tr('라디오')}</h1>
        <div className="radio-tools">
          <select className="set-select" value={country} onChange={(e) => setCountry(e.target.value)} aria-label={tr('지역')}>
            {COUNTRIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <div className="seg">
            {['FM', 'AM'].map((b) => <button key={b} className={band === b ? 'on' : ''} onClick={() => setBand(b)}>{b}</button>)}
          </div>
          <button className="btn" onClick={refresh} disabled={loading} title={tr('새로고침')}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />{' '}{updatedAt ? ago(Date.now() - updatedAt) : tr('새로고침')}
          </button>
        </div>
      </div>

      <section className={`radio-hero ${on ? 'on' : ''}`} data-enter>
        <RadioDial bandId={bandOf} channels={channels.filter((c) => c.band === bandOf)} current={current} onPick={tune} />
        <div className="radio-now">
          <Thumb src={current?.logo} className="radio-now-logo" />
          <div className="radio-now-text">
            <span className="radio-kicker">
              {phase === 'tuning' ? tr('주파수를 맞추는 중…') : phase === 'ending' ? tr('끄는 중…') : on ? (failed ? tr('연결할 수 없어요') : buffering ? tr('연결 중…') : tr('지금 듣는 중')) : tr('라디오 꺼짐')}
              {inRoom && roomRadio && <em>{' · '}{tr('같이 듣기')}</em>}
            </span>
            <b>{current?.name || tr('채널을 골라 주세요')}</b>
            {current && <small>{BANDS[current.band].fmt(current.freq)} {current.band}{current.virtual ? ` · ${tr('인터넷 방송')}` : ''}</small>}
          </div>
          <div className="radio-now-actions">
            <button className="icon-btn" onClick={() => step(-1)} disabled={!list.length} aria-label={tr('이전 채널')}><ChevronLeft size={20} /></button>
            <button className={`radio-power ${on ? 'on' : ''}`} onClick={toggle} aria-label={on ? tr('라디오 끄기') : tr('라디오 켜기')}><Power size={22} /></button>
            <button className="icon-btn" onClick={() => step(1)} disabled={!list.length} aria-label={tr('다음 채널')}><ChevronRight size={20} /></button>
            <button className={`icon-btn ${saved ? 'on' : ''}`} onClick={(e) => { if (!saved) burst(e.currentTarget, '#f0abfc'); toggleSave(); }} disabled={!current} title={saved ? tr('저장한 주파수에서 빼기') : tr('주파수 저장')} aria-label={tr('주파수 저장')}>
              {saved ? <BookmarkCheck size={19} /> : <Bookmark size={19} />}
            </button>
          </div>
        </div>
      </section>

      {savedStations.length > 0 && (
        <section className="radio-section" data-enter>
          <h2>{tr('저장한 주파수')}</h2>
          <div className="radio-saved">
            {savedStations.map((s) => (
              <button key={s.id} className={`radio-chip ${current?.id === s.id ? 'on' : ''}`} onClick={() => tune(s)}>
                <Thumb src={s.logo} className="radio-chip-logo" />
                <span><b>{BANDS[s.band]?.fmt(s.freq)} {s.band}</b><small>{s.name}</small></span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="radio-section" data-enter>
        <h2>{tr('지금 방송 중')} <small className="muted">{tr('{0}개 채널', list.length)}</small></h2>
        {error && !list.length ? (
          <Empty icon={RadioTower} title={tr('라디오 목록을 불러오지 못했어요')} text={error} />
        ) : !list.length ? (
          loading ? <div className="radio-list">{Array.from({ length: 8 }, (_, i) => <div key={i} className="radio-row-sk sk" style={{ animationDelay: `${i * 60}ms` }} />)}</div>
            : <Empty icon={RadioTower} title={tr('이 밴드에는 지금 방송 중인 채널이 없어요')} text={tr('다른 밴드나 지역을 골라 보세요.')} />
        ) : (
          <div className="radio-list">
            {list.map((c) => <ChannelRow key={c.id} c={c} current={current?.id === c.id} playing={phase === 'on' && !buffering} onPick={tune} />)}
          </div>
        )}
      </section>
    </div>
  );
}
