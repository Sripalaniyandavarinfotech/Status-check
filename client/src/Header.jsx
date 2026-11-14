import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Inbox, { NoticeStrip } from './Inbox.jsx';
import NavIcon from './NavIcons.jsx';
import { PlanBanner } from './PlanPage.jsx';
import { lang, setLang, t } from './i18n.js';
import { api } from './lib.js';

const LINKS = {
  user: [['/home', 'Home'], ['/', 'TNeDistrict'], ['/tnpds', 'TNPDS'], ['/voter', 'Voter'], ['/aadhaar', 'Updates', 'Aadhaar'], ['/aadhaar/name', 'Name change', 'Aadhaar'], ['/pan/uti', 'UTI', 'PAN'], ['/pan/nsdl', 'NSDL', 'PAN'], ['/ttd', 'TTD'], ['/followups', 'Follow-ups', 'Others'], ['/dues', 'Not paid', 'Others'], ['/renewals', 'Renewals', 'Others']],
  admin: [['/admin', 'Users'], ['/admin/billing', 'Billing'], ['/admin/reports', 'Reports'], ['/admin/notices', 'Notices']],
};

// Links that share a group, like PAN's UTI and NSDL, are shown together.
function groupLinks(links) {
  const blocks = [];
  for (const l of links) {
    const last = blocks[blocks.length - 1];
    if (l[2] && last?.group === l[2]) last.links.push(l);
    else blocks.push({ group: l[2] || null, links: [l] });
  }
  return blocks;
}

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
    ...(admin ? [] : [['/plan', 'My plan'], ['/report', 'Monthly report'], ['/operators', 'Operator stats']]),
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
// `current`, `counts` and `onNav` come from the customers page, which switches service in place.
export default function Header({ user, onLogout, children, current, counts: given, onNav, noNav }) {
  const here = current || window.location.pathname;
  // The side bar loads its own numbers, so every page shows them. A page's own
  // numbers (like a service list with a search) win over these.
  const [loaded, setLoaded] = useState(null);
  const withNav = user?.role === 'user' && !noNav;
  useEffect(() => {
    if (withNav) api('nav-counts').then(setLoaded).catch(() => {});
  }, [withNav]);
  const counts = loaded || given ? { ...loaded, ...given } : undefined;

  // The side bar is a narrow strip of icons; the eThunaivan name opens and closes
  // the full one. The choice is remembered on this computer.
  const hasNav = !!user && !noNav;
  const [short, setShort] = useState(() => { try { return localStorage.getItem('nav-full') !== '1'; } catch { return true; } });
  useEffect(() => {
    document.body.classList.toggle('nav-short', hasNav && short);
    return () => document.body.classList.remove('nav-short');
  }, [hasNav, short]);
  const toggleNav = () => setShort(v => {
    try { localStorage.setItem('nav-full', v ? '1' : '0'); } catch { /* not remembered */ }
    return !v;
  });

  // On phones the links scroll sideways, so keep the open one in view.
  useEffect(() => {
    document.querySelector('.site-nav a.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [here]);

  return (
    <>
    <header className="top">
      <div className="wrap top-in">
        {hasNav ? (
          <button type="button" className="brand brand-btn" aria-expanded={!short} aria-label={t(short ? 'Open the side bar' : 'Close the side bar')} title={t(short ? 'Open the side bar' : 'Close the side bar')} onClick={toggleNav}>
            <span className="badge" aria-hidden="true">eT</span><span className="brand-name">{t('eThunaivan')}</span>
            <span className="brand-arrow" aria-hidden="true" />
          </button>
        ) : <a className="brand" href={user?.role === 'user' ? '/home' : '/'}><span className="badge" aria-hidden="true">eT</span>{t('eThunaivan')}</a>}
        <div className="top-right">
          {children}
          {user?.role === 'user' && <Inbox />}
          {user
            ? <ProfileMenu user={user} onLogout={onLogout} />
            : <button className="btn on-ink" onClick={() => setLang(lang === 'ta' ? 'en' : 'ta')}>{lang === 'ta' ? 'English' : 'தமிழ்'}</button>}
        </div>
      </div>
      {user && !noNav && (
        <nav className="site-nav" aria-label={t('Pages')}>
          <div className="wrap">
            {groupLinks(LINKS[user.role]).map(block => {
              const link = ([href, label], className = '') => {
                const count = counts?.[href];
                const on = here === href || (href === '/' && here === '/login');
                return (
                  <a
                    key={href}
                    href={href}
                    className={[on ? 'on' : '', className].join(' ').trim()}
                    aria-current={on ? 'page' : undefined}
                    title={t(label)}
                    onClick={e => {
                      if (!onNav || !given?.[href] || e.metaKey || e.ctrlKey || e.shiftKey) return; // only the page's own places switch in place
                      e.preventDefault();
                      // Switching service in place cross-fades, like moving between pages.
                      if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                        document.startViewTransition(() => flushSync(() => onNav(href)));
                      } else onNav(href);
                    }}
                  >
                    <NavIcon name={href} />
                    <span className="nav-text">{t(label)}</span>
                    {count && <b data-zero={count.n === 0 || undefined}>{count.n}</b>}
                    {!className && count?.due > 0 && <small>{t('{n} waiting to send', { n: count.due })}</small>}
                  </a>
                );
              };
              if (!block.group) return link(block.links[0]);
              // A service with parts, like PAN: one card, with its parts side by side.
              const total = block.links.reduce((n, [href]) => n + (counts?.[href]?.n || 0), 0);
              const due = block.links.reduce((n, [href]) => n + (counts?.[href]?.due || 0), 0);
              const open = block.links.some(([href]) => href === here);
              return (
                <div key={block.group} className={`nav-box ${block.group === 'Others' ? 'stack' : ''} ${open ? 'on' : ''}`} role="group" aria-label={t(block.group)}>
                  <span className="nav-box-head" title={t(block.group)}>
                    <NavIcon name={block.group} />
                    <span className="nav-text">{t(block.group)}</span>
                    {block.links.some(([href]) => counts?.[href]) && <b>{total}</b>}
                  </span>
                  <div className="nav-seg">{block.links.map(l => link(l, 'seg'))}</div>
                  {due > 0 && <small className="nav-box-due">{t('{n} waiting to send', { n: due })}</small>}
                </div>
              );
            })}
          </div>
        </nav>
      )}
    </header>
    {user?.role === 'user' && <PlanBanner plan={user.plan} />}
    {user?.role === 'user' && <NoticeStrip />}
    </>
  );
}
