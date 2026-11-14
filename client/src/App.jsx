import { useCallback, useEffect, useRef, useState } from 'react';
import AddCustomer from './AddCustomer.jsx';
import CustomerRow from './CustomerRow.jsx';
import Dialog from './Dialog.jsx';
import { Pager, SearchBox } from './Fields.jsx';
import { RemindDialog } from './FollowUps.jsx';
import Header from './Header.jsx';
import PersonApplications from './PersonApplications.jsx';
import { SkeletonRows, SkeletonTitle } from './Skeleton.jsx';
import { plural, t } from './i18n.js';
import { api, dayText, downloadCsv, kind, showError, whatsappLink, whatsappText, when, withAgency } from './lib.js';

const VIEWS = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting to send' },
  { id: 'progress', label: 'In progress' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'new', label: 'No status yet' },
  { id: 'informed', label: 'Informed' },
];

const WHATSAPP_NOTE = {
  live: 'WhatsApp connected',
  test: 'One-click WhatsApp',
  off: 'WhatsApp updates off',
};

function headline(s) {
  if (!s.total) return t('Add your first customer to start tracking');
  if (s.due) return t('{customers} waiting for a WhatsApp update', { customers: plural(s.due, 'customer') });
  if (s.progress) return t('{applications} in progress', { applications: plural(s.progress, 'application') });
  return t('{applications} on file, none in progress', { applications: plural(s.total, 'application') });
}

// Each service has its own address, from the side bar.
// PAN has two places, one for each agency.
const PATHS = { certificate: '/', smartcard: '/tnpds', voter: '/voter', aadhaar: '/aadhaar' };
const PAN_PATHS = { UTI: '/pan/uti', NSDL: '/pan/nsdl' };
const HAS_KIND = ['pan', 'smartcard']; // services with New and Correction applications
const pathOf = (type, agency) => (type === 'pan' ? PAN_PATHS[agency] || PAN_PATHS.UTI : PATHS[type]);
const placeAt = path => {
  if (path === '/pan' || path === PAN_PATHS.UTI) return { type: 'pan', agency: 'UTI' };
  if (path === PAN_PATHS.NSDL) return { type: 'pan', agency: 'NSDL' };
  return { type: Object.keys(PATHS).find(id => PATHS[id] === path) || '', agency: 'UTI' };
};

export default function App({ user, onLogout }) {
  const [list, setList] = useState(null); // the open page of customers
  const [summary, setSummary] = useState(null); // the counts around it
  const [providers, setProviders] = useState([]);
  const [operators, setOperators] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [offline, setOffline] = useState(false);
  const [view, setView] = useState('all');
  const [service, setService] = useState(() => placeAt(window.location.pathname).type);
  const [agency, setAgency] = useState(() => placeAt(window.location.pathname).agency); // for PAN
  const [kindFilter, setKindFilter] = useState(''); // '' | 'New' | 'Correction'
  const [page, setPage] = useState(1);
  // Other pages (follow-ups, dues) link here with ?q= to find one application.
  const [query, setQuery] = useState(() => (new URLSearchParams(window.location.search).get('q') || '').slice(0, 100));
  const [search, setSearch] = useState(() => query); // `query` once typing has paused
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: 'add' | 'edit' | 'send' | 'delete' | 'notify', customer? }
  const [toasts, setToasts] = useState([]);
  const [thudId, setThudId] = useState(null);
  const [checking, setChecking] = useState(null);
  const [sending, setSending] = useState(false);
  const [chatOpened, setChatOpened] = useState({}); // customers opened from the send list
  const searchRef = useRef(null);
  const latest = useRef(0);
  const moved = useRef(''); // the search that last chose a box

  const box = service || providers[0]?.id; // the service that is open
  const panAgency = box === 'pan' ? agency : '';
  const boxProvider = withAgency(providers.find(p => p.id === box), panAgency);
  const providerOf = c => providers.find(p => p.id === c.type);
  const refresh = useCallback(() => setReload(n => n + 1), []);

  const toast = useCallback((text, { action } = {}) => {
    const id = Math.random();
    setToasts(l => [...l, { id, text, action }].slice(-2));
    setTimeout(() => setToasts(l => l.filter(x => x.id !== id)), action ? 7000 : 4500);
  }, []);

  // Shows a saved change at once; the counts follow.
  const replace = c => {
    setList(l => l && { ...l, items: l.items.map(x => (x.id === c.id ? c : x)) });
    refresh();
  };

  const loadSchedule = useCallback(async () => setSchedule(await api('schedule')), []);

  useEffect(() => {
    Promise.all([api('providers').then(setProviders), api('operators').then(setOperators), loadSchedule()]).catch(() => setOffline(true));
  }, [loadSchedule]);

  // Waits for a pause in typing before searching.
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); moved.current = ''; }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Only the newest answer is used, in case an older one arrives late.
  useEffect(() => {
    if (!box) return;
    const ask = ++latest.current;
    const q = encodeURIComponent(search);
    const type = encodeURIComponent(box);
    const kind = HAS_KIND.includes(box) ? kindFilter : '';
    const ag = box === 'pan' ? agency : '';
    Promise.all([api(`customers?type=${type}&view=${view}&q=${q}&kind=${kind}&agency=${ag}&page=${page}`), api(`customers/summary?type=${type}&q=${q}&kind=${kind}&agency=${ag}`)])
      .then(([l, s]) => {
        if (ask !== latest.current) return;
        setList(l);
        setSummary(s);
        setOffline(false);
        // A new search with nothing here opens the place that has its results.
        if (search && moved.current !== search) {
          moved.current = search;
          // PAN counts as two places, one for each agency.
          const places = [
            ...s.boxes.filter(b => b.type !== 'pan').map(b => ({ type: b.type, agency: 'UTI', matches: b.matches })),
            ...Object.values(s.agencies || {}).map(a => ({ type: 'pan', agency: a.agency, matches: a.matches })),
          ];
          const here = places.find(p => p.type === box && (box !== 'pan' || p.agency === agency))?.matches;
          const other = places.find(p => p.matches);
          if (!l.total && (here || other)) {
            setView('all');
            if (!here) { setService(other.type); setAgency(other.agency); }
          }
        }
      })
      .catch(() => { if (ask === latest.current) setOffline(true); });
  }, [box, agency, view, search, page, reload, kindFilter]);

  // Follow a running check closely; otherwise look for scheduled runs once a minute.
  const running = !!schedule?.running;
  useEffect(() => {
    const tick = () => {
      loadSchedule().then(() => setOffline(false)).catch(() => setOffline(true));
      if (running) refresh();
    };
    const timer = setInterval(tick, running ? 3000 : 60000);
    return () => { clearInterval(timer); if (running) refresh(); };
  }, [running, loadSchedule, refresh]);

  // Keeps the address and the Back button in step with the open service.
  useEffect(() => {
    const target = box && pathOf(box, agency);
    if (!target || window.location.pathname === target) return;
    const known = placeAt(window.location.pathname).type && window.location.pathname !== '/pan';
    if (known) window.history.pushState(null, '', target);
    else window.history.replaceState(null, '', target);
  }, [box, agency]);

  useEffect(() => {
    const back = () => {
      const place = placeAt(window.location.pathname);
      setService(place.type || 'certificate');
      setAgency(place.agency);
      setView('all');
      setKindFilter('');
      setPage(1);
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);

  // Press / to jump to the search box.
  useEffect(() => {
    const onKey = e => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openBox = (id, ag = 'UTI') => { if (id !== box || ag !== agency) setList(null); setService(id); setAgency(ag); setView('all'); setKindFilter(''); setPage(1); window.scrollTo(0, 0); };
  const openView = id => { setView(id); setPage(1); };

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
      toast(`${c.name}: ${t(status)}`, previous ? { action: { label: t('Undo'), run: () => setStage(updated, previous) } } : {});
    } catch (e) {
      showError(e);
    }
  }

  // Opens the official page with the number on the clipboard, ready to paste.
  function openSite(c) {
    window.open(withAgency(providerOf(c), c.panAgency).officialUrl, '_blank', 'noopener');
    navigator.clipboard?.writeText(c.applicationNo)
      .then(() => toast(t('{number} copied. Paste it on the website.', { number: c.applicationNo })))
      .catch(() => {});
  }

  async function check(c) {
    setChecking(c.id);
    try {
      const updated = await api(`customers/${c.id}/refresh`, { method: 'POST' });
      replace(updated);
      toast(`${c.name}: ${t(updated.status)}`);
    } catch (e) {
      showError(e, t('Check failed for {name}', { name: c.name }));
    }
    setChecking(null);
  }

  async function addCustomer(form) {
    const saved = await api('customers', { method: 'POST', body: form });
    setService(saved.type); // show the box the new customer went into
    if (saved.panAgency) setAgency(saved.panAgency);
    setView('all');
    setPage(1);
    refresh();
    toast(t('Saved {name}', { name: saved.name }));
    if (providerOf(saved)?.ready) check(saved);
  }

  async function editCustomer(c, form) {
    const updated = await api(`customers/${c.id}/edit`, { method: 'POST', body: form });
    replace(updated);
    setDialog(null);
    toast(t('Saved {name}', { name: updated.name }));
  }

  async function addNote(c, body) {
    try {
      replace(await api(`customers/${c.id}/notes`, { method: 'POST', body: { body } }));
      return true;
    } catch (e) {
      showError(e);
      return false;
    }
  }

  async function removeNote(c, noteId) {
    try {
      replace(await api(`customers/${c.id}/notes/${noteId}`, { method: 'DELETE' }));
    } catch (e) {
      showError(e);
    }
  }

  async function removeAadhaar(c) {
    setDialog(null);
    try {
      replace(await api(`customers/${c.id}/aadhaar-remove`, { method: 'POST' }));
    } catch (e) {
      showError(e);
    }
  }

  async function notify(c) {
    setDialog(null);
    try {
      const updated = await api(`customers/${c.id}/notify`, { method: 'POST' });
      replace(updated);
      toast(updated.notifications[0].mode === 'test' ? t("Nothing sent to {name}: WhatsApp isn't connected yet", { name: c.name }) : t('Update sent to {name}', { name: c.name }));
    } catch (e) {
      if (e.data?.customer) replace(e.data.customer);
      showError(e, t('Update failed for {name}', { name: c.name }));
    }
  }

  async function remove(c) {
    setDialog(null);
    try {
      await api(`customers/${c.id}`, { method: 'DELETE' });
      refresh();
      toast(t('Deleted {name}', { name: c.name }));
    } catch (e) {
      showError(e);
    }
  }

  async function sendAll() {
    setSending(true);
    try {
      const r = await api('customers/send-updates', { method: 'POST', body: { type: box } });
      refresh();
      setDialog(null);
      if (r.test) showError({ message: t("WhatsApp isn't connected yet. {customers} still waiting.", { customers: plural(r.test, 'customer') }) }, t('Nothing sent'));
      else if (r.failed) showError({ message: t('{sent} sent, {failed} failed: {error}. Failed customers are still waiting.', { sent: r.sent, failed: r.failed, error: t(r.error) }) }, t('Some messages failed'));
      else toast(t('WhatsApp update sent to {customers}', { customers: plural(r.sent, 'customer') }));
    } catch (e) {
      showError(e);
    }
    setSending(false);
  }

  async function runCheck() {
    try {
      await api('schedule', { method: 'POST' });
      await loadSchedule();
    } catch (e) {
      showError(e);
    }
  }

  async function download() {
    try {
      downloadCsv((await api(`customers/export?type=${encodeURIComponent(box)}`)).filter(c => !panAgency || c.panAgency === panAgency), providers, `${boxProvider.shortName}-customers.csv`);
    } catch (e) {
      showError(e);
    }
  }

  // Without Meta's service, updates go out from the user's own WhatsApp. The site
  // can't see if they pressed send, so the message can be taken back.
  async function setInformed(c, informed) {
    try {
      replace(await api(`customers/${c.id}/informed`, { method: 'POST', body: { informed } }));
    } catch (e) {
      showError(e);
    }
  }

  const chatUndo = (c, wasDue) => api(`customers/${c.id}/chat-undo`, { method: 'POST', body: { wasDue } }).then(replace).catch(showError);

  async function chatSend(c) {
    window.open(whatsappLink(c, providerOf(c)), '_blank', 'noopener');
    const wasDue = !!c.notifyDue;
    try {
      replace(await api(`customers/${c.id}/chat-sent`, { method: 'POST', body: { text: whatsappText(c, providerOf(c)) } }));
      toast(t('WhatsApp opened for {name}. Press send there.', { name: c.name }), { action: { label: t('Not sent'), run: () => chatUndo(c, wasDue) } });
    } catch (e) {
      showError(e);
    }
  }

  // In the send list, which covers the page, "Not sent" sits beside the customer.
  async function chatSendFromList(c) {
    window.open(whatsappLink(c, providerOf(c)), '_blank', 'noopener');
    try {
      replace(await api(`customers/${c.id}/chat-sent`, { method: 'POST', body: { text: whatsappText(c, providerOf(c)) } }));
      setChatOpened(l => ({ ...l, [c.id]: true }));
    } catch (e) {
      showError(e);
    }
  }

  async function chatUndoFromList(c) {
    await chatUndo(c, true);
    setChatOpened(({ [c.id]: gone, ...rest }) => rest);
  }

  function openSendList() {
    setChatOpened({});
    setDialog({ kind: 'send', list: waiting });
  }

  // Every application under one number, across services.
  const showPerson = useCallback(number => setDialog({ kind: 'person', whatsapp: number }), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  // Opens one of those applications in its own service, found by its number.
  function openApplication(c) {
    setDialog(null);
    openBox(c.type, c.panAgency || 'UTI');
    setQuery(c.applicationNo);
  }

  // A search that is a phone number can show that person's applications everywhere.
  const searchedPhone = (() => {
    let d = search.replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    return /^[6-9]\d{9}$/.test(d) ? `91${d}` : '';
  })();

  const chat = !!schedule && schedule.whatsapp !== 'live';
  const r = schedule?.lastRun;
  const progress = schedule?.running;
  // The top line and the send bar are about the open service only.
  const waiting = (summary?.waiting || []).filter(c => c.type === box && (!panAgency || c.panAgency === panAgency));
  const empty = { total: 0, due: 0, progress: 0, matches: 0 };
  const boxInfo = id => summary?.boxes.find(b => b.type === id) || empty;
  const agencyInfo = ag => summary?.agencies?.[ag] || empty;
  const open = panAgency ? agencyInfo(panAgency) : boxInfo(box);
  const scope = open;
  const counts = Object.fromEntries([
    ...providers.filter(p => PATHS[p.id]).map(p => [PATHS[p.id], { n: boxInfo(p.id).matches, due: boxInfo(p.id).due }]),
    ...Object.entries(PAN_PATHS).map(([ag, path]) => [path, { n: agencyInfo(ag).matches, due: agencyInfo(ag).due }]),
  ]);

  return (
    <>
      <Header user={user} onLogout={onLogout} current={pathOf(box, agency)} counts={counts} onNav={path => { const place = placeAt(path); openBox(place.type, place.agency); }}>
        {schedule && <span className={`link-state ${schedule.whatsapp}`}>{t(WHATSAPP_NOTE[schedule.whatsapp])}</span>}
      </Header>

      <main className="wrap">
        {offline && <p className="offline" role="alert">{t("The CRM server isn't responding. Check that node server.js is running in your terminal.")}</p>}

        <section className="lead">
          <h1>{summary && list ? headline(scope) : <SkeletonTitle />}</h1>
          <button className="btn primary" onClick={() => setDialog({ kind: 'add' })} disabled={!boxProvider}>{boxProvider ? t('Add {service} customer', { service: t(boxProvider.shortName) }) : t('Add customer')}</button>
        </section>

        <SearchBox inputRef={searchRef} label={t('Search customers')} placeholder={t('Search name or number (press /)')} value={query} onChange={e => setQuery(e.target.value)} />


        <nav className="views" aria-label={t('Filter by status')}>
          {VIEWS.map(v => (
            <button key={v.id} className={view === v.id ? 'on' : ''} aria-pressed={view === v.id} onClick={() => openView(v.id)}>
              <b>{list ? summary?.views[v.id] ?? 0 : '…'}</b>
              {t(v.label)}
            </button>
          ))}
        </nav>

        {box === 'pan' && schedule?.epan?.on && (
          <section className="auto">
            <div>
              <strong>{schedule.epan.lastError ? t('e-PAN emails could not be read') : t('Reading e-PAN emails from {email}', { email: schedule.epan.email })}</strong>
              <p className="quiet">
                {schedule.epan.lastError
                  ? t(schedule.epan.lastError)
                  : t('Every {n} minutes. UTIITSL and Protean emails move the matching customer to Submitted, In Process or Approved.', { n: schedule.epan.minutes })}
                {schedule.epan.lastRun && ` ${t('Last read {when}.', { when: when(schedule.epan.lastRun) })}`}
              </p>
              {schedule.epan.unmatched?.length > 0 && (
                <p className="warn">{t('Emails for numbers not in your list: {numbers}', { numbers: schedule.epan.unmatched.join(', ') })}</p>
              )}
            </div>
          </section>
        )}

        {schedule && boxProvider?.ready && (
          <section className="auto">
            <div>
              {progress
                ? <strong>{t('Checking certificates: {done} of {total}', progress)}</strong>
                : <strong>{t('Next certificate check: {when}', { when: t(schedule.nextRun) })}</strong>}
              <p className="quiet">
                {r ? t('Last run {when}: {checked} checked, {changed} changed, {failed} failed.', { when: when(r.finishedAt), checked: r.checked, changed: r.changed.length, failed: r.failed }) : t('No check has run yet.')}
                {' '}{t('Runs at {times} while the server is on. Finished applications are not checked again.', { times: schedule.times.join(', ') })}
              </p>
              {progress && <progress max={progress.total || 1} value={progress.done} aria-label={t('Check progress')} />}
            </div>
            <button className="btn" disabled={!!progress} onClick={runCheck}>{progress ? t('Running…') : t('Run check now')}</button>
          </section>
        )}

        <div className="tools">
          {HAS_KIND.includes(box) && (
            <fieldset className="pick kind-filter">
              <legend className="hide">{t('Application type')}</legend>
              <div>
                {[['', 'All', 'all'], ['New', 'New', 'New'], ['Correction', 'Correction', 'Correction']].map(([value, label, key]) => (
                  <label key={label}>
                    <input type="radio" name="kind-filter" checked={kindFilter === value} onChange={() => { setKindFilter(value); setPage(1); }} />
                    <span>{t(label)} ({summary?.kinds?.[key] ?? 0})</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <button className="btn" disabled={!open.total} onClick={download}>{t('Download CSV')}</button>
        </div>

        {searchedPhone && (
          <button className="person-bar" onClick={() => showPerson(searchedPhone)}>
            {t('See all applications for {phone} in every service', { phone: `+91 ${searchedPhone.slice(2, 7)} ${searchedPhone.slice(7)}` })}
          </button>
        )}

        {!list && <SkeletonRows />}

        {list && (list.items.length ? (
          <>
            <ul className="rows">
              {list.items.map(c => (
                <CustomerRow
                  key={c.id}
                  c={c}
                  provider={providerOf(c)}
                  open={openId === c.id}
                  thud={thudId === c.id}
                  busy={checking === c.id}
                  chat={chat}
                  operators={operators}
                  onMoney={(x, m) => replace({ ...x, ...m })}
                  onRemind={x => setDialog({ kind: 'remind', customer: x })}
                  onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                  onStage={setStage}
                  onOpenSite={openSite}
                  onCheck={check}
                  onNotify={x => setDialog({ kind: 'notify', customer: x })}
                  onChat={chatSend}
                  onInformed={setInformed}
                  onEdit={x => setDialog({ kind: 'edit', customer: x })}
                  onDelete={x => setDialog({ kind: 'delete', customer: x })}
                  onAddNote={addNote}
                  onRemoveNote={removeNote}
                  onRemoveAadhaar={x => setDialog({ kind: 'aadhaar', customer: x })}
                  onPerson={showPerson}
                />
              ))}
            </ul>
            <Pager page={list.page} pages={list.pages} onPage={p => { setPage(p); window.scrollTo(0, 0); }} />
          </>
        ) : (
          <div className="empty">
            {search
              ? <p>{t('Nothing found for "{search}"', { search })}</p>
              : open.total
              ? <p>{t(view === 'informed' ? 'Customers you mark as informed appear here.' : 'No customers match this filter.')}</p>
              : <p>{t('{service} customers appear here with their application status.', { service: t(boxProvider?.shortName) })}</p>}
          </div>
        ))}
      </main>

      {scope.due > 0 && (
        <div className="send-bar">
          <div className="wrap send-in">
            <span>{t('{customers} approved or rejected', { customers: plural(scope.due, 'customer') })}</span>
            <button className="btn ink" onClick={openSendList}>{t('Review and send WhatsApp')}</button>
          </div>
        </div>
      )}

      {dialog?.kind === 'add' && <AddCustomer key={`${box}-${panAgency}`} provider={boxProvider} agency={panAgency} operators={operators} onSave={addCustomer} onClose={() => setDialog(null)} />}

      {dialog?.kind === 'edit' && <AddCustomer provider={withAgency(providerOf(dialog.customer), dialog.customer.panAgency)} agency={dialog.customer.panAgency || ''} operators={operators} customer={dialog.customer} onSave={form => editCustomer(dialog.customer, form)} onClose={() => setDialog(null)} />}

      {dialog?.kind === 'send' && (
        <Dialog title={t('Send WhatsApp to {customers}', { customers: plural(chat ? dialog.list.length : scope.due, 'customer') })} onClose={() => setDialog(null)}>
          {chat && <p className="quiet">{t('Click Send for each customer, then press send in WhatsApp.')}</p>}
          <ul className="send-list">
            {(chat ? dialog.list : waiting).map(c => (
              <li key={c.id}>
                <span>{c.name}<span className="quiet">{t(providers.find(p => p.id === c.type)?.name)}</span></span>
                <span className="send-end">
                  <span className={`tag ${/reject/i.test(c.status) ? 'bad' : 'ok'}`}>{t(c.status)}</span>
                  {chat && (chatOpened[c.id]
                    ? <button className="btn" onClick={() => chatUndoFromList(c)}>{t('Not sent')}</button>
                    : <button className="btn primary" onClick={() => chatSendFromList(c)}>{t('Send')}</button>)}
                </span>
              </li>
            ))}
          </ul>
          {scope.due > waiting.length && <p className="quiet">{t('and {n} more', { n: scope.due - waiting.length })}</p>}
          <div className="dialog-foot">
            <button className="btn" onClick={() => setDialog(null)}>{t(chat ? 'Close' : 'Cancel')}</button>
            {!chat && <button className="btn primary" disabled={sending} onClick={sendAll}>{sending ? t('Sending…') : t('Send to {customers}', { customers: plural(scope.due, 'customer') })}</button>}
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'notify' && (
        <Dialog title={t('Send this update?')} onClose={() => setDialog(null)}>
          <p>{t('{name} will get "{status}" on WhatsApp.', { name: dialog.customer.name, status: t(dialog.customer.status) })}</p>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setDialog(null)}>{t('Cancel')}</button>
            <button className="btn primary" onClick={() => notify(dialog.customer)}>{t('Send update')}</button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'remind' && (
        <RemindDialog
          name={dialog.customer.name}
          target={{ customerId: dialog.customer.id }}
          current={dialog.customer.followUp}
          onClose={closeDialog}
          onSaved={f => {
            setDialog(null);
            replace({ ...dialog.customer, followUp: f && { id: f.id, dueOn: f.dueOn, note: f.note } });
            toast(f ? t('Reminder set for {day}', { day: dayText(f.dueOn) }) : t('Reminder removed'));
          }}
        />
      )}
      {dialog?.kind === 'person' && <PersonApplications whatsapp={dialog.whatsapp} providers={providers} onOpen={openApplication} onClose={closeDialog} />}

      {dialog?.kind === 'aadhaar' && (
        <Dialog title={t('Remove this Aadhaar number?')} onClose={() => setDialog(null)}>
          <p>{t("{name}'s Aadhaar number will be deleted. This can't be undone.", { name: dialog.customer.name })}</p>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setDialog(null)}>{t('Cancel')}</button>
            <button className="btn stop-solid" onClick={() => removeAadhaar(dialog.customer)}>{t('Remove')}</button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'delete' && (
        <Dialog title={t('Delete this customer?')} onClose={() => setDialog(null)}>
          <p>{t("{name} ({number}) and their history will be removed. This can't be undone.", { name: dialog.customer.name, number: dialog.customer.applicationNo })}</p>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setDialog(null)}>{t('Cancel')}</button>
            <button className="btn stop-solid" onClick={() => remove(dialog.customer)}>{t('Delete customer')}</button>
          </div>
        </Dialog>
      )}

      <div className="toasts" role="status">
        {toasts.map(x => (
          <div key={x.id} className="toast">
            <span>{x.text}</span>
            {x.action && <button onClick={() => { setToasts(l => l.filter(y => y.id !== x.id)); x.action.run(); }}>{x.action.label}</button>}
          </div>
        ))}
      </div>
    </>
  );
}
