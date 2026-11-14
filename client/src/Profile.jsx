import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { Field, PasswordField } from './Fields.jsx';
import Header from './Header.jsx';
import { PriceList } from './Money.jsx';
import { SkeletonTiles } from './Skeleton.jsx';
import { plural, t } from './i18n.js';
import { api, monthName, phone, showError, shortMonth } from './lib.js';
import { ServicesTable } from './Pages.jsx';

// Validated together for colour blindness. In this order: see the legend below.
const STAGES = [
  { key: 'approved', label: 'Approved', color: '#3e5a3f' },
  { key: 'progress', label: 'In progress', color: '#b08d57' },
  { key: 'rejected', label: 'Rejected', color: '#a8352c' },
  { key: 'new', label: 'No status yet', color: '#8ca98c' },
];

function Tile({ label, value, note }) {
  return (
    <div className="tile">
      <span>{label}</span>
      <b>{value}</b>
      {note && <small>{note}</small>}
    </div>
  );
}

// One series, so the title names it and no legend is needed.
function MonthsChart({ months }) {
  const oldestFirst = [...months].reverse();
  const top = Math.max(...oldestFirst.map(m => m.added));
  return (
    <figure className="chart">
      <figcaption>{t('Applications added each month')}</figcaption>
      {top === 0 ? <p className="quiet">{t('Add customers to see reports here.')}</p> : (
        <div className="month-bars">
          {oldestFirst.map(m => (
            <div key={m.month} className="month-bar" tabIndex={0} aria-label={`${monthName(m.month)}: ${m.added}`}>
              <div className="bar-space">
                <i style={{ height: `${(m.added / top) * 100}%` }} className={m.added ? '' : 'zero'} />
                <span className="tip">{monthName(m.month)}: {m.added}</span>
              </div>
              <small>{shortMonth(m.month)}</small>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

function ServicesChart({ services, nameOf }) {
  const top = Math.max(0, ...services.map(s => s.total));
  return (
    <figure className="chart">
      <figcaption>{t('Status by service')}</figcaption>
      {!services.length ? <p className="quiet">{t('Add customers to see reports here.')}</p> : (
        <>
          <ul className="legend">
            {STAGES.map(s => <li key={s.key}><i style={{ background: s.color }} />{t(s.label)}</li>)}
          </ul>
          <div className="service-bars">
            {services.map(s => (
              <div key={s.type} className="service-bar">
                <span className="service-name">{nameOf(s.type)}</span>
                <div className="stack" style={{ width: `${(s.total / top) * 100}%` }}>
                  {STAGES.filter(x => s[x.key] > 0).map(x => (
                    <div key={x.key} className="segment" tabIndex={0} style={{ flexGrow: s[x.key], background: x.color }} aria-label={`${nameOf(s.type)}, ${t(x.label)}: ${s[x.key]}`}>
                      <span className="tip">{t(x.label)}: {s[x.key]}</span>
                    </div>
                  ))}
                </div>
                <span className="service-total">{s.total}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </figure>
  );
}

function OperatorRow({ operator, onSaved, onDelete }) {
  const [name, setName] = useState(null); // the name being typed, while editing
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved(await api(`operators/${operator.id}`, { method: 'POST', body: { name } }));
      setName(null);
    } catch (err) {
      showError(err);
    }
    setBusy(false);
  }

  if (name === null) {
    return (
      <li>
        <span>{operator.name}</span>
        <span className="operator-tools">
          <button className="btn" onClick={() => setName(operator.name)}>{t('Edit')}</button>
          <button className="btn stop" onClick={() => onDelete(operator)}>{t('Delete')}</button>
        </span>
      </li>
    );
  }

  return (
    <li>
      <form className="operator-form" onSubmit={save}>
        <input aria-label={t('Operator name')} value={name} maxLength={60} autoFocus onChange={e => setName(e.target.value)} />
        <button className="btn primary" disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
        <button type="button" className="btn" onClick={() => setName(null)}>{t('Cancel')}</button>
      </form>
    </li>
  );
}

function Operators() {
  const [list, setList] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const sorted = l => [...l].sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => { api('operators').then(setList).catch(showError); }, []);

  async function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const added = await api('operators', { method: 'POST', body: { name } });
      setList(l => sorted([...l, added]));
      setName('');
    } catch (err) {
      showError(err);
    }
    setBusy(false);
  }

  async function remove() {
    const { id } = deleting;
    setDeleting(null);
    try {
      await api(`operators/${id}`, { method: 'DELETE' });
      setList(l => l.filter(o => o.id !== id));
    } catch (err) {
      showError(err);
    }
  }

  return (
    <section className="card" aria-labelledby="operators-title">
      <h2 id="operators-title" className="report-title">{t('Operators')}</h2>
      <p className="quiet">{t('These names appear in the selection box when you add a customer.')}</p>
      <form className="operator-form operator-add" onSubmit={add}>
        <input aria-label={t('Operator name')} placeholder={t('Operator name')} value={name} maxLength={60} onChange={e => setName(e.target.value)} />
        <button className="btn primary" disabled={busy || !name.trim()}>{t('Add operator')}</button>
      </form>
      {list?.length > 0 && (
        <ul className="operator-list">
          {list.map(o => <OperatorRow key={o.id} operator={o} onSaved={saved => setList(l => sorted(l.map(x => (x.id === o.id ? { ...x, name: saved.name } : x))))} onDelete={setDeleting} />)}
        </ul>
      )}
      {deleting && (
        <Dialog title={t('Delete {name}?', { name: deleting.name })} onClose={() => setDeleting(null)}>
          <p>{t('Their customers stay, but will show no operator.')}</p>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setDeleting(null)}>{t('Cancel')}</button>
            <button className="btn stop-solid" onClick={remove}>{t('Delete operator')}</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function ChangePassword() {
  const empty = { current: '', password: '', again: '' };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const change = key => e => { setForm({ ...form, [key]: e.target.value }); setDone(false); };

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
      setForm(empty);
      setDone(true);
    } catch (err) {
      showError(err);
    }
    setBusy(false);
  }

  return (
    <section className="card" aria-labelledby="password-title">
      <h2 id="password-title" className="report-title">{t('Change password')}</h2>
      {done && <p className="saved" role="status">{t('Your password has been changed')}</p>}
      <form className="password-form" onSubmit={submit} noValidate>
        <PasswordField id="current" label={t('Old password')} error={errors.current} value={form.current} onChange={change('current')} autoComplete="current-password" />
        <PasswordField id="password" label={t('New password')} error={errors.password} value={form.password} onChange={change('password')} autoComplete="new-password" />
        <PasswordField id="again" label={t('New password again')} error={errors.again} value={form.again} onChange={change('again')} autoComplete="new-password" />
        <p className="quiet">{t('Your other devices will be logged out.')}</p>
        <button className="btn primary" disabled={busy}>{busy ? t('Saving…') : t('Change password')}</button>
      </form>
    </section>
  );
}

function ResetData({ onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!password) return setError(t('Enter your password'));
    setBusy(true);
    try {
      const { removed } = await api('reset-data', { method: 'POST', body: { password } });
      onDone(removed);
    } catch (err) {
      showError(err);
      setBusy(false);
    }
    return undefined;
  }

  return (
    <Dialog title={t('Reset all my data?')} alert onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="warn">{t("This permanently removes all your customers, notes and WhatsApp history. This can't be undone.")}</p>
        <p className="quiet reset-note">{t('Your login stays, and other users are not affected. Use Download CSV first if you want a copy.')}</p>
        <PasswordField id="reset-password" label={t('Enter your password to confirm')} error={error} value={password} onChange={e => { setPassword(e.target.value); setError(''); }} autoComplete="current-password" />
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn stop-solid" disabled={busy}>{busy ? t('Deleting…') : t('Delete all my data')}</button>
        </div>
      </form>
    </Dialog>
  );
}

export default function ProfilePage({ user, onLogout }) {
  const admin = user.role === 'admin';
  const [me, setMe] = useState(null);
  const [report, setReport] = useState(null);
  const [providers, setProviders] = useState([]);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => { api('profile').then(setMe).catch(showError); }, []);

  useEffect(() => {
    if (admin) return;
    api('reports').then(setReport).catch(showError);
    api('providers').then(setProviders).catch(() => {});
  }, [admin, reload]);

  const nameOf = type => t(providers.find(p => p.id === type)?.shortName || type);
  const place = type => providers.findIndex(p => p.id === type);
  const services = [...(report?.services || [])].sort((a, b) => place(a.type) - place(b.type)); // the same order as the boxes
  const total = key => report?.services.reduce((n, s) => n + s[key], 0) ?? 0;

  return (
    <>
      <Header user={user} onLogout={onLogout} noNav />
      <main className="wrap profile">
        <a className="back-link" href={admin ? '/admin' : '/'}>{t(admin ? 'Back to users' : 'Back to customers')}</a>
        <section className="lead profile-head">
          <span className="profile-icon" aria-hidden="true">{user.userId[0].toUpperCase()}</span>
          <div>
            <h1>{user.userId}</h1>
            {me && (
              <p className="quiet">
                {[me.phone && phone(`91${me.phone}`), me.email, `${t('Member since')} ${monthName(me.createdAt.slice(0, 7))}`].filter(Boolean).join('  |  ')}
              </p>
            )}
          </div>
        </section>

        {!report && !admin && <SkeletonTiles />}
        {report && (
          <>
            <section aria-label={t('Summary')} className="tiles">
              <Tile label={t('WhatsApp messages sent')} value={report.whatsapp.sent} note={t('{n} this month', { n: report.whatsapp.thisMonth })} />
              <Tile label={t('Applications')} value={total('total')} note={t('{n} this month', { n: report.months[0].added })} />
              <Tile label={t('In progress')} value={total('progress')} />
              <Tile label={t('Approved')} value={total('approved')} />
              <Tile label={t('Rejected')} value={total('rejected')} />
              <Tile label={t('Messages failed')} value={report.whatsapp.failed} />
            </section>

            <div className="charts">
              <MonthsChart months={report.months} />
              <ServicesChart services={services} nameOf={nameOf} />
            </div>

            {services.length > 0 && <ServicesTable services={services} nameOf={nameOf} />}
          </>
        )}

        {!admin && <PriceList />}

        {!admin && <Operators />}

        <ChangePassword />

        {!admin && report && (
          <section className="reset-box">
            <div>
              <h2 className="report-title">{t('Reset my data')}</h2>
              <p className="quiet">{t('Start again with an empty list. Your password is needed.')}</p>
            </div>
            <button className="btn stop" onClick={() => setAsking(true)}>{t('Reset my data')}</button>
          </section>
        )}
        {note && <p className="saved" role="status">{note}</p>}
      </main>
      {asking && <ResetData onClose={() => setAsking(false)} onDone={removed => { setAsking(false); setNote(plural(removed, 'customer') + ' ' + t('removed')); setReload(n => n + 1); }} />}
    </>
  );
}
