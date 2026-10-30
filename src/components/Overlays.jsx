import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { useUI } from '../store/ui.js';
import { animate, ease } from '../lib/motion.js';

function MenuItem({ it, index, parentRef, open, setOpen, onClose }) {
  const itemRef = useRef(null);
  const closeTimerRef = useRef(null);
  const Icon = it.icon;
  const hasSub = Array.isArray(it.submenu) && it.submenu.length > 0;
  const isOpen = open === index;

  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (hasSub) {
      setOpen(index);
    } else {
      setOpen(-1);
    }
  };

  const handleMouseLeave = () => {
    if (hasSub && isOpen) {
      closeTimerRef.current = setTimeout(() => {
        setOpen((curr) => (curr === index ? -1 : curr));
      }, 250);
    }
  };

  const handleClick = (e) => {
    e.stopPropagation();
    if (hasSub) {
      setOpen(isOpen ? -1 : index);
      return;
    }
    onClose();
    it.onClick?.();
  };

  return (
    <div
      ref={itemRef}
      className={`ctx-item ${isOpen ? 'open' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {Icon ? <Icon size={16} /> : <span style={{ width: 16 }} />}
      <span className="ctx-label">{it.label}</span>
      {hasSub && <ChevronRight size={16} />}
      {hasSub && isOpen && (
        <PortalSubMenu
          itemRef={itemRef}
          parentRef={parentRef}
          items={it.submenu}
          onClose={onClose}
          onKeepOpen={() => {
            if (closeTimerRef.current) {
              clearTimeout(closeTimerRef.current);
              closeTimerRef.current = null;
            }
          }}
        />
      )}
    </div>
  );
}

function PortalSubMenu({ itemRef, parentRef, items, onClose, onKeepOpen }) {
  const [coords, setCoords] = useState(null);

  useLayoutEffect(() => {
    if (!itemRef.current || !parentRef.current) return;
    const parentRect = parentRef.current.getBoundingClientRect();
    const itemRect = itemRef.current.getBoundingClientRect();
    setCoords({
      x: parentRect.right - 2,
      y: itemRect.top - 4,
      subWidth: parentRect.width,
    });
  }, [itemRef, parentRef]);

  if (!coords) return null;

  return createPortal(
    <div
      onMouseEnter={onKeepOpen}
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'relative', zIndex: 350 }}
    >
      <MenuList
        items={items}
        x={coords.x}
        y={coords.y}
        onClose={onClose}
        sub={{ width: coords.subWidth }}
      />
    </div>,
    document.body
  );
}

function MenuList({ items, x, y, onClose, sub }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [open, setOpen] = useState(-1);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + r.width > window.innerWidth - 8) left = sub ? x - r.width - (sub.width || 0) + 4 : window.innerWidth - r.width - 8;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
    animate(ref.current, { opacity: [0, 1], scale: [0.94, 1], translateY: [-6, 0], ease: ease.snap });
  }, [x, y, sub]);

  return (
    <div className="ctx-menu" ref={ref} style={pos} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if (it.divider) return <div key={i} className="ctx-div" />;
        return (
          <MenuItem
            key={i}
            it={it}
            index={i}
            parentRef={ref}
            open={open}
            setOpen={setOpen}
            onClose={onClose}
          />
        );
      })}
    </div>
  );
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
