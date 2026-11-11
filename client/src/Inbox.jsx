import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from './i18n.js';
import { api } from './lib.js';

// Notices from the admin: new features and updates, price changes, and other news.
// A bell in the top bar shows how many are unread. Unread important ones, like a price
// change, also show as a strip under the top bar until they're opened.

const KIND = {
  update: { label: 'Update', icon: 'M12 3l2.3 5.4L20 9l-4.3 3.9L17 19l-5-3-5 3 1.3-6.1L4 9l5.7-.6z' },
  price: { label: 'Price change', icon: 'M7 4h10M7 8h10M7 4c5 0 7 2 7 4.5S11 13 7 13l8 7' },
  notice: { label: 'Notice', icon: 'M12 8v5M12 16.5v.5M12 3a9 9 0 100 18 9 9 0 000-18z' },
};
const CHECK_MS = 5 * 60 * 1000;

const date = iso => new Date(`${iso}T00:00:00`).toLocaleDateString(document.documentElement.lang === 'ta' ? 'ta-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const sentOn = iso => new Date(iso).toLocaleDateString(document.documentElement.lang === 'ta' ? 'ta-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function KindIcon({ kind }) {
  return (
    <span className={`notice-icon ${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d={KIND[kind]?.icon || KIND.notice.icon} /></svg>
    </span>
  );
}

function Notice({ n, fresh }) {
  return (
    <li className={`notice ${fresh ? 'fresh' : ''}`}>
      <KindIcon kind={n.kind} />
      <div className="notice-text">
        <p className="notice-meta">
          <span>{t(KIND[n.kind]?.label || 'Notice')}</span>
          <span>{sentOn(n.at)}</span>
          {fresh && <b>{t('New')}</b>}
        </p>
        <h3>{n.title}</h3>
        {n.kind === 'price' && n.price && (
          <p className="notice-price">{t('New price ₹{price} a month from {date}', { price: n.price, date: date(n.startsOn) })}</p>
        )}
        <p className="notice-body">{n.body}</p>
      </div>
    </li>
  );
}

// One inbox for the whole page, shared by the bell and the strip. It checks again every
// few minutes, and when the tab comes back into view.
const store = { data: null, listeners: new Set(), timer: null };
const publish = data => { store.data = data; store.listeners.forEach(fn => fn(data)); };
const load = () => api('inbox').then(publish).catch(() => {});
const back = () => { if (document.visibilityState === 'visible') load(); };

function useInbox() {
  const [data, setData] = useState(store.data);
  useEffect(() => {
    store.listeners.add(setData);
    if (store.listeners.size === 1) {
      load();
      store.timer = setInterval(load, CHECK_MS);
      document.addEventListener('visibilitychange', back);
    }
    return () => {
      store.listeners.delete(setData);
      if (!store.listeners.size) {
        clearInterval(store.timer);
        document.removeEventListener('visibilitychange', back);
      }
    };
  }, []);
  const readAll = useCallback(async () => {
    try { publish(await api('inbox/read', { method: 'POST', body: {} })); } catch { /* tried again next time it opens */ }
  }, []);
  return { data, readAll };
}

export default function Inbox() {
  const { data, readAll } = useInbox();
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState([]); // unread when the panel opened, so they stay marked "New" while it's open
  const box = useRef(null);
  const button = useRef(null);

  const show = useCallback(() => {
    setFresh((data?.items || []).filter(n => !n.read).map(n => n.id));
    setOpen(true);
    if (data?.unread) readAll();
  }, [data, readAll]);

  useEffect(() => {
    if (!open) return undefined;
    const away = e => { if (!box.current.contains(e.target)) setOpen(false); };
    const key = e => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  // Opened from the strip under the top bar.
  useEffect(() => {
    const openIt = () => show();
    window.addEventListener('open-inbox', openIt);
    return () => window.removeEventListener('open-inbox', openIt);
  }, [show]);

  const unread = data?.unread || 0;
  return (
    <div className="inbox" ref={box}>
      <button
        ref={button}
        className={`inbox-bell ${open ? 'on' : ''} ${unread ? 'has' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread ? t('Notices, {n} unread', { n: unread }) : t('Notices')}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10a6 6 0 1112 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5zM10 19.5a2.2 2.2 0 004 0" /></svg>
        {unread > 0 && <b>{unread > 9 ? '9+' : unread}</b>}
      </button>
      {open && (
        <div className="inbox-panel" role="dialog" aria-label={t('Notices')}>
          <div className="inbox-head">
            <h2>{t('Notices')}</h2>
            <button className="inbox-close" onClick={() => setOpen(false)} aria-label={t('Close')}>×</button>
          </div>
          {!data ? <p className="quiet inbox-empty">{t('Loading…')}</p>
            : data.items.length ? (
              <ul className="inbox-list">
                {data.items.map(n => <Notice key={n.id} n={n} fresh={fresh.includes(n.id)} />)}
              </ul>
            ) : <p className="quiet inbox-empty">{t('No notices yet. News about updates and prices will appear here.')}</p>}
        </div>
      )}
    </div>
  );
}

// A red pop-up in the top corner for unread important notices, such as a price change.
// × hides it until the next page; Read opens the inbox, which marks it read.
const HIDDEN = 'notice-pop-hidden';
const hiddenIds = () => { try { return JSON.parse(sessionStorage.getItem(HIDDEN)) || []; } catch { return []; } };

export function NoticeStrip() {
  const { data } = useInbox();
  const [hidden, setHidden] = useState(hiddenIds);
  const waiting = (data?.items || []).filter(n => n.important && !n.read && !hidden.includes(n.id));
  const top = waiting[0];
  if (!top) return null;
  const hide = () => {
    const next = [...hidden, ...waiting.map(n => n.id)];
    setHidden(next);
    try { sessionStorage.setItem(HIDDEN, JSON.stringify(next)); } catch { /* shows again on the next page */ }
  };
  return (
    <div className={`notice-pop ${top.kind}`} role="alert" key={top.id}>
      <div className="notice-pop-head">
        <KindIcon kind={top.kind} />
        <span>{t(KIND[top.kind]?.label || 'Notice')}</span>
        <button className="notice-pop-close" onClick={hide} aria-label={t('Hide')}>×</button>
      </div>
      <b className="notice-pop-title">{top.title}</b>
      {top.kind === 'price' && top.price && <p className="notice-pop-price">{t('New price ₹{price} a month from {date}', { price: top.price, date: date(top.startsOn) })}</p>}
      <p className="notice-pop-body">{top.body}</p>
      <div className="notice-pop-foot">
        {waiting.length > 1 && <span>{t('{n} more', { n: waiting.length - 1 })}</span>}
        <button className="btn" onClick={() => window.dispatchEvent(new Event('open-inbox'))}>{t('Read')}</button>
      </div>
    </div>
  );
}
