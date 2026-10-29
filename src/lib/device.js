// Device & Platform detection utility
export const isElectron = Boolean(
  typeof window !== 'undefined' &&
  (window.api?.isElectron ||
   window.process?.type ||
   navigator.userAgent.includes('Electron'))
);

export const isAndroid = Boolean(
  typeof window !== 'undefined' &&
  (navigator.userAgent.includes('Android') ||
   window.Capacitor?.getPlatform() === 'android')
);

export function isMobileScreen() {
  if (typeof window === 'undefined') return false;
  return isAndroid ||
    window.innerWidth <= 768 ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}
