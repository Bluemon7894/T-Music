// Teaches Ctrl+Z about the stores. Each store action is wrapped once, here, so every button, menu and
// drop that calls it can be taken back without knowing anything about undo.
import { useLibrary } from '../store/library.js';
import { restorePlayerState, usePlayer } from '../store/player.js';
import { usePrefs } from '../store/prefs.js';
import { useDeck } from '../store/deck.js';
import { useSleepTimer } from '../store/sleepTimer.js';
import { useUI } from '../store/ui.js';
import { isUndoing, record } from '../store/undo.js';
import { tr } from './i18n.js';

const LIBRARY_KEYS = ['liked', 'playlists', 'savedAlbums', 'followed', 'recent', 'searches'];
const LIBRARY_ACTIONS = {
  toggleLike: () => tr('좋아요'),
  removeRecent: () => tr('최근 들은 곡 삭제'),
  forgetSearch: () => tr('검색 기록 삭제'),
  clearSearches: () => tr('검색 기록 지우기'),
  createPlaylist: () => tr('플레이리스트 만들기'),
  renamePlaylist: () => tr('플레이리스트 이름 변경'),
  setPlaylistPublic: () => tr('플레이리스트 공개 설정'),
  deletePlaylist: () => tr('플레이리스트 삭제'),
  addToPlaylist: () => tr('플레이리스트에 추가'),
  removeFromPlaylist: () => tr('플레이리스트에서 삭제'),
  reorderPlaylist: () => tr('플레이리스트 순서 변경'),
  toggleSavedAlbum: () => tr('앨범 저장'),
  toggleFollow: () => tr('팔로우'),
};

function wrapLibrary() {
  const state = useLibrary.getState();
  const wrapped = {};
  for (const [name, label] of Object.entries(LIBRARY_ACTIONS)) {
    const action = state[name];
    wrapped[name] = (...args) => {
      const before = useLibrary.getState();
      const result = action(...args);
      const after = useLibrary.getState();
      const changed = LIBRARY_KEYS.filter((key) => before[key] !== after[key]);
      if (changed.length) record(label(), () => useLibrary.setState(Object.fromEntries(changed.map((key) => [key, before[key]]))));
      return result;
    };
  }
  useLibrary.setState(wrapped);
}

const PLAYER_QUEUE_ACTIONS = {
  playList: () => tr('곡 재생'),
  playNext: () => tr('다음에 재생'),
  addToQueue: () => tr('대기열에 추가'),
  removeAt: () => tr('대기열에서 삭제'),
  reorderQueue: () => tr('대기열 순서 변경'),
  jumpTo: () => tr('곡 이동'),
  next: () => tr('다음 곡'),
  prev: () => tr('이전 곡'),
  toggleShuffle: () => tr('셔플'),
  cycleRepeat: () => tr('반복'),
  toggleAutoplay: () => tr('자동 재생'),
};

const snapshot = () => {
  const { queue, index, context, shuffle, unshuffled, repeat, autoplay, playing, getPreciseTime } = usePlayer.getState();
  return { queue, index, context, shuffle, unshuffled, repeat, autoplay, playing, time: getPreciseTime() };
};

const queueMoved = (a, b) => a.queue !== b.queue || a.index !== b.index || a.shuffle !== b.shuffle || a.repeat !== b.repeat || a.autoplay !== b.autoplay;

function wrapPlayer() {
  const state = usePlayer.getState();
  const wrapped = {};
  let inside = 0; // actions call each other; only the outermost is what the person did
  for (const [name, label] of Object.entries(PLAYER_QUEUE_ACTIONS)) {
    const action = state[name];
    wrapped[name] = (...args) => {
      // A track ending by itself isn't something anyone did.
      if (inside || isUndoing() || (name === 'next' && args[0] === true)) return action(...args);
      const before = snapshot();
      inside++;
      let result;
      try {
        result = action(...args);
      } finally {
        inside--;
      }
      const settle = () => {
        const after = snapshot();
        if (queueMoved(before, after)) record(label(), () => restorePlayerState(before));
        else if ((name === 'prev' || name === 'next') && Math.abs(before.time - after.time) > 1) record(label(), () => usePlayer.getState().seek(before.time));
      };
      if (result?.then) result.finally(settle);
      else settle();
      return result;
    };
  }

  const { seek, setVolume, toggleMute, toggle } = state;
  wrapped.seek = (time) => {
    const from = usePlayer.getState().getPreciseTime();
    seek(time);
    record(tr('재생 위치 이동'), () => usePlayer.getState().seek(from), 'seek');
  };
  wrapped.setVolume = (value) => {
    const from = usePlayer.getState().volume;
    setVolume(value);
    if (from !== value) record(tr('음량 변경'), () => usePlayer.getState().setVolume(from), 'volume');
  };
  wrapped.toggleMute = () => {
    toggleMute();
    record(tr('음소거'), () => usePlayer.getState().toggleMute());
  };
  wrapped.toggle = () => {
    if (!usePlayer.getState().current()) return;
    toggle();
    record(tr('재생 / 일시정지'), () => usePlayer.getState().toggle());
  };
  usePlayer.setState(wrapped);
}

function wrapPrefs() {
  const { setPref } = usePrefs.getState();
  usePrefs.setState({
    setPref(patch) {
      const state = usePrefs.getState();
      const before = Object.fromEntries(Object.keys(patch).map((key) => [key, state[key]]));
      setPref(patch);
      record(tr('설정 변경'), () => usePrefs.getState().setPref(before));
    },
  });

  const { setStyle, setSounds } = useDeck.getState();
  useDeck.setState({
    setStyle(style) {
      const from = useDeck.getState().style;
      setStyle(style);
      if (from !== style) record(tr('플레이어 스타일'), () => useDeck.getState().setStyle(from));
    },
    setSounds(sounds) {
      const from = useDeck.getState().sounds;
      setSounds(sounds);
      if (from !== sounds) record(tr('시작·끝 효과음'), () => useDeck.getState().setSounds(from));
    },
  });

  const { start } = useSleepTimer.getState();
  useSleepTimer.setState({
    start(minutes) {
      const from = useSleepTimer.getState().minutes;
      start(minutes);
      if (from !== minutes) record(tr('취침 타이머'), () => useSleepTimer.getState().start(from));
    },
  });

  const { togglePanel, toggleSide } = useUI.getState();
  useUI.setState({
    togglePanel() {
      togglePanel();
      record(tr('패널 열기 / 닫기'), () => useUI.getState().togglePanel());
    },
    toggleSide() {
      toggleSide();
      record(tr('사이드바 접기 / 펴기'), () => useUI.getState().toggleSide());
    },
  });
}

let done = false;
export function setupUndo() {
  if (done) return;
  done = true;
  wrapLibrary();
  wrapPlayer();
  wrapPrefs();
}
