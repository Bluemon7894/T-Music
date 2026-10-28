import { useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { api } from '../api.js';
import { usePlayer } from '../store/player.js';
import { useLibrary } from '../store/library.js';
import { toast } from '../store/ui.js';
import { useAsync, PlayButton, Loading, ErrorMsg } from '../components/common.jsx';
import TrackList from '../components/TrackList.jsx';
import { Shelf } from '../components/Cards.jsx';
import { colorFor } from '../util.js';

export default function Artist({ id }) {
  const res = useAsync(() => api.artist(id), [id]);
  const [more, setMore] = useState(false);
  const following = useLibrary((s) => s.followed.some((a) => a.id === id));
  const toggleFollow = useLibrary((s) => s.toggleFollow);
  const playing = usePlayer((s) => s.playing);
  const ctxName = usePlayer((s) => s.context?.name);
  if (res.loading && !res.data) return <Loading />;
  if (res.error) return <ErrorMsg error={res.error} />;
  const a = res.data;
  const context = { name: a.name };
  const isThis = ctxName === a.name;

  return (
    <div className="page artist">
      <div className="artist-hero" style={{ '--hdr': colorFor(a.id), backgroundImage: a.thumb ? `url("${a.thumb}")` : undefined }}>
        <div className="artist-hero-shade" />
        <div className="artist-hero-text">
          <span className="verified"><BadgeCheck size={20} fill="#3d91f4" color="#fff" /> 아티스트</span>
          <h1 className={a.name.length > 14 ? 'long' : ''}>{a.name}</h1>
          {a.subscribers && <span className="listeners">구독자 {a.subscribers}명</span>}
        </div>
      </div>
      <div className="page-body">
        <div className="action-bar">
          <PlayButton size={56} playing={isThis && playing} onClick={() => (isThis ? usePlayer.getState().toggle() : usePlayer.getState().playList(a.songs, 0, context))} />
          <button className={`pill outline ${following ? 'on' : ''}`} onClick={() => { toggleFollow(a); toast(following ? '팔로우를 취소했습니다' : '팔로우했습니다'); }}>
            {following ? '팔로잉' : '팔로우하기'}
          </button>
        </div>
        {a.songs.length > 0 && (
          <section>
            <h2>인기</h2>
            <TrackList tracks={more ? a.songs : a.songs.slice(0, 5)} context={context} showAlbum={false} compact />
            {a.songs.length > 5 && <button className="text-btn" onClick={() => setMore(!more)}>{more ? '간단히 보기' : '자세히 보기'}</button>}
          </section>
        )}
        {a.sections.map((s) => <Shelf key={s.title} title={s.title} items={s.items} />)}
        {a.description && (
          <section className="about">
            <h2>정보</h2>
            <p>{a.description}</p>
          </section>
        )}
      </div>
    </div>
  );
}
