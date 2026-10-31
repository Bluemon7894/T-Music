import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RefreshCw, UserRound } from 'lucide-react';
import { useAccount } from '../store/account.js';
import { api } from '../lib/api.js';
import { animate, ease, stagger, useTilt } from '../lib/motion.js';
import logo from '../assets/logo-mark.png';
import { tr } from '../lib/i18n.js';

export function GoogleMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.9 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.9c-.6 3-2.2 5.5-4.8 7.2l7.7 6c4.5-4.2 7.1-10.3 7.1-17.7z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.1 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export function Splash() {
  return (
    <div className="login">
      <div className="aurora"><i className="a1" /><i className="a2" /><i className="a3" /></div>
      <div className="login-drag" />
      <img className="login-splash" src={logo} alt="T-Music" draggable={false} />
    </div>
  );
}

export default function Login() {
  const busy = useAccount((s) => s.busy);
  const error = useAccount((s) => s.error);
  const canContinueOffline = useAccount((s) => s.canContinueOffline);
  const { signInAsGuest, signInWithGoogle, cancelGoogle, continueOffline } = useAccount.getState();
  const [googleReady, setGoogleReady] = useState(true);
  const card = useRef(null);
  const mark = useRef(null);

  useTilt(mark, { max: 16, scale: 1.04 });

  useEffect(() => {
    api.googleAvailable().then(setGoogleReady).catch(() => setGoogleReady(false));
  }, []);

  useLayoutEffect(() => {
    animate(card.current.children, { opacity: [0, 1], translateY: [22, 0], delay: stagger(70), ease: ease.soft });
  }, []);

  const waitingForBrowser = busy === 'google';

  return (
    <div className="login">
      <div className="aurora"><i className="a1" /><i className="a2" /><i className="a3" /></div>
      <div className="login-drag" />
      <main className="login-card" ref={card}>
        <div className="login-mark" ref={mark}><img src={logo} alt="" draggable={false} /></div>
        <h1>T-Music</h1>
        <p className="login-lead">{tr('내 플레이리스트와 좋아요, 청취 기록을 계정에 담아 두세요.')}</p>

        <div className="login-actions">
          {waitingForBrowser ? (
            <div className="login-waiting">
              <RefreshCw size={16} className="spin" />
              <span>{tr('브라우저에서 로그인을 마쳐 주세요')}</span>
              <button className="text-btn" onClick={cancelGoogle}>{tr('취소')}</button>
            </div>
          ) : (
            <button className="login-btn google" onClick={signInWithGoogle} disabled={Boolean(busy) || !googleReady}>
              <GoogleMark />{' '}{tr('Google로 계속하기')}</button>
          )}
          <button className="login-btn guest" onClick={signInAsGuest} disabled={Boolean(busy)}>
            {busy === 'guest' ? <RefreshCw size={17} className="spin" /> : <UserRound size={17} />}{' '}{tr('게스트로 시작하기')}</button>
        </div>

        {!googleReady && <p className="login-note">{tr('구글 로그인이 아직 설정되지 않았습니다.')}</p>}
        {error && <p className="login-error" role="alert">{error}</p>}
        {canContinueOffline && <button className="text-btn" onClick={continueOffline}>{tr('오프라인으로 계속 (다운로드한 곡만 재생)')}</button>}

        <p className="login-note">{tr('게스트로 쓴 기록은 나중에 구글 계정을 연결하면 그대로 이어져요. 연결하지 않고 로그아웃하면 사라져요.')}</p>
      </main>
    </div>
  );
}
