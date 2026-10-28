import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useUI } from '../store/ui.js';
import { animate, ease } from '../lib/motion.js';

function MenuList({ items, x, y, onClose, sub }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [open, setOpen] = useState(-1);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + r.width > window.innerWidth - 8) left = sub ? x - r.width - (sub.width || 0) : window.innerWidth - r.width - 8;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
    animate(ref.current, { opacity: [0, 1], scale: [0.94, 1], translateY: [-6, 0], ease: ease.snap });
  }, [x, y, sub]);

  return (
    <div className="ctx-menu" ref={ref} style={pos} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if (it.divider) return <div key={i} className="ctx-div" />;
        const Icon = it.icon;
        return (
          <div
            key={i}
            className={`ctx-item ${open === i ? 'open' : ''}`}
            onMouseEnter={(e) => setOpen(it.submenu ? i : -1)}
            onClick={() => { if (it.submenu) return; onClose(); it.onClick?.(); }}
          >
            {Icon ? <Icon size={16} /> : <span style={{ width: 16 }} />}
            <span className="ctx-label">{it.label}</span>
            {it.submenu && <ChevronRight size={16} />}
            {it.submenu && open === i && (
              <SubMenu parent={ref} index={i} items={it.submenu} onClose={onClose} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SubMenu({ parent, index, items, onClose }) {
  const r = parent.current.getBoundingClientRect();
  const row = parent.current.children[index].getBoundingClientRect();
  return <MenuList items={items} x={r.right - 4} y={row.top - 4} onClose={onClose} sub={{ width: r.width }} />;
}

export function ContextMenu() {
  const menu = useUI((s) => s.menu);
  const close = useUI((s) => s.closeMenu);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [menu, close]);
  if (!menu) return null;
  return <MenuList key={menu.x + ':' + menu.y} items={menu.items} x={menu.x} y={menu.y} onClose={close} />;
}

export function Toast() {
  const toast = useUI((s) => s.toast);
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (ref.current) animate(ref.current, { opacity: [0, 1], translateY: [24, 0], scale: [0.9, 1], ease: ease.bouncy });
  }, [toast?.id]);
  if (!toast) return null;
  return <div className="toast" ref={ref} key={toast.id}><span className="toast-dot" />{toast.text}</div>;
}

export function Dialog() {
  const dialog = useUI((s) => s.dialog);
  const close = useUI((s) => s.closeDialog);
  const [value, setValue] = useState('');
  useEffect(() => setValue(dialog?.value || ''), [dialog]);
  if (!dialog) return null;
  const submit = (e) => {
    e.preventDefault();
    close();
    dialog.onSubmit(value);
  };
  return (
    <div className="modal-back" onMouseDown={close}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{dialog.title}</h3>
        <input autoFocus value={value} placeholder={dialog.placeholder} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && close()} />
        <div className="modal-actions">
          <button type="button" className="pill" onClick={close}>취소</button>
          <button type="submit" className="pill white">{dialog.submitLabel || '확인'}</button>
        </div>
      </form>
    </div>
  );
}
