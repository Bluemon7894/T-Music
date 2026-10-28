import { create } from 'zustand';

export const useUI = create((set, get) => ({
  menu: null, // { x, y, items: [{ label, onClick, icon, submenu }] }
  openMenu(e, items) {
    e.preventDefault();
    e.stopPropagation();
    set({ menu: { x: e.clientX, y: e.clientY, items } });
  },
  closeMenu() { set({ menu: null }); },

  toast: null,
  showToast(text) {
    const id = Date.now();
    set({ toast: { text, id } });
    setTimeout(() => { if (get().toast?.id === id) set({ toast: null }); }, 2600);
  },

  dialog: null, // { title, value, placeholder, onSubmit }
  prompt(opts) { set({ dialog: opts }); },
  closeDialog() { set({ dialog: null }); },

  queueOpen: false,
  toggleQueue() { set((s) => ({ queueOpen: !s.queueOpen })); },
}));

export const toast = (text) => useUI.getState().showToast(text);
