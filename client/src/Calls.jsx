import { useCallback, useEffect, useRef, useState } from 'react';
import { Field, PasswordField } from './Fields.jsx';
import Splash from './Splash.jsx';
import { lang, setLang, t } from './i18n.js';
import { api, phone, showError, when, whatsappLink } from './lib.js';

// The phone app at /calls: accepted and rejected customers to call, one tap to the
// dial pad. It can't add or edit customers. A login from here gets a session the
// server only lets read these lists and mark calls.

const TABS = [
  { key: 'certificate', type: 'certificate', label: 'TNeDistrict' },
  { key: 'smartcard', type: 'smartcard', label: 'TNPDS' },
  { key: 'voter', type: 'voter', label: 'Voter' },
  { key: 'aadhaar', type: 'aadhaar', label: 'Aadhaar' },
  { key: 'pan-UTI', type: 'pan', agency: 'UTI', label: 'PAN UTI' },
  { key: 'pan-NSDL', type: 'pan', agency: 'NSDL', label: 'PAN NSDL' },
];
// Short Tamil words here: the usual ones are too long for three buttons on a phone.
const VIEWS = [['accepted', 'Accepted', 'ஏற்பு'], ['rejected', 'Rejected', 'நிராகரிப்பு'], ['called', 'Called', 'அழைத்தவை']];
const CALLED = lang === 'ta' ? 'அழைத்தேன்' : 'Called';
const FRESH_MS = 48 * 60 * 60 * 1000; // a result this recent gets a "New result" mark
const CACHE = 'calls-cache:';
// The Android app adds this to its browser name. Its own start page lives at https://localhost.
const IN_APK = /SPCallsApp/.test(navigator.userAgent);
// Android phones using Chrome get a link to the app itself.
const OFFER_APK = !IN_APK && /Android/i.test(navigator.userAgent);
const changeLink = () => window.location.assign('https://localhost/?change=1');

// Small conveniences kept on this phone. Storage may be blocked, so nothing depends on it.
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not kept */ } },
  clearCache() {
    try { Object.keys(localStorage).filter(k => k.startsWith(CACHE)).forEach(k => localStorage.removeItem(k)); } catch { /* nothing kept */ }
  },
};

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 15.4c-1.2 0-2.4-.2-3.5-.6-.4-.1-.7 0-1 .3l-1.6 2c-2.8-1.4-5.5-3.9-6.9-6.8l2-1.7c.3-.3.3-.7.2-1-.4-1.1-.6-2.3-.6-3.5 0-.6-.4-1-1-1H4.2C3.6 3 3 3.2 3 4c0 9.3 7.7 17 17 17 .7 0 1-.6 1-1.2v-3.4c0-.6-.4-1-1-1z" /></svg>
);
const ChatIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s1 2.5 1.1 2.7c.1.2 1.9 2.9 4.6 4 1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.2z" /></svg>
);
const TickIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

// Lets the phone offer "Install app", and gives the page its app name and icon.
function useInstall() {
  const [prompt, setPrompt] = useState(null);
  useEffect(() => {
    const added = [];
    const add = (tag, attrs) => {
      const el = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      document.head.appendChild(el);
      added.push(el);
    };
    add('link', { rel: 'manifest', href: '/calls.webmanifest' });
    add('link', { rel: 'apple-touch-icon', href: '/calls-icon-192.png' });
    add('meta', { name: 'theme-color', content: '#1f2a1f' });
    document.documentElement.classList.add('is-calls'); // the loading screen's phone-app look
    const title = document.title;
    document.title = `${t('Calls')} - eThunaivan`;
    const offer = e => { e.preventDefault(); setPrompt(e); };
    const installed = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', installed);
    return () => {
      added.forEach(el => el.remove());
      document.title = title;
      window.removeEventListener('beforeinstallprompt', offer);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  const install = async () => {
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice.catch(() => {});
    setPrompt(null);
  };
  return prompt ? install : null;
}

function TopBar({ user, install, onLogout }) {
  return (
    <header className="calls-top">
      <div className="calls-brand">
        <img src="/calls-icon-192.png" alt="" width="34" height="34" />
        <span>
          <b>{t('Calls')}</b>
          {user && <small>{user.userId}</small>}
        </span>
      </div>
      <div className="calls-top-tools">
        {IN_APK && <button className="calls-chip-btn" onClick={changeLink}>{t('Change link')}</button>}
        {OFFER_APK && <a className="calls-chip-btn" href="/ethunaivan-calls.apk" download>{t('Android app')}</a>}
        {install && !IN_APK && <button className="calls-chip-btn" onClick={install}>{t('Install app')}</button>}
        <button className="calls-chip-btn" lang={lang === 'ta' ? 'en' : 'ta'} onClick={() => setLang(lang === 'ta' ? 'en' : 'ta')}>{lang === 'ta' ? 'English' : 'தமிழ்'}</button>
        {onLogout && <button className="calls-chip-btn" onClick={onLogout}>{t('Log out')}</button>}
      </div>
    </header>
  );
}

function CallsLogin({ onLogin }) {
  const [form, setForm] = useState({ userId: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const change = key => e => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!form.userId.trim() || !form.password) return setError(t('Enter your user ID and password'));
    setBusy(true);
    setError('');
    try {
      const { user } = await api('auth/login', { method: 'POST', body: { ...form, area: 'user', app: 'calls' } });
      onLogin(user);
    } catch (err) {
      showError(err, t('Could not log in'));
      setBusy(false);
    }
    return undefined;
  }

  return (
    <main className="calls-login">
      <form className="calls-login-card" onSubmit={submit} noValidate>
        <h1>{t('Log in to see who to call')}</h1>
        <p className="quiet">{t('This app only shows lists. Add and edit customers on the website.')}</p>
        {error && <p className="warn" role="alert">{error}</p>}
        <Field id="userId" label={t('User ID')} value={form.userId} onChange={change('userId')} autoComplete="username" autoCapitalize="none" />
        <PasswordField id="password" label={t('Password')} value={form.password} onChange={change('password')} autoComplete="current-password" />
        <button className="btn primary wide" disabled={busy}>{busy ? t('Logging in…') : t('Log in')}</button>
        {!IN_APK && <p className="quiet calls-apk"><a href="/ethunaivan-calls.apk" download>{t('Download the Android app (APK)')}</a></p>}
      </form>
    </main>
  );
}

function CardSkeleton() {
  return (
    <ul className="calls-list" aria-hidden="true">
      {[0, 1, 2].map(i => (
        <li key={i} className="call-card">
          <span className="sk sk-line w-60" />
          <span className="sk sk-line thin w-40" />
          <span className="sk sk-line thin w-50" />
          <span className="call-actions"><span className="sk call-sk-btn" /></span>
        </li>
      ))}
    </ul>
  );
}

function CallCard({ c, view, provider, leaving, onMark }) {
  const fresh = view !== 'called' && c.statusChangedAt && Date.now() - Date.parse(c.statusChangedAt) < FRESH_MS;
  const bad = /reject|cancel/i.test(c.status || '');
  return (
    <li className={`call-card ${leaving ? 'leaving' : ''}`}>
      <div className="call-head">
        <b className="call-name">{c.name}</b>
        {fresh && <span className="call-fresh">{t('New result')}</span>}
      </div>
      <a className="call-phone" href={`tel:+${c.whatsapp}`}>{phone(c.whatsapp)}</a>
      <p className="call-meta">
        {c.applicationNo}
        {c.panKind && <span className={`kind ${c.panKind.toLowerCase()}`}>{t(c.panKind)}</span>}
      </p>
      <p className={`call-status ${bad ? 'bad' : 'ok'}`}>
        <span>{t(c.status)}</span>
        {c.statusChangedAt && <span className="quiet">{when(c.statusChangedAt)}</span>}
      </p>
      <div className="call-actions">
        <a className="call-btn" href={`tel:+${c.whatsapp}`} aria-label={t('Call {name}', { name: c.name })}>
          <PhoneIcon />{t('Call')}
        </a>
        <a className="call-wa" href={whatsappLink(c, provider)} target="_blank" rel="noreferrer" aria-label={t('WhatsApp {name}', { name: c.name })}>
          <ChatIcon />WhatsApp
        </a>
        <button className={`call-done ${view === 'called' ? 'undo' : ''}`} onClick={() => onMark(c, view !== 'called')} disabled={leaving}>
          {view === 'called' ? t('Not called') : <><TickIcon />{CALLED}</>}
        </button>
      </div>
    </li>
  );
}

function CallsList({ user }) {
  const [tab, setTab] = useState(() => (TABS.some(x => x.key === store.get('calls-tab')) ? store.get('calls-tab') : TABS[0].key));
  const [view, setView] = useState(() => (VIEWS.some(([v]) => v === store.get('calls-view')) ? store.get('calls-view') : 'accepted'));
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const cacheKey = `${CACHE}${user.userId}:${tab}:${view}`;
  const [data, setData] = useState(() => store.get(cacheKey));
  const [counts, setCounts] = useState(() => store.get(`${CACHE}${user.userId}:counts`) || []);
  const [offline, setOffline] = useState(false);
  const [leaving, setLeaving] = useState([]);
  const [toast, setToast] = useState(null);
  const [providers, setProviders] = useState([]);
  const [started, setStarted] = useState(() => !!store.get(cacheKey));
  const asked = useRef(0);
  const current = TABS.find(x => x.key === tab);

  useEffect(() => { api('providers').then(setProviders).catch(() => {}); }, []);
  useEffect(() => { store.set('calls-tab', tab); store.set('calls-view', view); }, [tab, view]);
  useEffect(() => {
    const timer = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    const ask = ++asked.current;
    const params = new URLSearchParams({ type: current.type, view, q });
    if (current.agency) params.set('agency', current.agency);
    try {
      const result = await api(`calls?${params}`);
      if (ask !== asked.current) return; // a newer question is on its way
      setData(result);
      setStarted(true);
      setCounts(result.counts);
      setOffline(false);
      if (!q) {
        store.set(cacheKey, result);
        store.set(`${CACHE}${user.userId}:counts`, result.counts);
      }
    } catch (e) {
      if (ask !== asked.current) return;
      setStarted(true);
      if (e.status === 0) setOffline(true);
      else showError(e);
    }
  }, [current, view, q, cacheKey, user.userId]);

  // A different list: show what this phone saved of it, then the fresh one.
  useEffect(() => {
    setData(q ? null : store.get(cacheKey));
    load();
  }, [load, cacheKey, q]);

  // Coming back from a call or WhatsApp, the list may have moved on.
  useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [load]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const countFor = (x, v) => counts
    .filter(r => r.type === x.type && (!x.agency || r.agency === x.agency))
    .reduce((n, r) => n + r[v], 0);

  async function mark(c, called) {
    setLeaving(ids => [...ids, c.id]);
    try {
      await api(`calls/${c.id}/called`, { method: 'POST', body: { called } });
      setTimeout(() => {
        setData(d => d && { ...d, items: d.items.filter(x => x.id !== c.id) });
        setLeaving(ids => ids.filter(id => id !== c.id));
        load();
      }, 260);
      setToast({ c, called });
    } catch (e) {
      setLeaving(ids => ids.filter(id => id !== c.id));
      showError(e);
    }
  }

  async function undo() {
    const { c, called } = toast;
    setToast(null);
    try {
      await api(`calls/${c.id}/called`, { method: 'POST', body: { called: !called } });
      load();
    } catch (e) {
      showError(e);
    }
  }

  const provider = providers.find(p => p.id === current.type);
  const service = t(current.label);
  const empty = q ? t('No customers match "{q}".', { q })
    : view === 'accepted' ? t('No accepted customers to call in {service}.', { service })
      : view === 'rejected' ? t('No rejected customers to call in {service}.', { service })
        : t('Customers you mark as called appear here.');

  if (!started) return <Splash />;

  return (
    <>
      <nav className="calls-tabs" aria-label={t('Services')}>
        {TABS.map(x => {
          const n = countFor(x, 'accepted') + countFor(x, 'rejected');
          return (
            <button key={x.key} className={x.key === tab ? 'on' : ''} aria-current={x.key === tab ? 'page' : undefined} onClick={() => setTab(x.key)}>
              {t(x.label)}
              {n > 0 && <span className="calls-badge">{n}</span>}
            </button>
          );
        })}
      </nav>

      <main className="calls-main">
        <div className="calls-views" role="tablist" aria-label={t('Lists')}>
          {VIEWS.map(([v, label, short]) => (
            <button key={v} role="tab" aria-selected={v === view} className={`${v} ${v === view ? 'on' : ''}`} onClick={() => setView(v)}>
              {lang === 'ta' ? short : label} <span>{countFor(current, v)}</span>
            </button>
          ))}
        </div>

        <input className="calls-search" type="search" value={query} onChange={e => setQuery(e.target.value)}
          placeholder={t('Search name, number or phone')} aria-label={t('Search name, number or phone')} />

        {offline && <p className="calls-offline" role="status">{t('No internet. Showing the last saved list.')}</p>}

        {!data ? <CardSkeleton /> : data.items.length ? (
          <ul className="calls-list">
            {data.items.map(c => (
              <CallCard key={c.id} c={c} view={view} provider={provider} leaving={leaving.includes(c.id)} onMark={mark} />
            ))}
          </ul>
        ) : <p className="calls-empty">{empty}</p>}
        {data?.items.length === 300 && <p className="quiet calls-more">{t('Showing the newest 300. Search to find others.')}</p>}
      </main>

      {toast && (
        <div className="calls-toast" role="status">
          <span>{toast.called ? t('{name} moved to Called', { name: toast.c.name }) : t('{name} moved back to the list', { name: toast.c.name })}</span>
          <button onClick={undo}>{t('Undo')}</button>
        </div>
      )}
      <div className="calls-bottom-space" aria-hidden="true" />
    </>
  );
}

export default function Calls({ user, onLogin, onLogout }) {
  const install = useInstall();
  const logout = () => {
    store.clearCache(); // customer names and numbers don't stay on the phone after logging out
    onLogout();
  };

  return (
    <div className="calls">
      <TopBar user={user} install={install} onLogout={user ? logout : null} />
      {!user ? <CallsLogin onLogin={onLogin} />
        : user.role !== 'user' ? (
          <main className="calls-login"><div className="calls-login-card"><h1>{t('The admin account has no customers')}</h1><p className="quiet">{t('Log out, then log in with a shop account.')}</p></div></main>
        ) : <CallsList user={user} />}
    </div>
  );
}
