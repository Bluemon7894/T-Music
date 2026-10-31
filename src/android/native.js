// The phone side of the app (android/java), and the events it sends back.
export const Native = window.TMusicNative;

const listeners = new Map();

export function onNative(type, listener) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(listener);
  return () => listeners.get(type).delete(listener);
}

window.__tm = {
  onNative(event) {
    for (const listener of listeners.get(event.type) || []) listener(event);
  },
};
