import { useState } from 'react';
import { Link2, Share2, Users, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { auth } from '../lib/firebase.js';
import { setPlaylistEditable, shareLink, sharePlaylist, stopSharing } from '../lib/sharedPlaylists.js';
import { toast, useUI } from '../store/ui.js';
import { IS_ANDROID } from '../lib/platform.js';
import { tr } from '../lib/i18n.js';

export default function SharePanel({ playlist }) {
  const [busy, setBusy] = useState(false);
  const { share } = playlist;
  const isOwner = !share || share.ownerUid === auth.currentUser?.uid;

  const copy = async (id) => {
    await api.copyText(shareLink(id));
    toast(tr('공유 링크를 복사했습니다'));
  };

  // Sharing for the first time: on a phone the link goes straight to the share sheet as well.
  const startSharing = async () => {
    const id = await sharePlaylist(playlist.id);
    await copy(id);
    if (IS_ANDROID) api.shareText(shareLink(id));
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
        <button className="btn" disabled={busy} onClick={() => run(startSharing, tr('공유하지 못했습니다'))}>
          <Share2 size={15} />{' '}{tr('링크로 공유')}</button>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="share-panel">
        <span className="share-note"><Users size={14} /> {share.ownerName || tr('다른 사용자')}{tr('님의 공유 플레이리스트 ·')}{' '}{share.editable ? tr('같이 편집 가능') : tr('보기만 가능')}</span>
        <button className="btn" onClick={() => copy(share.id)}><Link2 size={15} />{' '}{tr('링크 복사')}</button>
      </div>
    );
  }

  return (
    <div className="share-panel">
      <span className="share-note"><Share2 size={14} />{' '}{tr('링크를 가진 사람은 누구나 볼 수 있어요')}</span>
      <button className="btn" onClick={() => copy(share.id)}><Link2 size={15} />{' '}{tr('링크 복사')}</button>
      <div className="seg">
        <button className={!share.editable ? 'on' : ''} disabled={busy} onClick={() => run(() => setPlaylistEditable(share.id, false), tr('변경하지 못했습니다'))}>{tr('보기만')}</button>
        <button className={share.editable ? 'on' : ''} disabled={busy} onClick={() => run(() => setPlaylistEditable(share.id, true), tr('변경하지 못했습니다'))}>{tr('같이 편집')}</button>
      </div>
      <button
        className="btn"
        disabled={busy}
        onClick={() => useUI.getState().prompt({
          title: tr('공유를 끝낼까요?'),
          message: tr('링크가 더 이상 열리지 않고, 받은 친구에게는 지금까지의 복사본만 남아요.'),
          submitLabel: tr('공유 끝내기'),
          onSubmit: () => run(() => stopSharing(share.id), tr('공유를 끝내지 못했습니다')),
        })}
      >
        <X size={15} />{' '}{tr('공유 끝내기')}</button>
    </div>
  );
}
