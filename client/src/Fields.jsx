import { useEffect, useRef, useState } from 'react';
import { t } from './i18n.js';

export function Field({ id, label, error, ...props }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} aria-invalid={!!error} {...props} />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function PasswordField({ id, label, error, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw">
        <input id={id} name={id} type={show ? 'text' : 'password'} aria-invalid={!!error} {...props} />
        <button type="button" aria-label={`${show ? t('Hide') : t('Show')}: ${label}`} onClick={() => setShow(!show)}>{show ? t('Hide') : t('Show')}</button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

// A dropdown in the site's own style, since a browser's list can't be restyled.
// `options` are { value, label }. Focus stays on the button, as with a normal select.
export function Select({ id, value, options, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // the option highlighted by the arrow keys
  const box = useRef(null);
  const chosen = options.find(o => o.value === value);

  const show = () => {
    setActive(Math.max(0, options.findIndex(o => o.value === value)));
    setOpen(true);
  };
  const pick = option => {
    onChange(option.value);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return undefined;
    const away = e => { if (!box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  function onKey(e) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === 'ArrowDown') setActive(i => Math.min(i + 1, options.length - 1));
    else if (e.key === 'ArrowUp') setActive(i => Math.max(i - 1, 0));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(options.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') pick(options[active]);
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Tab') return setOpen(false);
    else return undefined;
    e.preventDefault(); // Esc closes the list here, not the popup around it
    e.stopPropagation();
    return undefined;
  }

  return (
    <div className={`select ${open ? 'open' : ''}`} ref={box}>
      <button
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${options[active]?.value}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <span>{chosen?.label}</span>
        <i className="select-arrow" aria-hidden="true" />
      </button>
      {open && (
        <ul className="select-list" id={`${id}-list`} role="listbox">
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${o.value}`}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? 'active' : ''}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(o)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SearchBox({ label, inputRef, ...props }) {
  return (
    <label className="search-box">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8" /></svg>
      <input ref={inputRef} className="search" type="search" aria-label={label} {...props} />
    </label>
  );
}

export function Pager({ page, pages, onPage }) {
  if (pages < 2) return null;
  return (
    <nav className="pager" aria-label={t('Pages')}>
      <button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('Previous')}</button>
      <span>{t('Page {page} of {pages}', { page, pages })}</span>
      <button className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('Next')}</button>
    </nav>
  );
}
