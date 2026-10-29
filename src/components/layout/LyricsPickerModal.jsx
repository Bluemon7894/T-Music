import { useState, useEffect, useRef } from 'react';
import { X, Search, Mic2, Check, Music2, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api.js';
import { fmtTime } from '../../lib/util.js';

export default function LyricsPickerModal({ track, currentData, onSelect, onClose }) {
  const [query, setQuery] = useState(() => {
    const artist = Array.isArray(track?.artists) ? track.artists[0]?.name : track?.artist || '';
    const title = track?.rawTitle || track?.title || '';
    return [title, artist].filter(Boolean).join(' ');
  });
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState([]);
  const [applyingId, setApplyingId] = useState(null);
  const inputRef = useRef(null);
  const modalRef = useRef(null);

  const fetchCandidates = async (searchQuery) => {
    if (!track?.id) return;
    setLoading(true);
    try {
      const list = await api.lyricsCandidates(track, searchQuery);
      setCandidates(Array.isArray(list) ? list : []);
    } catch {
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCandidates('');
  }, [track?.id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSearch = (e) => {
    e?.preventDefault();
    fetchCandidates(query.trim());
  };

  const handleApply = async (cand) => {
    if (!cand?.data || !track?.id) return;
    setApplyingId(cand.id);
    try {
      await api.setCustomLyrics(track.id, cand.data);
      window.dispatchEvent(new CustomEvent('t-music:lyrics-changed', {
        detail: { trackId: track.id, lyrics: cand.data },
      }));
      onSelect?.(cand.data);
      onClose();
    } catch (e) {
      console.error('Failed to set custom lyrics', e);
    } finally {
      setApplyingId(null);
    }
  };

  const isCurrentLyrics = (cand) => {
    if (cand.isCurrent) return true;
    if (!currentData) return false;
    if (cand.hasSynced && currentData.syncedLyrics && cand.data.syncedLyrics === currentData.syncedLyrics) return true;
    if (!cand.hasSynced && currentData.plainLyrics && cand.data.plainLyrics === currentData.plainLyrics) return true;
    return false;
  };

  return (
    <div className="lyrics-picker-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lyrics-picker-modal" ref={modalRef} role="dialog" aria-modal="true">
        <div className="lyrics-picker-header">
          <div className="lyrics-picker-title">
            <Mic2 size={20} className="lyrics-picker-icon" />
            <div>
              <h3>다른 가사 선택</h3>
              <p className="lyrics-picker-subtitle">
                {track?.title} · {track?.artists?.map((a) => a.name).join(', ')}
              </p>
            </div>
          </div>
          <button className="icon-btn circle glass lyrics-picker-close" onClick={onClose} title="닫기 (Esc)">
            <X size={18} />
          </button>
        </div>

        <form className="lyrics-picker-search-bar" onSubmit={handleSearch}>
          <div className="lyrics-picker-search-input-wrap">
            <Search size={16} className="lyrics-picker-search-icon" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="곡명 또는 가수명을 검색해 보세요..."
              className="lyrics-picker-input"
            />
            {query && (
              <button
                type="button"
                className="lyrics-picker-clear-btn"
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                title="지우기"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button type="submit" className="lyrics-picker-submit-btn" disabled={loading}>
            {loading ? <RefreshCw size={15} className="spin" /> : '검색'}
          </button>
        </form>

        <div className="lyrics-picker-body">
          {loading ? (
            <div className="lyrics-picker-sk">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="lyrics-picker-sk-item">
                  <div className="sk" style={{ width: '30%', height: '18px' }} />
                  <div className="sk" style={{ width: '70%', height: '14px', marginTop: '6px' }} />
                  <div className="sk" style={{ width: '90%', height: '14px', marginTop: '4px' }} />
                </div>
              ))}
            </div>
          ) : candidates.length === 0 ? (
            <div className="lyrics-picker-empty">
              <Music2 size={38} opacity={0.35} />
              <p>검색된 다른 가사가 없습니다.</p>
              <small>곡 제목이나 아티스트명을 직접 입력하여 검색해 보세요.</small>
            </div>
          ) : (
            <div className="lyrics-picker-list">
              {candidates.map((cand) => {
                const current = isCurrentLyrics(cand);
                const isSync = cand.hasSynced;
                return (
                  <div key={cand.id} className={`lyrics-cand-card ${current ? 'active' : ''}`}>
                    <div className="lyrics-cand-info">
                      <div className="lyrics-cand-top">
                        <span className={`lyrics-badge ${isSync ? 'synced' : cand.source.includes('YouTube') ? 'ytm' : cand.source.includes('네이버') ? 'naver' : 'plain'}`}>
                          {cand.source}
                        </span>
                        {cand.duration > 0 && (
                          <span className="lyrics-cand-duration">
                            {fmtTime(cand.duration)}
                          </span>
                        )}
                        {cand.lineCount > 0 && (
                          <span className="lyrics-cand-lines">
                            {cand.lineCount}줄
                          </span>
                        )}
                      </div>
                      <div className="lyrics-cand-title">
                        <b>{cand.trackName || track?.title}</b>
                        {cand.artistName && <span> · {cand.artistName}</span>}
                        {cand.albumName && <small className="lyrics-cand-album"> ({cand.albumName})</small>}
                      </div>
                      {cand.preview && (
                        <p className="lyrics-cand-preview">
                          “{cand.preview}”
                        </p>
                      )}
                    </div>
                    <div className="lyrics-cand-action">
                      {current ? (
                        <span className="lyrics-cand-active-badge">
                          <Check size={14} /> 현재 적용됨
                        </span>
                      ) : (
                        <button
                          className="lyrics-cand-apply-btn"
                          onClick={() => handleApply(cand)}
                          disabled={applyingId === cand.id}
                        >
                          {applyingId === cand.id ? <RefreshCw size={14} className="spin" /> : '적용'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
