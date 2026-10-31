// Desktop's right-click menu, as a sheet from the bottom of the screen.
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function MobileSheet({ items, onClose }) {
  const [sub, setSub] = useState(null);
  const list = sub ? sub.submenu : items;

  const choose = (item) => {
    if (item.submenu?.length) { setSub(item); return; }
    onClose();
    item.onClick?.();
  };

  return (
    <div className="m-sheet-back" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        <i className="m-sheet-handle" />
        {sub && (
          <button className="m-sheet-item m-sheet-back-item" onClick={() => setSub(null)}>
            <ChevronLeft size={19} />
            <span>{sub.label}</span>
          </button>
        )}
        <div className="m-sheet-list">
          {list.map((item, i) => {
            if (item.divider) return <div key={i} className="ctx-div" />;
            const Icon = item.icon;
            return (
              <button key={i} className="m-sheet-item" onClick={() => choose(item)}>
                {Icon ? <Icon size={19} /> : <span className="m-sheet-blank" />}
                <span>{item.label}</span>
                {item.submenu?.length > 0 && <ChevronRight size={18} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
