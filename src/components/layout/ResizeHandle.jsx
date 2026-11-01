// The strip between a side bar and the page. Drag to size it, double-click to fold it away.
import { useRef } from 'react';
import { PANEL, SIDE, useUI } from '../../store/ui.js';
import { tr } from '../../lib/i18n.js';

const FOLD_BELOW = 60; // dragged this far past the narrowest width, the bar folds on release

export default function ResizeHandle({ bar }) {
  const dragging = useRef(false);
  const left = bar === 'side';
  const widthAt = (e) => (left ? e.clientX : window.innerWidth - e.clientX - 12);
  const limits = left ? SIDE : PANEL;

  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const app = e.currentTarget.closest('.app');
    const ui = useUI.getState();
    if (left && !ui.sideOpen) ui.toggleSide();
    dragging.current = true;
    document.documentElement.classList.add('resizing-bars');
    let last = null;
    // Set directly on the page while dragging: sizing a bar shouldn't redraw the whole app every frame.
    const move = (ev) => {
      last = widthAt(ev);
      app.style.setProperty(left ? '--side' : '--panel', `${Math.min(limits.max, Math.max(limits.min, last))}px`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dragging.current = false;
      document.documentElement.classList.remove('resizing-bars');
      if (last === null) return;
      const state = useUI.getState();
      if (last < limits.min - FOLD_BELOW) {
        if (left) state.toggleSide();
        else state.togglePanel();
      } else {
        state.setBarWidth(bar, last);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const fold = () => {
    const state = useUI.getState();
    if (left) state.toggleSide();
    else state.togglePanel();
  };

  return (
    <div
      className={`bar-handle ${left ? 'left' : 'right'}`}
      onPointerDown={down}
      onDoubleClick={fold}
      role="separator"
      aria-orientation="vertical"
      title={tr('드래그해서 크기 조절, 더블클릭해서 접기')}
    />
  );
}
