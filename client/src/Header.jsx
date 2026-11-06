import { useEffect, useRef, useState } from 'react';
import { lang, setLang, t } from './i18n.js';

const LINKS = {
  user: [['/', 'Customers'], ['/pan', 'PAN']],
  admin: [['/admin', 'Users'], ['/admin/reports', 'Reports']],
};

// The profile icon. Everything about the person's own account is in this menu.
function ProfileMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const button = useRef(null);
  const menu = useRef(null);
  const admin = user.role === 'admin';
  const here = window.location.pathname;
  const links = [
    [admin ? '/admin/profile' : '/profile', 'Profile'],
    [admin ? '/admin/activity' : '/activity', 'Activity'],
    ['/home', 'Home page'],
  ];

  const items = () => [...menu.current.querySelectorAll('[role=menuitem]')];

  useEffect(() => {
    if (!open) return undefined;
    items()[0]?.focus();
    const away = e => { if (!box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  function onKey(e) {
    const list = items();
    const at = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') list[(at + 1) % list.length].focus();
    else if (e.key === 'ArrowUp') list[(at - 1 + list.length) % list.length].focus();
    else if (e.key === 'Home') list[0].focus();
    else if (e.key === 'End') list[list.length - 1].focus();
    else if (e.key === 'Escape') {
      setOpen(false);
      button.current.focus();
    } else {
      if (e.key === 'Tab') setOpen(false);
      return;
    }
    e.preventDefault();
  }

  return (
    <div className="profile-menu" ref={box}>
      <button
        ref={button}
        className={`profile-link ${open ? 'on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('Profile')}: ${user.userId}`}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8.5" r="4" />
          <path d="M4.5 20.5c1-4 3.8-6 7.5-6s6.5 2 7.5 6" />
        </svg>
        <span>{user.userId}</span>
        <i className="menu-arrow" aria-hidden="true" />
      </button>
      {open && (
        <div className="menu" role="menu" ref={menu} aria-label={t('Profile')} onKeyDown={onKey}>
          {links.map(([href, label]) => (
            <a key={href} href={href} role="menuitem" aria-current={here === href ? 'page' : undefined}>{t(label)}</a>
          ))}
          <button role="menuitem" lang={lang === 'ta' ? 'en' : 'ta'} onClick={() => setLang(lang === 'ta' ? 'en' : 'ta')}>{lang === 'ta' ? 'English' : 'தமிழ்'}</button>
          <hr />
          <button role="menuitem" className="menu-out" onClick={onLogout}>{t('Log out')}</button>
        </div>
      )}
    </div>
  );
}

// The indigo bar on every page.
export default function Header({ user, onLogout, children }) {
  const here = window.location.pathname;
  return (
    <header className="top">
      <div className="wrap top-in">
        <a className="brand" href="/"><span className="badge" aria-hidden="true">SP</span>{t('Sir Palaniyandavar Info Tech')}</a>
        <div className="top-right">
          {children}
          {user
            ? <ProfileMenu user={user} onLogout={onLogout} />
            : <button className="btn on-ink" onClick={() => setLang(lang === 'ta' ? 'en' : 'ta')}>{lang === 'ta' ? 'English' : 'தமிழ்'}</button>}
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
  );
}
