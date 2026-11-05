import { useState } from 'react';
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
