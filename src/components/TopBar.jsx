import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Home, Search, X, Settings } from 'lucide-react';
import { useNav, useRoute } from '../store/nav.js';
import { api } from '../api.js';

export default function TopBar() {
  const { go, back, forward, replace } = useNav();
  const canBack = useNav((s) => s.index > 0);
  const canFwd = useNav((s) => s.index < s.stack.length - 1);
  const route = useRoute();
  const [text, setText] = useState('');
  const [sugs, setSugs] = useState([]);
  const [focus, setFocus] = useState(false);
  const [hi, setHi] = useState(-1);
  const inputRef = useRef(null);

  // Keep the box in sync when navigating back to an earlier search.
  useEffect(() => {
    if (route.name === 'search') setText(route.params.q || '');
  }, [route]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (e.ctrlKey && e.key.toLowerCase() === 'l')) {
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
    const t = setTimeout(() => api.suggest(text).then(setSugs).catch(() => setSugs([])), 150);
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
      <div className="topbar-left">
        <div className="brand">T-Music</div>
        <button className="icon-btn circle dark" disabled={!canBack} onClick={back} aria-label="뒤로"><ChevronLeft size={20} /></button>
        <button className="icon-btn circle dark" disabled={!canFwd} onClick={forward} aria-label="앞으로"><ChevronRight size={20} /></button>
      </div>
      <div className="topbar-center">
        <button className={`icon-btn circle home-btn ${route.name === 'home' ? 'on' : ''}`} onClick={() => go('home')} aria-label="홈"><Home size={22} /></button>
        <div className={`searchbox ${focus ? 'focus' : ''}`}>
          <Search size={20} className="sb-icon" onClick={() => submit(text)} />
          <input
            ref={inputRef}
            value={text}
            placeholder="어떤 곡을 재생하고 싶으세요?"
            onChange={(e) => { setText(e.target.value); setHi(-1); }}
            onFocus={() => { setFocus(true); if (route.name !== 'search' && !text) go('search', {}); }}
            onBlur={() => setTimeout(() => setFocus(false), 120)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
          {text && <button className="icon-btn sb-clear" onClick={() => { setText(''); inputRef.current?.focus(); }} aria-label="지우기"><X size={18} /></button>}
          {focus && sugs.length > 0 && (
            <ul className="suggestions">
              {sugs.map((s, i) => (
                <li key={s} className={i === hi ? 'hi' : ''} onMouseDown={() => submit(s)}>
                  <Search size={15} /> {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="topbar-right">
        <button className="icon-btn circle dark" onClick={() => go('settings')} aria-label="설정"><Settings size={18} /></button>
      </div>
    </header>
  );
}
