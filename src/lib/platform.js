// Fixed at build time: the desktop build drops every Android-only branch.
export const IS_ANDROID = import.meta.env.MODE === 'android';

// What to call this device in messages.
export const THIS_DEVICE = IS_ANDROID ? '이 기기' : '이 PC';
