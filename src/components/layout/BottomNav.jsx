import { Home, Search, Library, Settings as SettingsIcon } from 'lucide-react';
import { useNav, useRoute } from '../../store/nav.js';

const TABS = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'search', label: '둘러보기', icon: Search },
  { id: 'library', label: '보관함', icon: Library },
  { id: 'settings', label: '설정', icon: SettingsIcon },
];

export default function BottomNav() {
  const route = useRoute();
  const go = useNav((s) => s.go);

  const activeId = (() => {
    if (['liked', 'local', 'downloads'].includes(route.name)) return 'library';
    if (['artist', 'album', 'playlist'].includes(route.name)) return 'search';
    return route.name || 'home';
  })();

  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeId === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            className={`bottom-nav-item ${isActive ? 'active' : ''}`}
            onClick={() => go(tab.id, {})}
            aria-label={tab.label}
          >
            <div className="bottom-nav-icon-wrap">
              <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8} />
              {isActive && <span className="bottom-nav-dot" />}
            </div>
            <span className="bottom-nav-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
