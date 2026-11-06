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

// Tamil whatever language the site is showing, for messages to customers.
export function tamil(text, vars) {
  if (typeof text !== 'string') return fill(String(text ?? ''), vars);
  if (TA[text]) return fill(TA[text], vars);
  for (const [pattern, ta] of PATTERNS) {
    const m = text.match(pattern);
    if (m) return ta.replace(/\$(\d)/g, (_, i) => tamil(m[i]));
  }
  return fill(text, vars);
}

// Translates a fixed text, or a message from the server. Unknown text stays as it is.
export const t = (text, vars) => (lang === 'ta' ? tamil(text, vars) : fill(String(text ?? ''), vars));

export const plural = (n, word) => (lang === 'ta' ? `${n} ${TA[word] || word}` : `${n} ${word}${n === 1 ? '' : 's'}`);
