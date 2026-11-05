import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AddCustomer from './AddCustomer.jsx';
import CustomerRow from './CustomerRow.jsx';
import Dialog from './Dialog.jsx';
import Header from './Header.jsx';
import { api, downloadCsv, kind, plural, when } from './lib.js';

const VIEWS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'waiting', label: 'Waiting to send', test: c => c.notifyDue },
  { id: 'progress', label: 'In progress', test: c => kind(c) === '' },
  { id: 'approved', label: 'Approved', test: c => kind(c) === 'ok' },
  { id: 'rejected', label: 'Rejected', test: c => kind(c) === 'bad' },
  { id: 'new', label: 'No status yet', test: c => kind(c) === 'none' },
];

const WHATSAPP_NOTE = {
  live: 'WhatsApp connected',
  test: 'WhatsApp not connected yet',
  off: 'WhatsApp updates off',
};

function headline(customers, waiting, inProgress) {
  if (!customers.length) return 'Add your first customer to start tracking';
  if (waiting) return `${plural(waiting, 'customer')} waiting for a WhatsApp update`;
  if (inProgress) return `${plural(inProgress, 'application')} in progress`;
  return `${plural(customers.length, 'application')} on file, none in progress`;
}

export default function App({ user, onLogout }) {
  const [customers, setCustomers] = useState(null);
  const [providers, setProviders] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [offline, setOffline] = useState(false);
  const [view, setView] = useState('all');
  const [service, setService] = useState('');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: 'add' | 'send' | 'delete' | 'notify', customer? }
  const [toasts, setToasts] = useState([]);
  const [thudId, setThudId] = useState(null);
  const [checking, setChecking] = useState(null);
  const [sending, setSending] = useState(false);
  const searchRef = useRef(null);

  const toast = useCallback((text, { tone = '', action } = {}) => {
    const id = Math.random();
    setToasts(t => [...t, { id, text, tone, action }].slice(-2));
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), action ? 7000 : 4500);
  }, []);

  const replace = c => setCustomers(list => list.map(x => (x.id === c.id ? c : x)));

  const loadCustomers = useCallback(async () => setCustomers(await api('customers')), []);
  const loadSchedule = useCallback(async () => {
    const s = await api('schedule');
    setSchedule(s);
    return s;
  }, []);

  useEffect(() => {
    Promise.all([api('providers').then(setProviders), loadCustomers(), loadSchedule()]).catch(() => setOffline(true));
  }, [loadCustomers, loadSchedule]);

  // Follow a running check closely; otherwise look for scheduled runs once a minute.
  const running = !!schedule?.running;
  useEffect(() => {
    const tick = () => Promise.all([loadSchedule(), running ? loadCustomers() : null])
      .then(() => setOffline(false))
      .catch(() => setOffline(true));
    const timer = setInterval(tick, running ? 3000 : 60000);
    return () => { clearInterval(timer); if (running) loadCustomers().catch(() => {}); };
  }, [running, loadCustomers, loadSchedule]);

  // Press / to jump to the search box.
  useEffect(() => {
    const onKey = e => {
      if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const providerOf = c => providers.find(p => p.id === c.type);
  const all = useMemo(() => customers || [], [customers]);
  const waiting = all.filter(c => c.notifyDue);
  const box = service || providers[0]?.id; // the service box that is open
  const boxProvider = providers.find(p => p.id === box);
  const inBox = useMemo(() => all.filter(c => c.type === box), [all, box]);
  const counts = Object.fromEntries(VIEWS.map(v => [v.id, inBox.filter(v.test).length]));
  const matches = useCallback(c => {
    const q = query.trim().toLowerCase();
    return !q || [c.name, c.applicationNo, c.whatsapp].some(v => v.toLowerCase().includes(q));
  }, [query]);

  const shown = useMemo(() => {
    const test = VIEWS.find(v => v.id === view).test;
    return inBox.filter(c => test(c) && matches(c));
  }, [inBox, view, matches]);

  async function setStage(c, status) {
    if (status === c.status) return;
    const previous = c.status;
    try {
      const updated = await api(`customers/${c.id}/status`, { method: 'POST', body: { status } });
      replace(updated);
      if (kind(updated) === 'ok' || kind(updated) === 'bad') {
        setThudId(c.id);
        setTimeout(() => setThudId(id => (id === c.id ? null : id)), 500);
      }
      toast(`${c.name}: ${status}`, previous ? { action: { label: 'Undo', run: () => setStage(updated, previous) } } : {});
    } catch (e) {
      toast(e.message, { tone: 'bad' });
    }
  }

  // Opens the official page with the number on the clipboard, ready to paste.
  function openSite(c) {
    window.open(providerOf(c).officialUrl, '_blank', 'noopener');
    navigator.clipboard?.writeText(c.applicationNo)
      .then(() => toast(`${c.applicationNo} copied. Paste it on the website.`))
      .catch(() => {});
  }

  async function check(c) {
    setChecking(c.id);
    try {
      const updated = await api(`customers/${c.id}/refresh`, { method: 'POST' });
      replace(updated);
      toast(`${c.name}: ${updated.status}`);
    } catch (e) {
      toast(`Check failed for ${c.name}: ${e.message}`, { tone: 'bad' });
    }
    setChecking(null);
  }

  async function addCustomer(form) {
    const saved = await api('customers', { method: 'POST', body: form });
    setCustomers(list => [saved, ...list]);
    setService(saved.type); // show the box the new customer went into
    const p = providerOf(saved);
    toast(`Saved ${saved.name}`);
    if (p?.ready) check(saved);
  }

  async function notify(c) {
    setDialog(null);
    try {
      const updated = await api(`customers/${c.id}/notify`, { method: 'POST' });
      replace(updated);
      toast(updated.notifications[0].mode === 'test' ? `Nothing sent to ${c.name}: WhatsApp isn't connected yet` : `Update sent to ${c.name}`);
    } catch (e) {
      if (e.data?.customer) replace(e.data.customer);
      toast(`Update failed for ${c.name}: ${e.message}`, { tone: 'bad' });
    }
  }

  async function remove(c) {
    setDialog(null);
    await api(`customers/${c.id}`, { method: 'DELETE' });
    setCustomers(list => list.filter(x => x.id !== c.id));
    toast(`Deleted ${c.name}`);
  }

  async function sendAll() {
    setSending(true);
    try {
      const r = await api('customers/send-updates', { method: 'POST' });
      await loadCustomers();
      setDialog(null);
      if (r.test) toast(`Nothing sent: WhatsApp isn't connected yet. ${plural(r.test, 'customer')} still waiting.`, { tone: 'bad' });
      else if (r.failed) toast(`${r.sent} sent, ${r.failed} failed: ${r.error}. Failed customers are still waiting.`, { tone: 'bad' });
      else toast(`WhatsApp update sent to ${plural(r.sent, 'customer')}`);
    } catch (e) {
      toast(e.message, { tone: 'bad' });
    }
    setSending(false);
  }

  async function runCheck() {
    try {
      await api('schedule', { method: 'POST' });
      await loadSchedule();
    } catch (e) {
      toast(e.message, { tone: 'bad' });
    }
  }

  const r = schedule?.lastRun;
  const progress = schedule?.running;

  return (
    <>
      <Header user={user} onLogout={onLogout}>
        {schedule && <span className={`link-state ${schedule.whatsapp}`}>{WHATSAPP_NOTE[schedule.whatsapp]}</span>}
      </Header>

      <main className="wrap">
        {offline && <p className="offline" role="alert">The CRM server isn't responding. Check that node server.js is running in your terminal.</p>}

        <section className="lead">
          <h1>{customers ? headline(all, waiting.length, all.filter(c => kind(c) === '').length) : 'Loading customers…'}</h1>
          <button className="btn primary" onClick={() => setDialog({ kind: 'add' })} disabled={!providers.length}>Add customer</button>
        </section>

        <nav className="boxes" aria-label="Choose a service">
          {providers.map(p => {
            const list = all.filter(c => c.type === p.id);
            const due = list.filter(c => c.notifyDue).length;
            return (
              <button key={p.id} className={p.id === box ? 'on' : ''} aria-pressed={p.id === box} onClick={() => setService(p.id)}>
                <span className="box-name">{p.shortName}</span>
                <b>{list.filter(matches).length}</b>
                <span className="box-note">{due ? `${due} waiting to send` : plural(list.length, 'application')}</span>
              </button>
            );
          })}
        </nav>

        <nav className="views" aria-label="Filter by status">
          {VIEWS.map(v => (
            <button key={v.id} className={view === v.id ? 'on' : ''} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
              <b>{counts[v.id]}</b>
              {v.label}
            </button>
          ))}
        </nav>

        {schedule && boxProvider?.ready && (
          <section className="auto">
            <div>
              {progress
                ? <strong>Checking certificates: {progress.done} of {progress.total}</strong>
                : <strong>Next certificate check: {schedule.nextRun}</strong>}
              <p className="quiet">
                {r ? `Last run ${when(r.finishedAt)}: ${r.checked} checked, ${r.changed.length} changed${r.failed ? `, ${r.failed} failed` : ''}.` : 'No check has run yet.'}
                {' '}Runs at {schedule.times.join(', ')} while the server is on.
              </p>
              {progress && <progress max={progress.total || 1} value={progress.done} aria-label="Check progress" />}
            </div>
            <button className="btn" disabled={!!progress} onClick={runCheck}>{progress ? 'Running…' : 'Run check now'}</button>
          </section>
        )}

        <div className="tools">
          <input ref={searchRef} className="search" type="search" aria-label="Search customers" placeholder="Search name or number (press /)" value={query} onChange={e => setQuery(e.target.value)} />
          <button className="btn" disabled={!inBox.length} onClick={() => downloadCsv(inBox, providers, `${boxProvider.shortName}-customers.csv`)}>Download CSV</button>
        </div>

        {customers && (shown.length ? (
          <ul className="rows">
            {shown.map(c => (
              <CustomerRow
                key={c.id}
                c={c}
                provider={providerOf(c)}
                open={openId === c.id}
                thud={thudId === c.id}
                busy={checking === c.id}
                onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                onStage={setStage}
                onOpenSite={openSite}
                onCheck={check}
                onNotify={x => setDialog({ kind: 'notify', customer: x })}
                onDelete={x => setDialog({ kind: 'delete', customer: x })}
              />
            ))}
          </ul>
        ) : (
          <div className="empty">
            {inBox.length
              ? <p>No customers match this filter.</p>
              : <p>{boxProvider?.shortName} customers appear here with their application status.</p>}
          </div>
        ))}
      </main>

      {waiting.length > 0 && (
        <div className="send-bar">
          <div className="wrap send-in">
            <span>{plural(waiting.length, 'customer')} approved or rejected</span>
            <button className="btn ink" onClick={() => setDialog({ kind: 'send' })}>Review and send WhatsApp</button>
          </div>
        </div>
      )}

      {dialog?.kind === 'add' && <AddCustomer providers={providers} initial={box} onSave={addCustomer} onClose={() => setDialog(null)} />}

      {dialog?.kind === 'send' && (
        <Dialog title={`Send WhatsApp to ${plural(waiting.length, 'customer')}`} onClose={() => setDialog(null)}>
          {schedule?.whatsapp !== 'live' && <p className="warn">WhatsApp isn't connected yet, so nothing will reach customers. They stay on this list until it's connected.</p>}
          <ul className="send-list">
            {waiting.map(c => (
              <li key={c.id}>
                <span>{c.name}<span className="quiet">{providerOf(c)?.name}</span></span>
                <span className={`tag ${kind(c)}`}>{c.status}</span>
              </li>
            ))}
          </ul>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
            <button className="btn primary" disabled={sending} onClick={sendAll}>{sending ? 'Sending…' : `Send to ${plural(waiting.length, 'customer')}`}</button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'notify' && (
        <Dialog title="Send this update?" onClose={() => setDialog(null)}>
          <p>{dialog.customer.name} will get "{dialog.customer.status}" on WhatsApp.</p>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
            <button className="btn primary" onClick={() => notify(dialog.customer)}>Send update</button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'delete' && (
        <Dialog title="Delete this customer?" onClose={() => setDialog(null)}>
          <p>{dialog.customer.name} ({dialog.customer.applicationNo}) and their history will be removed. This can't be undone.</p>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
            <button className="btn stop-solid" onClick={() => remove(dialog.customer)}>Delete customer</button>
          </div>
        </Dialog>
      )}

      <div className="toasts" role="status">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span>{t.text}</span>
            {t.action && <button onClick={() => { setToasts(l => l.filter(x => x.id !== t.id)); t.action.run(); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </>
  );
}
