import { tr } from './i18n.js';
// Fixed at build time: the desktop build drops every Android-only branch.
export const IS_ANDROID = import.meta.env.MODE === 'android';

// What to call this device in messages.
export const THIS_DEVICE = IS_ANDROID ? tr('이 기기') : tr('이 PC');
