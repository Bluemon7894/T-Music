import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import { api } from './lib/api.js';
import { LANGUAGE } from './lib/i18n.js';
import { IS_ANDROID } from './lib/platform.js';
import './styles/index.css';

// Desktop-only motion is keyed off this (see the end of components.css).
document.documentElement.dataset.platform = IS_ANDROID ? 'android' : 'desktop';

// The same page also draws the quick menu's overlay window (electron/quickMenu.js), which needs none of
// the app: no account, no player, no Firebase.
const root = createRoot(document.getElementById('root'));
if (window.location.hash === '#quick') {
  document.documentElement.classList.add('quick-root');
  import('./components/QuickMenu.jsx').then(({ default: QuickMenu }) => root.render(<QuickMenu />));
} else {
  Promise.resolve(api.setLanguage(LANGUAGE)).catch(() => {});
  import('./App.jsx').then(({ default: App }) => root.render(<App />));
}
