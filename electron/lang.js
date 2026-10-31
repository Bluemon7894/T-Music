// The window tells us its language, for the few things the main process puts on screen itself.
let language = 'ko';

export function setLanguage(next) {
  language = next === 'en' ? 'en' : 'ko';
}

export const say = (ko, en) => (language === 'en' ? en : ko);
