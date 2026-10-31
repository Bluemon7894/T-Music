// The app's language. Korean is the source text and also the key, so anything without a translation
// simply shows as written. The choice is read once at startup: changing it reloads the app, because
// plenty of labels are decided when their module loads.
import en from './i18n-en.js';

const KEY = 't-music-language';

const stored = (() => {
  try { return localStorage.getItem(KEY); } catch { return null; }
})();

export const LANGUAGE = stored === 'en' ? 'en' : 'ko';
export const LANGUAGES = [{ id: 'ko', label: '한국어' }, { id: 'en', label: 'English' }];

document.documentElement.lang = LANGUAGE;

// English needs "1 track", where Korean has one form for any count.
const ONE_OF_MANY = /(^|[^\d.,/])1 (track|line|friend|member|subscriber)s\b/g;

// tr('{0}곡', count). `{0}`, `{1}` stand for the arguments, in whatever order the language needs them.
export function tr(text, ...args) {
  const shown = LANGUAGE === 'en' ? en[text] ?? text : text;
  if (!args.length) return shown;
  const filled = shown.replace(/\{(\d+)\}/g, (_, i) => args[i]);
  return LANGUAGE === 'en' ? filled.replace(ONE_OF_MANY, (_, before, noun) => `${before}1 ${noun}`) : filled;
}

export function setLanguage(next) {
  if (next === LANGUAGE) return;
  try { localStorage.setItem(KEY, next); } catch { return; }
  window.location.reload();
}
