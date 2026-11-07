// The equalizer's settings. They belong to this device: what sounds right depends on its speakers or
// headphones, so they aren't synced or shared in a room. Only music goes through it; the radio plays
// past it (see the radio player).
import { create } from 'zustand';
import { setEqualizer } from '../lib/audio.js';
import { tr } from '../lib/i18n.js';

const KEY = 't-music-eq';

export const EQ_PRESETS = [
  { id: 'flat', label: tr('기본'), gains: [0, 0, 0, 0, 0] },
  { id: 'bass', label: tr('저음 강조'), gains: [6, 3, 0, 0, 0] },
  { id: 'vocal', label: tr('보컬'), gains: [-2, -1, 3, 3, 1] },
  { id: 'treble', label: tr('고음 강조'), gains: [0, 0, 0, 3, 6] },
  { id: 'acoustic', label: tr('어쿠스틱'), gains: [3, 1, 1, 2, 3] },
  { id: 'electronic', label: tr('일렉트로닉'), gains: [5, 2, -1, 2, 4] },
  // Ears hear less of the lows and highs when it's quiet, so this brings them back.
  { id: 'night', label: tr('밤에 듣기'), gains: [5, 1, 0, 1, 4] },
];
export const EQ_LABELS = [tr('저음'), tr('중저음'), tr('중음'), tr('중고음'), tr('고음')];

const saved = (() => {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
})();

const validGains = (g) => Array.isArray(g) && g.length === 5 && g.every((n) => Number.isFinite(n));

export const useEqualizer = create((set, get) => {
  const persist = () => {
    const { enabled, preset, gains } = get();
    setEqualizer(enabled ? gains : null);
    try { localStorage.setItem(KEY, JSON.stringify({ enabled, preset, gains })); } catch { /* applies this session */ }
  };
  return {
    enabled: saved.enabled === true,
    preset: typeof saved.preset === 'string' ? saved.preset : 'flat',
    gains: validGains(saved.gains) ? saved.gains : [0, 0, 0, 0, 0],

    toggle() {
      set({ enabled: !get().enabled });
      persist();
    },
    choosePreset(id) {
      const p = EQ_PRESETS.find((x) => x.id === id);
      if (!p) return;
      set({ preset: id, gains: p.gains.slice(), enabled: true });
      persist();
    },
    // Moving a slider makes it a custom curve.
    setBand(i, db) {
      const gains = get().gains.slice();
      gains[i] = Math.round(Math.max(-12, Math.min(12, db)));
      set({ gains, preset: 'custom', enabled: true });
      persist();
    },
  };
});

const s = useEqualizer.getState();
setEqualizer(s.enabled ? s.gains : null);
