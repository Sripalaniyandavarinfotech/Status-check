import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { PasswordField } from './Fields.jsx';
import { lang, setLang, t } from './i18n.js';
import { api, showError } from './lib.js';

function ChangeMyPassword({ onClose, onDone }) {
  const [form, setForm] = useState({ current: '', password: '', again: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const change = key => e => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (!form.current) found.current = t('Enter your current password');
    if (form.password.length < 8) found.password = t('Use at least 8 characters');
    else if (form.password !== form.again) found.again = t('The passwords do not match');
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await api('auth/password', { method: 'POST', body: { current: form.current, password: form.password } });
      onDone();
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  }

  return (
    <Dialog title={t('Change my password')} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <PasswordField id="current" label={t('Current password')} error={errors.current} value={form.current} onChange={change('current')} autoComplete="current-password" />
        <PasswordField id="password" label={t('New password')} error={errors.password} value={form.password} onChange={change('password')} autoComplete="new-password" />
        <PasswordField id="again" label={t('New password again')} error={errors.again} value={form.again} onChange={change('again')} autoComplete="new-password" />
        <p className="quiet">{t('Your other devices will be logged out.')}</p>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" disabled={busy}>{busy ? t('Saving…') : t('Change password')}</button>
        </div>
      </form>
    </Dialog>
  );
}

const LINKS = {
  user: [['/', 'Customers'], ['/activity', 'Activity'], ['/reports', 'Reports']],
  admin: [['/admin', 'Users'], ['/admin/activity', 'Activity'], ['/admin/reports', 'Reports']],
};

// The indigo bar on every page.
export default function Header({ user, onLogout, children }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const here = window.location.pathname;
  return (
    <>
      <header className="top">
        <div className="wrap top-in">
          <a className="brand" href="/"><span className="badge" aria-hidden="true">SP</span>{t('Sir Palaniyandavar Info Tech')}</a>
          <div className="top-right">
            {children}
            <button className="btn on-ink" onClick={() => setLang(lang === 'ta' ? 'en' : 'ta')}>{lang === 'ta' ? 'English' : 'தமிழ்'}</button>
            {user && <span className="who-am-i">{user.userId}</span>}
            {user && <button className="btn on-ink" onClick={() => setAsking(true)}>{t('Change password')}</button>}
            {user && <button className="btn on-ink" onClick={onLogout}>{t('Log out')}</button>}
          </div>
        </div>
        {user && (
          <nav className="site-nav" aria-label={t('Pages')}>
            <div className="wrap">
              {LINKS[user.role].map(([href, label]) => <a key={href} href={href} className={here === href || (href === '/' && here === '/login') ? 'on' : ''}>{t(label)}</a>)}
            </div>
          </nav>
        )}
      </header>
      {note && <p className="wrap saved page-note" role="status">{note}</p>}
      {asking && <ChangeMyPassword onClose={() => setAsking(false)} onDone={() => { setAsking(false); setNote(t('Your password has been changed')); }} />}
    </>
  );
}
