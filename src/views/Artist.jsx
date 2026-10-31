import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { BadgeCheck, Radio, Shuffle } from 'lucide-react';
import { api } from '../lib/api.js';
import { usePlayer } from '../store/player.js';
import { useLibrary } from '../store/library.js';
import { toast } from '../store/ui.js';
import { useAsync, PlayButton, PageSkeleton, ErrorMsg } from '../components/common.jsx';
import TrackList, { startRadio } from '../components/TrackList.jsx';
import { DownloadAllButton } from '../components/DownloadButton.jsx';
import { Shelf } from '../components/Cards.jsx';
import { colorFor } from '../lib/util.js';
import { useEnter, animate } from '../lib/motion.js';
import { tr } from '../lib/i18n.js';

// Long enough to get cut off, it offers the rest. Short text just shows.
function AboutText({ text }) {
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    const el = box.current;
    if (!el || open) return undefined;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    return () => seen.disconnect();
  }, [text, open]);

  return (
    <div className="about-body">
      <p ref={box} className={open ? 'open' : ''}>{text}</p>
      {(cut || open) && <button className="text-btn about-more" onClick={() => setOpen(!open)}>{open ? tr('간단히 보기') : tr('더 보기')}</button>}
    </div>
  );
}

export default function Artist({ id }) {
  const res = useAsync(() => api.artist(id), [id]);
  const [more, setMore] = useState(false);
  const following = useLibrary((s) => s.followed.some((a) => a.id === id));
  const toggleFollow = useLibrary((s) => s.toggleFollow);
  const playing = usePlayer((s) => s.playing);
  const ctxName = usePlayer((s) => s.context?.name);
  const ref = useRef(null);
  const hero = useRef(null);
  useEnter(ref, [res.data ? 1 : 0]);

  // Slow parallax push-in on the hero image.
  useLayoutEffect(() => {
    const img = hero.current?.querySelector('.artist-hero-img');
    if (img) animate(img, { scale: [1.18, 1.04], opacity: [0, 1], duration: 1400, ease: 'out(3)' });
  }, [res.data?.id]);

  if (res.loading && !res.data) return <PageSkeleton />;
  if (res.error) return <ErrorMsg error={res.error} onRetry={res.retry} />;
  const a = res.data;
  const context = { name: a.name };
  const isThis = ctxName === a.name;

  return (
    <div className="page artist" ref={ref} style={{ '--hdr': colorFor(a.id) }}>
      <div className="artist-hero" ref={hero}>
        <div className="artist-hero-img" style={{ backgroundImage: a.thumb ? `url("${a.thumb}")` : undefined }} />
        <div className="artist-hero-shade" />
        <div className="artist-hero-text">
          <span className="verified" data-enter><BadgeCheck size={18} />{' '}{tr('아티스트')}</span>
          <h1 className={a.name.length > 14 ? 'long' : ''} data-enter>{a.name}</h1>
          {a.subscribers && <span className="listeners" data-enter>{tr('구독자 {0}명', a.subscribers)}</span>}
        </div>
      </div>
      <div className="page-body">
        <div className="action-bar" data-enter>
          <PlayButton size={58} playing={isThis && playing} onClick={() => (isThis ? usePlayer.getState().toggle() : usePlayer.getState().playList(a.songs, 0, context))} />
          <button className="icon-btn big" title={tr('셔플 재생')} onClick={() => { const p = usePlayer.getState(); if (!p.shuffle) p.toggleShuffle(); p.playList(a.songs, Math.floor(Math.random() * a.songs.length), context); }}><Shuffle size={24} /></button>
          {a.songs[0] && <button className="icon-btn big" title={tr('아티스트 라디오')} onClick={() => startRadio(a.songs[0])}><Radio size={24} /></button>}
          <DownloadAllButton tracks={a.songs} />
          <button className={`btn outline ${following ? 'on' : ''}`} onClick={() => { toggleFollow(a); toast(following ? tr('팔로우를 취소했습니다') : tr('팔로우했습니다')); }}>
            {following ? tr('팔로잉') : tr('팔로우')}
          </button>
        </div>
        <div className="artist-grid">
          {a.songs.length > 0 && (
            <section className="artist-top" data-enter>
              <h2>{tr('인기 곡')}</h2>
              <TrackList tracks={more ? a.songs : a.songs.slice(0, 5)} context={context} showAlbum={false} compact animate={false} />
              {a.songs.length > 5 && <button className="text-btn" onClick={() => setMore(!more)}>{more ? tr('간단히 보기') : tr('더 보기')}</button>}
            </section>
          )}
          {a.description && (
            <section className="about" data-enter>
              <h2>{tr('소개')}</h2>
              <div className="about-card" style={{ backgroundImage: a.thumb ? `url("${a.thumb}")` : undefined }}>
                <div className="about-shade" />
                <AboutText text={a.description} />
              </div>
            </section>
          )}
        </div>
        {a.sections.map((s) => <Shelf key={s.title} title={s.title} items={s.items} />)}
      </div>
    </div>
  );
}

