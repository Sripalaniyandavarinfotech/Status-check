import { useCallback, useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { SearchBox } from './Fields.jsx';
import Header from './Header.jsx';
import { SkeletonRows } from './Skeleton.jsx';
import TtdForm from './TtdForm.jsx';
import { plural, t } from './i18n.js';
import { api, phone, showError, when } from './lib.js';
import { KINDS, KIND_ORDER, dateText, groupName, ticketLink } from './ttdShared.js';

// /ttd: the TTD bookings. Prepare them before the quota opens, book them in booking
// mode, then save the ticket and send it to the customer on WhatsApp.

const VIEWS = [['ready', 'Ready to book'], ['booked', 'Booked'], ['failed', 'Failed'], ['', 'All']];
const STATUS = { ready: 'Ready', booked: 'Booked', failed: 'Failed' };

// Sends the ticket PDF as the request body.
async function uploadTicket(b, file) {
  const res = await fetch(`/api/ttd/${b.id}/ticket?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Please try again in a moment.'), { status: res.status });
  return data;
}

function Row({ b, onEdit, onChange, onDelete }) {
  const file = useRef(null);
  const [busy, setBusy] = useState(false);
  const run = async work => {
    setBusy(true);
    try { onChange(await work()); } catch (e) { showError(e); }
    setBusy(false);
  };
  return (
    <li className={`ttd-row ${b.status}`}>
      <div className="ttd-row-main">
        <div className="ttd-row-who">
          <b>{groupName(b)}</b>
          <span className="quiet">{b.pilgrims.map(p => p.name).join(', ')}</span>
        </div>
        <div className="ttd-row-what">
          <span className={`ttd-kind ${b.kind}`}>{t(KINDS[b.kind]?.short)}</span>
          <span>{dateText(b)}</span>
          <span className="quiet">{plural(b.pilgrims.length, 'pilgrim')} · {phone(b.whatsapp)}{b.operatorName ? ` · ${b.operatorName}` : ''}</span>
        </div>
        <div className="ttd-row-status">
          <span className={`tag ${b.status === 'booked' ? 'ok' : b.status === 'failed' ? 'bad' : ''}`}>{t(STATUS[b.status])}</span>
          {b.refNo && <span className="quiet">{t('Ref.')} {b.refNo}</span>}
          {b.sentAt && <span className="quiet">{t('Sent {when}', { when: when(b.sentAt) })}</span>}
        </div>
      </div>
      <div className="ttd-row-tools">
        {b.status === 'booked' && (
          <>
            <input ref={file} type="file" accept="application/pdf" hidden onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) run(() => uploadTicket(b, f)); }} />
            {b.hasTicket
              ? <a className="btn" href={`/api/ttd/${b.id}/ticket`} target="_blank" rel="noreferrer">{t('View ticket')}</a>
              : <button className="btn" disabled={busy} onClick={() => file.current.click()}>{t('Upload ticket PDF')}</button>}
            <a className="btn primary" href={ticketLink(b)} target="_blank" rel="noreferrer" onClick={() => run(() => api(`ttd/${b.id}/sent`, { method: 'POST' }))}>
              {t(b.sentAt ? 'Send again' : 'Send on WhatsApp')}
            </a>
          </>
        )}
        {b.status === 'failed' && <button className="btn" disabled={busy} onClick={() => run(() => api(`ttd/${b.id}/status`, { method: 'POST', body: { status: 'ready' } }))}>{t('Try again')}</button>}
        <button className="btn" onClick={() => onEdit(b)}>{t('Edit')}</button>
        <button className="link-btn" onClick={() => onDelete(b)}>{t('Delete')}</button>
      </div>
    </li>
  );
}

export default function Ttd({ user, onLogout }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState('ready');
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [operators, setOperators] = useState([]);
  const [editing, setEditing] = useState(null); // a booking, or {} for a new one
  const [removing, setRemoving] = useState(null);

  useEffect(() => { api('operators').then(setOperators).catch(() => {}); }, []);
  useEffect(() => {
    const timer = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(() => {
    const params = new URLSearchParams({ status: view, kind, q });
    return api(`ttd?${params}`).then(setData).catch(showError);
  }, [view, kind, q]);
  useEffect(() => { load(); }, [load]);

  const replace = b => setData(d => d && { ...d, items: d.items.map(x => (x.id === b.id ? b : x)) });

  async function remove() {
    const b = removing;
    setRemoving(null);
    try { await api(`ttd/${b.id}/delete`, { method: 'POST' }); load(); } catch (e) { showError(e); }
  }

  const counts = data?.counts;
  const openSide = () => window.open('/ttd/book?side=1', 'ttd-book', 'popup,width=470,height=900');

  return (
    <>
      <Header user={user} onLogout={onLogout} current="/ttd" counts={counts ? { '/ttd': { n: counts.ready, due: 0 } } : undefined} />
      <main className="wrap ttd-page">
        <section className="lead">
          <h1>{counts ? (counts.ready ? t('{n} TTD bookings ready to book', { n: counts.ready }) : t('TTD bookings')) : t('TTD bookings')}</h1>
          <div className="ttd-lead-tools">
            <a className="btn" href="/ttd/book">{t('Open booking mode')}</a>
            <button className="btn" onClick={openSide}>{t('Booking mode in a side window')}</button>
            <button className="btn primary" onClick={() => setEditing({})}>{t('Add TTD booking')}</button>
          </div>
        </section>

        <SearchBox label={t('Search TTD bookings')} placeholder={t('Search name, phone, email or reference number')} value={query} onChange={e => setQuery(e.target.value)} />

        <nav className="views" aria-label={t('Filter by status')}>
          {VIEWS.map(([v, label]) => (
            <button key={v || 'all'} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)}>
              <b>{counts ? counts[v || 'all'] : '…'}</b>
              {t(label)}
            </button>
          ))}
        </nav>

        <div className="pick kind-filter ttd-kinds" role="group" aria-label={t('Booking type')}>
          <div>
            {[['', 'All types'], ...KIND_ORDER.map(k => [k, KINDS[k].short])].map(([k, label]) => (
              <label key={k || 'all'}>
                <input type="radio" name="ttd-kind" checked={kind === k} onChange={() => setKind(k)} />
                <span>{t(label)}</span>
              </label>
            ))}
          </div>
        </div>

        {!data ? <SkeletonRows /> : data.items.length ? (
          <ul className="ttd-list">
            {data.items.map(b => <Row key={b.id} b={b} onEdit={setEditing} onChange={replace} onDelete={setRemoving} />)}
          </ul>
        ) : (
          <div className="empty">
            <p>{q ? t('No TTD bookings match this search.') : view === 'ready' ? t('Add the pilgrims before the quota opens, and they appear here, ready to book.') : t('No TTD bookings here yet.')}</p>
          </div>
        )}
      </main>

      {editing && (
        <TtdForm
          booking={editing.id ? editing : null}
          operators={operators}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {removing && (
        <Dialog title={t('Delete this TTD booking?')} alert onClose={() => setRemoving(null)}>
          <p>{t('{name} and the saved Aadhaar numbers will be deleted. This can\'t be undone.', { name: groupName(removing) })}</p>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setRemoving(null)}>{t('Cancel')}</button>
            <button className="btn stop" onClick={remove}>{t('Delete')}</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
