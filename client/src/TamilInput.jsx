import { useEffect, useRef, useState } from 'react';
import { t } from './i18n.js';
import { loadNames, nameToTamil, suggest, toTamil } from './tamilTyping.js';

// A text box that types Tamil from English letters, like the Desh keyboard. While
// a word is typed, a list of Tamil spellings shows under the box (known names first);
// Space or Enter takes the highlighted one, ↑/↓ move, 1–6 or a click picks one.
// "ABC" switches to plain typing (for a Tamil phone keyboard, or a fix by hand).
const TAMIL = /[஀-௿]/;

// Words: { roman } while being typed, { roman, text } once picked, { text } for
// Tamil that was pasted or already there.
// Tamil letters as they are seen: a consonant with its vowel sign or pulli is one.
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ta', { granularity: 'grapheme' }) : null;
const letters = text => (segmenter ? [...segmenter.segment(text)].map(s => s.segment) : [...text]);

const fromValue = value => (value ? value.split(' ').map(text => ({ text })) : [{ roman: '' }]);

export default function TamilInput({ id, value, onChange, englishName, maxLength = 200 }) {
  const box = useRef(null);
  const words = useRef(fromValue(value));
  const [tamilMode, setTamilMode] = useState(() => { try { return localStorage.getItem('tamil-typing') !== 'off'; } catch { return true; } });
  const [current, setCurrent] = useState(''); // English letters of the word being typed
  const [choices, setChoices] = useState([]);
  const [sel, setSel] = useState(0);
  const [focused, setFocused] = useState(false);

  useEffect(() => { loadNames(); }, []);

  const shown = (list, cands, at) => list.map((w, i) => {
    if (w.text !== undefined) return w.text;
    if (!w.roman) return w.pre || '';
    return (w.pre || '') + (i === list.length - 1 ? (cands[at] ?? toTamil(w.roman)) : toTamil(w.roman));
  }).join(' ').slice(0, maxLength);

  // A new value from outside (opening a case to edit, the English-name suggestion).
  useEffect(() => {
    if (shown(words.current, choices, sel) !== value) {
      words.current = fromValue(value);
      setCurrent('');
      setChoices([]);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(next, keepSel = false) {
    words.current = next.length ? next : [{ roman: '' }];
    const last = words.current[words.current.length - 1];
    const typing = last.text === undefined ? last.roman : '';
    const cands = typing ? suggest(typing) : [];
    const at = keepSel ? Math.min(sel, Math.max(cands.length - 1, 0)) : 0;
    setCurrent(typing);
    setChoices(cands);
    setSel(at);
    onChange(shown(words.current, cands, at));
    requestAnimationFrame(() => { const el = box.current; if (el) el.setSelectionRange(el.value.length, el.value.length); });
  }

  const copy = () => words.current.map(w => ({ ...w }));

  // Takes a choice for the word being typed. With `space`, a new word starts.
  function pick(index = sel, space = false) {
    const next = copy();
    const last = next[next.length - 1];
    if (last.text === undefined && last.roman) next[next.length - 1] = { text: (last.pre || '') + (choices[index] ?? toTamil(last.roman)) };
    else if (last.text === undefined && last.pre) next[next.length - 1] = { text: last.pre };
    if (space && (last.text || last.roman)) next.push({ roman: '' });
    update(next);
  }

  function insert(text) {
    let next = copy();
    for (const ch of text) {
      const last = next[next.length - 1];
      if (/\s/.test(ch)) {
        if (last.text === undefined && (last.roman || last.pre)) next[next.length - 1] = { text: (last.pre || '') + (last.roman ? suggest(last.roman)[sel] ?? toTamil(last.roman) : '') };
        if (next[next.length - 1].text) next.push({ roman: '' });
      } else if (TAMIL.test(ch)) {
        if (last.text === undefined && !last.roman) next[next.length - 1] = { text: ch };
        else if (last.text !== undefined && last.roman === undefined) last.text += ch;
        else next.push({ text: ch });
      } else if (/[A-Za-z.'-]/.test(ch)) {
        // Letters typed straight after Tamil (no space) carry on the same word.
        if (last.text !== undefined) next[next.length - 1] = { pre: last.text, roman: ch };
        else last.roman += ch;
      }
    }
    next = next.filter((w, i) => i === next.length - 1 || w.text !== undefined || w.roman);
    update(next);
  }

  function backspace() {
    const next = copy();
    const last = next[next.length - 1];
    // While a word is being typed, Backspace takes back one English letter.
    if (last.text === undefined && last.roman) {
      last.roman = last.roman.slice(0, -1);
      if (!last.roman && last.pre) next[next.length - 1] = { text: last.pre };
    }
    // After a space, it removes the space; the word before stays as it was picked.
    else if (last.text === undefined && next.length > 1) next.pop();
    // In a picked word, it removes the last Tamil letter as it is seen (த, மி, ழ்).
    else if (last.text !== undefined) {
      const left = letters(last.text).slice(0, -1).join('');
      next[next.length - 1] = left ? { text: left } : { roman: '' };
    }
    update(next);
  }

  // beforeinput works for computer keyboards and phone keyboards alike.
  useEffect(() => {
    const el = box.current;
    if (!el || !tamilMode) return undefined;
    const handle = e => {
      if (e.inputType === 'insertText' || e.inputType === 'insertReplacementText' || e.inputType === 'insertFromPaste') {
        const text = e.data ?? e.dataTransfer?.getData('text') ?? '';
        if (!text) return;
        e.preventDefault();
        if (text === ' ' && current) pick(sel, true);
        else insert(text);
      } else if (e.inputType === 'deleteContentBackward') {
        e.preventDefault();
        backspace();
      } else if (e.inputType.startsWith('delete')) {
        e.preventDefault();
        update([{ roman: '' }]);
      }
    };
    // Phone keyboards that build a whole word first can't be stopped letter by
    // letter, so the finished word is taken when they hand it over.
    const composed = e => { if (e.data) insert(e.data); };
    el.addEventListener('beforeinput', handle);
    el.addEventListener('compositionend', composed);
    return () => {
      el.removeEventListener('beforeinput', handle);
      el.removeEventListener('compositionend', composed);
    };
  });

  function onKeyDown(e) {
    if (!tamilMode || !current || !choices.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const at = (sel + (e.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
      setSel(at);
      onChange(shown(words.current, choices, at));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (e.key === 'Enter') e.preventDefault(); // Enter takes the word, it doesn't save the form
      pick(sel);
    } else if (/^[1-6]$/.test(e.key) && Number(e.key) <= choices.length) {
      e.preventDefault();
      pick(Number(e.key) - 1, true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // closes the list, not the dialog
      pick(sel);
    }
  }

  function switchMode(on) {
    setTamilMode(on);
    try { localStorage.setItem('tamil-typing', on ? 'on' : 'off'); } catch { /* not remembered */ }
    words.current = fromValue(value);
    setCurrent('');
    setChoices([]);
    box.current?.focus();
  }

  const suggestion = englishName ? nameToTamil(englishName) : '';
  const open = tamilMode && focused && current && choices.length > 0;

  return (
    <div className="tamil-input">
      <div className="tamil-input-row">
        <input
          id={id}
          ref={box}
          lang="ta"
          value={value}
          maxLength={maxLength}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          role={tamilMode ? 'combobox' : undefined}
          aria-expanded={open || undefined}
          aria-controls={open ? `${id}-list` : undefined}
          aria-activedescendant={open ? `${id}-opt-${sel}` : undefined}
          placeholder={tamilMode ? t('Type in English letters: kavitha → கவிதா') : ''}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); if (tamilMode && current) pick(sel); }}
          onKeyDown={onKeyDown}
          onChange={e => { if (!tamilMode) { words.current = fromValue(e.target.value); onChange(e.target.value); } }}
        />
        <div className="seg-pick tamil-mode" role="radiogroup" aria-label={t('Typing')}>
          <button type="button" role="radio" aria-checked={tamilMode} className={tamilMode ? 'on' : ''} onClick={() => switchMode(true)}>அ</button>
          <button type="button" role="radio" aria-checked={!tamilMode} className={!tamilMode ? 'on' : ''} onClick={() => switchMode(false)}>ABC</button>
        </div>
        {open && (
          <ul className="tamil-list" id={`${id}-list`} role="listbox" aria-label={t('Tamil spellings')}>
            <li className="tamil-list-head" aria-hidden="true">{current}</li>
            {choices.map((c, i) => (
              <li
                key={c}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === sel}
                className={i === sel ? 'on' : ''}
                onMouseDown={e => { e.preventDefault(); pick(i, true); }}
              >
                <span className="tamil-list-no">{i + 1}</span>{c}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="tamil-help">
        {tamilMode && <span className="quiet">{t('Space picks the first spelling. ↑ ↓ or 1–6 for another.')}</span>}
        {suggestion && suggestion !== value && !current && (
          <button type="button" className="link-btn tamil-suggest" onClick={() => { words.current = fromValue(suggestion); onChange(suggestion); box.current?.focus(); }}>
            {t('Use {name}', { name: suggestion })}
          </button>
        )}
      </div>
    </div>
  );
}
