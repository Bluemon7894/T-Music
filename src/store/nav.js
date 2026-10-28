import { create } from 'zustand';

// Browser-like history: { name: 'home' | 'search' | 'album' | ..., params }
export const useNav = create((set, get) => ({
  stack: [{ name: 'home', params: {} }],
  index: 0,
  go(name, params = {}) {
    const { stack, index } = get();
    const cur = stack[index];
    if (cur.name === name && JSON.stringify(cur.params) === JSON.stringify(params)) return;
    set({ stack: [...stack.slice(0, index + 1), { name, params }], index: index + 1 });
  },
  // Update the current entry without adding history (e.g. typing in search).
  replace(params) {
    const { stack, index } = get();
    const next = stack.slice();
    next[index] = { ...next[index], params: { ...next[index].params, ...params } };
    set({ stack: next });
  },
  back() { set((s) => ({ index: Math.max(0, s.index - 1) })); },
  forward() { set((s) => ({ index: Math.min(s.stack.length - 1, s.index + 1) })); },
}));

export const useRoute = () => useNav((s) => s.stack[s.index]);
