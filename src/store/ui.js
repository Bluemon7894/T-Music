import { create } from 'zustand';

const savedPanel = (() => { try { return localStorage.getItem('t-music-panel') !== '0'; } catch { return true; } })();

// The widest either bar goes is what the layout was drawn for: wider only squeezes the page.
export const SIDE = { min: 200, max: 264, rail: 76 };
export const PANEL = { min: 280, max: 336 };
const LAYOUT_KEY = 't-music-layout';
const savedLayout = (() => { try { return JSON.parse(localStorage.getItem(LAYOUT_KEY)) || {}; } catch { return {}; } })();
const within = (value, { min, max }) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : max);

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
  sideOpen: savedLayout.sideOpen !== false,
  sideWidth: within(savedLayout.sideWidth, SIDE),
  panelWidth: within(savedLayout.panelWidth, PANEL),
  toggleSide() {
    set({ sideOpen: !get().sideOpen });
    get().saveLayout();
  },
  setBarWidth(bar, width) {
    if (bar === 'side') set({ sideWidth: within(width, SIDE) });
    else set({ panelWidth: within(width, PANEL) });
    get().saveLayout();
  },
  saveLayout() {
    const { sideOpen, sideWidth, panelWidth } = get();
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ sideOpen, sideWidth, panelWidth })); } catch { /* it still applies this session */ }
  },
  panelTab: 'next', // next | queue
  setPanelTab(panelTab) { set({ panelTab, panelOpen: true }); },

  stage: false, // fullscreen now-playing
  setStage(stage) { set({ stage }); },

  mini: false, // the window shrunk to a small always-on-top player
  setMini(mini) { set({ mini, ...(mini ? { stage: false } : {}) }); },
}));

export const toast = (text) => useUI.getState().showToast(text);
