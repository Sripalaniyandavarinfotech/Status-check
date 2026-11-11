import { useCallback, useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { Field, Select } from './Fields.jsx';
import Header from './Header.jsx';
import { SkeletonRows } from './Skeleton.jsx';
import { t } from './i18n.js';
import { api, showError } from './lib.js';

// The admin's page for telling shops about updates, price changes and other news.
// Shops see these in the bell at the top of their pages.

const KINDS = [['update', 'Update'], ['price', 'Price change'], ['notice', 'Notice']];
const blank = { kind: 'update', title: '', body: '', to: '', important: false, price: '', startsOn: '' };

const sentOn = iso => new Date(iso).toLocaleString(document.documentElement.lang === 'ta' ? 'ta-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const longDate = d => new Date(`${d}T00:00:00`).toLocaleDateString(document.documentElement.lang === 'ta' ? 'ta-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

export default function AdminNotices({ user, onLogout }) {
  const [list, setList] = useState(null);
  const [shops, setShops] = useState([]);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [removing, setRemoving] = useState(null);

  const load = useCallback(() => api('admin/notices').then(setList).catch(showError), []);
  useEffect(() => {
    load();
    api('admin/users').then(u => setShops(u.filter(x => x.status === 'active'))).catch(() => {});
  }, [load]);

  const set = key => e => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function send(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('admin/notices', {
        method: 'POST',
        body: { ...form, price: form.kind === 'price' ? Number(form.price) : undefined, important: form.important || form.kind === 'price' },
      });
      setForm(blank);
      setResult('done');
      setTimeout(() => setResult(''), 1400);
      load();
    } catch (err) {
      setError(t(err.message));
      setResult('error');
      setTimeout(() => setResult(''), 500);
    }
    setBusy(false);
  }

  async function remove() {
    const n = removing;
    setRemoving(null);
    try {
      await api(`admin/notices/${n.id}/delete`, { method: 'POST' });
      load();
    } catch (err) {
      showError(err);
    }
  }

  const price = form.kind === 'price';
  return (
    <>
      <Header user={user} onLogout={onLogout} />
      <main className="wrap notices-admin">
        <section className="lead">
          <h1>{t('Notices')}</h1>
          <p className="quiet">{t('Tell shops about new features, updates and price changes. They see these in the bell at the top of their pages.')}</p>
        </section>

        <form className="dash-card notice-form" onSubmit={send} noValidate>
          <h2>{t('New notice')}</h2>
          {error && <p className="warn" role="alert">{error}</p>}
          <fieldset className="pick">
            <legend>{t('What is it about?')}</legend>
            <div>
              {KINDS.map(([k, label]) => (
                <label key={k}>
                  <input type="radio" name="kind" value={k} checked={form.kind === k} onChange={set('kind')} />
                  <span>{t(label)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field">
            <label htmlFor="notice-to">{t('Send to')}</label>
            <Select
              id="notice-to"
              value={form.to}
              options={[{ value: '', label: t('Every shop') }, ...shops.map(s => ({ value: s.userId, label: s.userId }))]}
              onChange={v => setForm({ ...form, to: v })}
            />
          </div>

          <Field id="notice-title" label={t('Title')} value={form.title} onChange={set('title')} maxLength={120}
            placeholder={price ? t('For example: New monthly price from January') : t('For example: PAN NSDL receipts can now be uploaded')} />

          {price && (
            <div className="notice-price-row">
              <Field id="notice-price" label={t('New price a month (₹)')} type="number" inputMode="numeric" min="1" value={form.price} onChange={set('price')} />
              <Field id="notice-start" label={t('Starts on')} type="date" value={form.startsOn} onChange={set('startsOn')} />
            </div>
          )}

          <div className="field">
            <label htmlFor="notice-body">{t('Message')}</label>
            <textarea id="notice-body" rows={5} maxLength={2000} value={form.body} onChange={set('body')}
              placeholder={price ? t('Explain why the price is changing and what stays the same.') : t('What changed, and what shops should do, if anything.')} />
          </div>

          <label className="check-line">
            <input type="checkbox" checked={price || form.important} disabled={price} onChange={set('important')} />
            <span>{t('Important: also show a strip at the top of every page until they read it')}</span>
          </label>
          {price && <p className="quiet">{t('Price changes are always important, so every shop sees them.')}</p>}

          <button className={`btn primary wide save-btn ${busy ? 'busy' : result}`} disabled={busy}>
            {busy ? <><i className="save-spin" aria-hidden="true" />{t('Sending…')}</>
              : result === 'done' ? <><i className="save-tick" aria-hidden="true" />{t('Sent')}</>
                : t('Send notice')}
          </button>
        </form>

        <section className="dash-card">
          <div className="dash-card-head"><h2>{t('Sent notices')}</h2></div>
          {!list ? <SkeletonRows count={3} /> : !list.length ? (
            <p className="quiet dash-empty">{t('Nothing sent yet.')}</p>
          ) : (
            <ul className="sent-notices">
              {list.map(n => (
                <li key={n.id}>
                  <div>
                    <p className="notice-meta">
                      <span className={`kind-tag ${n.kind}`}>{t(KINDS.find(k => k[0] === n.kind)?.[1] || 'Notice')}</span>
                      <span>{sentOn(n.at)}</span>
                      <span>{n.to ? t('To {shop}', { shop: n.to }) : t('To every shop')}</span>
                      {n.important && <span>{t('Important')}</span>}
                    </p>
                    <h3>{n.title}</h3>
                    {n.kind === 'price' && <p className="notice-price">{t('New price ₹{price} a month from {date}', { price: n.price, date: longDate(n.startsOn) })}</p>}
                    <p className="notice-body">{n.body}</p>
                  </div>
                  <div className="sent-side">
                    <span className="quiet">{t('Read by {n} of {total}', { n: n.reads, total: n.audience })}</span>
                    <button className="link-btn" onClick={() => setRemoving(n)}>{t('Delete')}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {removing && (
        <Dialog title={t('Delete this notice?')} alert onClose={() => setRemoving(null)}>
          <p>{t('"{title}" will disappear from every shop\'s notices. This can\'t be undone.', { title: removing.title })}</p>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setRemoving(null)}>{t('Cancel')}</button>
            <button className="btn stop" onClick={remove}>{t('Delete')}</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
