// English is the base language. Tamil text lives in ta.js, keyed by the English text.
import { PATTERNS, TA } from './ta.js';

export const lang = (() => {
  try {
    return localStorage.getItem('lang') === 'ta' ? 'ta' : 'en';
  } catch {
    return 'en';
  }
})();

document.documentElement.lang = lang;

export function setLang(next) {
  try {
    localStorage.setItem('lang', next);
  } catch { /* the choice just won't be remembered */ }
  window.location.reload();
}

const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text);

// Translates a fixed text, or a message from the server. Unknown text stays as it is.
export function t(text, vars) {
  if (lang !== 'ta' || typeof text !== 'string') return fill(String(text ?? ''), vars);
  if (TA[text]) return fill(TA[text], vars);
  for (const [pattern, tamil] of PATTERNS) {
    const m = text.match(pattern);
    if (m) return tamil.replace(/\$(\d)/g, (_, i) => t(m[i]));
  }
  return fill(text, vars);
}

export const plural = (n, word) => (lang === 'ta' ? `${n} ${TA[word] || word}` : `${n} ${word}${n === 1 ? '' : 's'}`);
