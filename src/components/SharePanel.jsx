import { useState } from 'react';
import { Link2, Share2, Users, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { auth } from '../lib/firebase.js';
import { setPlaylistEditable, shareLink, sharePlaylist, stopSharing } from '../lib/sharedPlaylists.js';
import { toast } from '../store/ui.js';

export default function SharePanel({ playlist }) {
  const [busy, setBusy] = useState(false);
  const { share } = playlist;
  const isOwner = !share || share.ownerUid === auth.currentUser?.uid;

  const copy = async (id) => {
    await api.copyText(shareLink(id));
    toast('공유 링크를 복사했습니다');
  };

  const run = async (work, failure) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      console.warn('[share]', e?.code || e);
      toast(failure);
    } finally {
      setBusy(false);
    }
  };

  if (!auth.currentUser) return null;

  if (!share) {
    return (
      <div className="share-panel">
        <button className="btn" disabled={busy} onClick={() => run(async () => copy(await sharePlaylist(playlist.id)), '공유하지 못했습니다')}>
          <Share2 size={15} /> 링크로 공유
        </button>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="share-panel">
        <span className="share-note"><Users size={14} /> {share.ownerName || '다른 사용자'}님의 공유 플레이리스트 · {share.editable ? '같이 편집 가능' : '보기만 가능'}</span>
        <button className="btn" onClick={() => copy(share.id)}><Link2 size={15} /> 링크 복사</button>
      </div>
    );
  }

  return (
    <div className="share-panel">
      <span className="share-note"><Share2 size={14} /> 링크를 가진 사람은 누구나 볼 수 있어요</span>
      <button className="btn" onClick={() => copy(share.id)}><Link2 size={15} /> 링크 복사</button>
      <div className="seg">
        <button className={!share.editable ? 'on' : ''} disabled={busy} onClick={() => run(() => setPlaylistEditable(share.id, false), '변경하지 못했습니다')}>보기만</button>
        <button className={share.editable ? 'on' : ''} disabled={busy} onClick={() => run(() => setPlaylistEditable(share.id, true), '변경하지 못했습니다')}>같이 편집</button>
      </div>
      <button className="btn" disabled={busy} onClick={() => run(() => stopSharing(share.id), '공유를 끝내지 못했습니다')}><X size={15} /> 공유 끝내기</button>
    </div>
  );
}
