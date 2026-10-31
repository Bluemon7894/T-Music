import { create } from 'zustand';

const savedPanel = (() => { try { return localStorage.getItem('t-music-panel') !== '0'; } catch { return true; } })();

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

  dialog: null, // { title, value, placeholder, onSubmit }, or { title, message, onSubmit } to just confirm
  prompt(opts) { set({ dialog: opts }); },
  closeDialog() { set({ dialog: null }); },

  panelOpen: savedPanel, // right "now playing" panel
  togglePanel() {
    const panelOpen = !get().panelOpen;
    set({ panelOpen });
    try { localStorage.setItem('t-music-panel', panelOpen ? '1' : '0'); } catch { /* ignore */ }
  },
  panelTab: 'next', // next | queue
  setPanelTab(panelTab) { set({ panelTab, panelOpen: true }); },

  stage: false, // fullscreen now-playing
  setStage(stage) { set({ stage }); },
}));

export const toast = (text) => useUI.getState().showToast(text);
