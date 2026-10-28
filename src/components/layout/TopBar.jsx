import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X, Settings, PanelRight } from 'lucide-react';
import { useNav, useRoute } from '../../store/nav.js';
import { useUI } from '../../store/ui.js';
import { useDownloads } from '../../store/downloads.js';
import { api } from '../../lib/api.js';
import { ProgressRing } from '../DownloadButton.jsx';

function DownloadPill() {
  const allJobs = useDownloads((s) => s.jobs);
  const jobs = allJobs.filter((j) => j.status !== 'error');
  const go = useNav((s) => s.go);
  if (!jobs.length) return null;
  const received = jobs.reduce((n, j) => n + j.received, 0);
  const total = jobs.reduce((n, j) => n + (j.total || 0), 0);
  return (
    <button className="dl-pill" onClick={() => go('downloads')} title="다운로드 진행 상황">
      <ProgressRing value={total ? received / total : 0} size={18} />
      <span>{jobs.length}곡 받는 중</span>
    </button>
  );
}

export default function TopBar() {
  const { go, back, forward, replace } = useNav();
  const canBack = useNav((s) => s.index > 0);
  const canFwd = useNav((s) => s.index < s.stack.length - 1);
  const route = useRoute();
  const panelOpen = useUI((s) => s.panelOpen);
  const togglePanel = useUI((s) => s.togglePanel);
  const [text, setText] = useState('');
  const [sugs, setSugs] = useState([]);
  const [focus, setFocus] = useState(false);
  const [hi, setHi] = useState(-1);
  const inputRef = useRef(null);

  useEffect(() => {
    if (route.name === 'search') setText(route.params.q || '');
  }, [route]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && ['k', 'l', 'f'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!focus || !text.trim()) { setSugs([]); return; }
    const t = setTimeout(() => api.suggest(text).then(setSugs).catch(() => setSugs([])), 140);
    return () => clearTimeout(t);
  }, [text, focus]);

  const submit = (q) => {
    const query = q.trim();
    setSugs([]);
    setHi(-1);
    inputRef.current?.blur();
    if (!query) return go('search', {});
    setText(query);
    if (route.name === 'search' && !route.params.q) replace({ q: query });
    else go('search', { q: query });
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(sugs.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(-1, h - 1)); }
    else if (e.key === 'Enter') submit(hi >= 0 ? sugs[hi] : text);
    else if (e.key === 'Escape') inputRef.current?.blur();
  };

  return (
    <header className="topbar">
      <div className="tb-nav">
        <button className="icon-btn circle glass" disabled={!canBack} onClick={back} aria-label="뒤로"><ChevronLeft size={19} /></button>
        <button className="icon-btn circle glass" disabled={!canFwd} onClick={forward} aria-label="앞으로"><ChevronRight size={19} /></button>
      </div>
      <div className={`searchbox ${focus ? 'focus' : ''}`}>
        <Search size={18} className="sb-icon" onClick={() => submit(text)} />
        <input
          ref={inputRef}
          value={text}
          placeholder="노래, 아티스트, 앨범 검색"
          onChange={(e) => { setText(e.target.value); setHi(-1); }}
          onFocus={() => { setFocus(true); if (route.name !== 'search' && !text) go('search', {}); }}
          onBlur={() => setTimeout(() => setFocus(false), 120)}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
        {text ? (
          <button className="icon-btn sb-clear" onClick={() => { setText(''); inputRef.current?.focus(); }} aria-label="지우기"><X size={16} /></button>
        ) : (
          <kbd className="sb-kbd">Ctrl K</kbd>
        )}
        {focus && sugs.length > 0 && (
          <ul className="suggestions">
            {sugs.map((s, i) => (
              <li key={s} className={i === hi ? 'hi' : ''} onMouseDown={() => submit(s)}>
                <Search size={14} /> {s}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="tb-right">
        <DownloadPill />
        <button className={`icon-btn circle glass ${panelOpen ? 'on' : ''}`} onClick={togglePanel} title="지금 재생 중 패널"><PanelRight size={17} /></button>
        <button className={`icon-btn circle glass ${route.name === 'settings' ? 'on' : ''}`} onClick={() => go('settings')} title="설정"><Settings size={17} /></button>
      </div>
    </header>
  );
}

