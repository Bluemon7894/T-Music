// The phone layout: pages on top, then the mini player and tab bar. Desktop's sidebar, top bar, side
// panel and dock don't exist here; their jobs move to the tabs, the top bar and the full-screen player.
import { ArrowDownToLine, ChevronLeft, Home, Library, Search, Settings, SkipForward, UserRoundPlus, Users } from 'lucide-react';
import { useNav, useRoute } from '../../store/nav.js';
import { useUI } from '../../store/ui.js';
import { usePlayer } from '../../store/player.js';
import { useFriends } from '../../store/friends.js';
import { useRoom } from '../../store/room.js';
import { artistNames } from '../../lib/util.js';
import { Thumb, PlayButton } from '../common.jsx';
import { LikeButton } from '../TrackList.jsx';
import { AccountButton } from '../Account.jsx';
import { ContextMenu, Toast, Dialog } from '../Overlays.jsx';
import InvitePrompt from '../InvitePrompt.jsx';
import UpdateModal from '../UpdateModal.jsx';
import { SearchBox, UpdatePill, DownloadPill } from '../layout/TopBar.jsx';
import MobileStage from './MobileStage.jsx';
import logo from '../../assets/logo-mark.png';
import { tr } from '../../lib/i18n.js';

const TABS = [
  { id: 'home', label: tr('홈'), icon: Home },
  { id: 'search', label: tr('검색'), icon: Search },
  { id: 'library', label: tr('보관함'), icon: Library },
  { id: 'room', label: tr('같이 듣기'), icon: Users },
  { id: 'friends', label: tr('친구'), icon: UserRoundPlus },
];

const isTab = (name) => TABS.some((t) => t.id === name);

function MobileTop() {
  const route = useRoute();
  const { go, back } = useNav.getState();
  if (route.name === 'search') {
    return <header className="m-top"><SearchBox /></header>;
  }
  return (
    <header className="m-top">
      {isTab(route.name) ? (
        <div className="m-brand"><img src={logo} alt="" draggable={false} /><span>T-Music</span></div>
      ) : (
        <button className="icon-btn circle glass" onClick={back} aria-label={tr('뒤로')}><ChevronLeft size={20} /></button>
      )}
      <div className="m-top-right">
        <UpdatePill />
        <DownloadPill />
        <button className={`icon-btn circle glass ${route.name === 'downloads' ? 'on' : ''}`} onClick={() => go('downloads')} aria-label={tr('다운로드')}><ArrowDownToLine size={17} /></button>
        <button className={`icon-btn circle glass ${route.name === 'settings' ? 'on' : ''}`} onClick={() => go('settings')} aria-label={tr('설정')}><Settings size={17} /></button>
        <AccountButton />
      </div>
    </header>
  );
}

function MiniBar({ track }) {
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration) || track.duration || 0;
  const { toggle, next } = usePlayer.getState();
  const setStage = useUI((s) => s.setStage);
  return (
    <div className="m-mini" onClick={() => setStage(true)}>
      <Thumb src={track.thumb} className="m-mini-art" />
      <div className="m-mini-text">
        <b>{track.title}</b>
        <small>{artistNames(track)}</small>
      </div>
      <LikeButton track={track} size={20} />
      <PlayButton size={40} playing={playing} onClick={toggle} className={`dock-play ${loading && playing ? 'loading' : ''}`} />
      <button className="icon-btn m-mini-next" onClick={(e) => { e.stopPropagation(); next(); }} aria-label={tr('다음 곡')}><SkipForward size={22} fill="currentColor" /></button>
      <i className="m-mini-progress" style={{ width: `${duration ? Math.min(100, (time / duration) * 100) : 0}%` }} />
    </div>
  );
}

function TabBar() {
  const route = useRoute();
  const go = useNav((s) => s.go);
  const requests = useFriends((s) => s.requests.length);
  const listeners = useRoom((s) => Object.values(s.members).filter((m) => m.listening).length);
  const badges = { friends: requests, room: listeners };
  const active = TABS.find((t) => t.id === route.name || (t.id === 'library' && ['liked', 'local', 'downloads'].includes(route.name)))?.id;
  return (
    <nav className="m-tabs">
      {TABS.map((t) => (
        <button key={t.id} className={`m-tab ${t.id === active ? 'on' : ''}`} onClick={() => go(t.id, {})}>
          <span className="m-tab-icon">
            <t.icon size={21} />
            {badges[t.id] > 0 && <b className="m-tab-badge">{badges[t.id]}</b>}
          </span>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default function MobileShell({ mainRef, children }) {
  const track = usePlayer((s) => s.queue[s.index]);
  const stage = useUI((s) => s.stage);
  return (
    <div className={`m-app ${track ? 'has-mini' : ''} ${stage ? 'stage-open' : ''}`}>
      <div className="m-bg" />
      <MobileTop />
      <main className="main" ref={mainRef}>{children}</main>
      {track && <MiniBar track={track} />}
      <TabBar />
      {stage && <MobileStage />}
      <ContextMenu />
      <Dialog />
      <Toast />
      <InvitePrompt />
      <UpdateModal />
    </div>
  );
}
