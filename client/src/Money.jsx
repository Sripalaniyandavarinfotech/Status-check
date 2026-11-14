import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import Header from './Header.jsx';
import { SkeletonRows } from './Skeleton.jsx';
import { t, tamil } from './i18n.js';
import { api, leave, phone, rs, serviceHref, showError, when } from './lib.js';

// Payment: each customer or TTD booking is marked Paid or Not paid. The amounts
// (fee, amounts taken in cash or UPI) are optional detail inside a closed box.

const due = (fee, paid) => (fee == null ? 0 : Math.max(0, fee - paid));

// "Paid" or "Not paid" beside a customer, with the amount left when one was entered.
export function MoneyTag({ payment, fee, paid }) {
  if (payment === 'paid') return <span key="paid" className="money-tag paid">{t('Paid')}</span>;
  if (payment !== 'unpaid') return null;
  const left = due(fee, paid);
  return <span key="unpaid" className="money-tag due">{left ? t('Not paid · {amount}', { amount: rs(left) }) : t('Not paid')}</span>;
}

// The two-button Paid / Not paid choice.
export function PaymentPick({ value, onChange, disabled }) {
  return (
    <div className="seg-pick pay-pick" role="radiogroup" aria-label={t('Payment')}>
      {[['paid', 'Paid'], ['unpaid', 'Not paid']].map(([v, label]) => (
        <button type="button" key={v} role="radio" aria-checked={value === v} className={`${value === v ? 'on' : ''} ${v}`} disabled={disabled} onClick={() => onChange(v)}>{t(label)}</button>
      ))}
    </div>
  );
}

const whole = v => /^\d{1,6}$/.test(String(v).trim()) && Number(v) <= 100000;

// Paid or not paid, and the optional amounts. `target` is { customerId } or
// { ttdId }. `onChange` gets the new { payment, fee, paid, payments }.
export function MoneyBox({ target, payment, fee, paid, payments, operators = [], onChange }) {
  const left = payment === 'paid' ? 0 : due(fee, paid); // marked paid means nothing is left
  const [feeText, setFeeText] = useState(fee == null ? '' : String(fee));
  const [amount, setAmount] = useState(left ? String(left) : '');
  const [mode, setMode] = useState('cash');
  const [operatorId, setOperatorId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setFeeText(fee == null ? '' : String(fee)); }, [fee]);
  useEffect(() => { setAmount(left ? String(left) : ''); }, [left]);

  async function run(work) {
    setBusy(true);
    try {
      const s = await work();
      onChange({ payment: s.payment, fee: s.fee, paid: s.paid, payments: s.payments });
    } catch (e) {
      showError(e);
    }
    setBusy(false);
  }

  const saveFee = e => {
    e.preventDefault();
    const v = feeText.trim();
    if (v && !whole(v)) return showError({ status: 400, message: 'Enter the fee in whole rupees' });
    if ((v === '' ? null : Number(v)) === fee) return undefined;
    return run(() => api('money/fee', { method: 'POST', body: { ...target, fee: v === '' ? null : Number(v) } }));
  };

  const pay = e => {
    e.preventDefault();
    if (!whole(amount) || !Number(amount)) return showError({ status: 400, message: 'Enter the amount paid in whole rupees' });
    return run(() => api('money/payments', { method: 'POST', body: { ...target, amount: Number(amount), mode, operatorId: operatorId || undefined } }));
  };

  return (
    <section className="money">
      <h3>{t('Payment')}</h3>
      <PaymentPick value={payment} disabled={busy} onChange={v => run(() => api('money/status', { method: 'POST', body: { ...target, payment: v } }))} />
      <details className="money-more" open={fee != null || payments.length > 0 || undefined}>
      <summary>{t('Amount details (optional)')}</summary>
      <div className="money-sum">
        <span><small>{t('Fee')}</small><b>{fee == null ? '–' : rs(fee)}</b></span>
        <span><small>{t('Paid')}</small><b>{rs(paid)}</b></span>
        <span className={left ? 'owed' : ''}><small>{t('Due')}</small><b>{rs(left)}</b></span>
      </div>
      <form className="money-line" onSubmit={saveFee}>
        <label>
          <span>{t('Fee (₹)')}</span>
          <input inputMode="numeric" value={feeText} placeholder={t('No fee')} onChange={e => setFeeText(e.target.value.replace(/\D/g, ''))} onBlur={saveFee} />
        </label>
      </form>
      {(fee == null || left > 0 || !payments.length) && (
        <form className="money-pay" onSubmit={pay}>
          <label>
            <span>{t('Amount (₹)')}</span>
            <input inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value.replace(/\D/g, ''))} />
          </label>
          <div className="seg-pick" role="radiogroup" aria-label={t('Paid by')}>
            {[['cash', 'Cash'], ['upi', 'UPI']].map(([v, label]) => (
              <button type="button" key={v} role="radio" aria-checked={mode === v} className={mode === v ? 'on' : ''} onClick={() => setMode(v)}>{t(label)}</button>
            ))}
          </div>
          {operators.length > 0 && (
            <label>
              <span>{t('Taken by')}</span>
              <select value={operatorId} onChange={e => setOperatorId(e.target.value)}>
                <option value="">{t('No operator')}</option>
                {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          )}
          <button className="btn primary" disabled={busy}>{t('Add payment')}</button>
        </form>
      )}
      {payments.length > 0 && (
        <ul className="money-list">
          {payments.map(p => (
            <li key={p.id}>
              <b>{rs(p.amount)}</b>
              <span>{t(p.mode === 'upi' ? 'UPI' : 'Cash')}</span>
              <span className="quiet">{when(p.at)}, {p.by}</span>
              <button className="link-btn" disabled={busy} onClick={() => run(() => api(`money/payments/${p.id}`, { method: 'DELETE' }))}>{t('Remove')}</button>
            </li>
          ))}
        </ul>
      )}
      </details>
    </section>
  );
}

// The same box in a dialog, for TTD bookings and the dues list.
export function MoneyDialog({ title, target, onClose, onChange }) {
  const [state, setState] = useState(null);
  const [operators, setOperators] = useState([]);
  useEffect(() => {
    const q = target.customerId ? `customerId=${encodeURIComponent(target.customerId)}` : target.caseId ? `caseId=${encodeURIComponent(target.caseId)}` : `ttdId=${encodeURIComponent(target.ttdId)}`;
    api(`money/state?${q}`).then(setState).catch(e => { showError(e); onClose(); });
    api('operators').then(setOperators).catch(() => {});
  }, [target.customerId, target.ttdId, target.caseId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog title={title} onClose={onClose}>
      {!state ? <p className="quiet">{t('Loading…')}</p> : (
        <MoneyBox target={target} {...state} operators={operators} onChange={s => { setState(s); onChange?.(s); }} />
      )}
    </Dialog>
  );
}

const PRICE_ROWS = [
  ['certificate', 'TNeDistrict certificate'], ['smartcard', 'TNPDS ration card'], ['voter', 'Voter ID'], ['aadhaar', 'Aadhaar'], ['aadhaar-name', 'Aadhaar name change'], ['pan', 'PAN card'],
  ['ttd:sed300', 'TTD ₹300 Darshan, per person'], ['ttd:angapradakshinam', 'TTD Angapradakshinam, per person'], ['ttd:edip', 'TTD E-DIP, per person'], ['ttd:senior', 'TTD Senior citizen, per person'],
];

// Profile: the shop's own price list, filled in when a customer is added.
export function PriceList() {
  const [list, setList] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api('money/prices').then(p => { setList(p); setForm(Object.fromEntries(PRICE_ROWS.map(([k]) => [k, p[k] == null ? '' : String(p[k])]))); }).catch(showError);
  }, []);

  async function save(e) {
    e.preventDefault();
    if (Object.values(form).some(v => v && !whole(v))) return showError({ status: 400, message: 'Enter prices in whole rupees, up to ₹1,00,000' });
    setBusy(true);
    try {
      const p = await api('money/prices', { method: 'POST', body: { prices: Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : Number(v)])) } });
      setList(p);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      showError(err);
    }
    setBusy(false);
    return undefined;
  }

  return (
    <section className="card" aria-labelledby="prices-title">
      <h2 id="prices-title" className="report-title">{t('Price list')}</h2>
      <p className="quiet">{t('Your service charge for each service. It is filled in when you add a customer, and can be changed there.')}</p>
      {!list ? <p className="quiet">{t('Loading…')}</p> : (
        <form className="price-form" onSubmit={save}>
          {PRICE_ROWS.map(([key, label]) => (
            <label key={key}>
              <span>{t(label)}</span>
              <span className="price-input"><i aria-hidden="true">₹</i><input inputMode="numeric" value={form[key]} placeholder="–" onChange={e => setForm({ ...form, [key]: e.target.value.replace(/\D/g, '') })} /></span>
            </label>
          ))}
          <div className="price-foot">
            <button className="btn primary" disabled={busy}>{t(saved ? 'Saved' : 'Save prices')}</button>
          </div>
        </form>
      )}
    </section>
  );
}

const SERVICE_NAMES = { certificate: 'TNeDistrict', smartcard: 'TNPDS', voter: 'Voter', aadhaar: 'Aadhaar', pan: 'PAN', sed300: 'TTD ₹300 Darshan', angapradakshinam: 'TTD Angapradakshinam', edip: 'TTD E-DIP', senior: 'TTD Senior citizen', 'aadhaar-name': 'Aadhaar name change' };

// A polite reminder in Tamil, from the shop's own WhatsApp. The amount only when known.
const reminderLink = d => {
  const values = { name: d.name, amount: rs(d.due), service: tamil(SERVICE_NAMES[d.type] || d.type) };
  const text = d.due
    ? tamil('Hello {name}, {amount} is still due for your {service} application. Please pay when you next visit. Thank you.', values)
    : tamil('Hello {name}, the payment for your {service} application is still pending. Please pay when you next visit. Thank you.', values);
  return `https://wa.me/${d.whatsapp}?text=${encodeURIComponent(text)}`;
};

// /dues: customers and TTD bookings marked "Not paid", oldest first.
export function DuesPage({ user, onLogout }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(null);
  const [leaving, setLeaving] = useState(null);
  const load = () => api('money/dues').then(setList).catch(showError);
  useEffect(() => { load(); }, []);
  const target = d => (d.kind === 'ttd' ? { ttdId: d.id } : d.kind === 'case' ? { caseId: d.id } : { customerId: d.id });

  async function markPaid(d) {
    setBusy(d.id);
    try {
      await api('money/status', { method: 'POST', body: { ...target(d), payment: 'paid' } });
      setLeaving(`${d.kind}-${d.id}`);
      await leave();
      setList(l => l.filter(x => !(x.kind === d.kind && x.id === d.id)));
    } catch (e) {
      showError(e);
    }
    setBusy(null);
  }

  return (
    <>
      <Header user={user} onLogout={onLogout} current="/dues" counts={list ? { '/dues': { n: list.length, due: 0 } } : undefined} />
      <main className="wrap task-page">
        <section className="lead">
          <h1>{t('Not paid')}</h1>
          <p className="quiet">{list ? (list.length ? t('{n} not paid yet', { n: list.length }) : t('Everyone has paid.')) : ''}</p>
        </section>
        {!list ? <SkeletonRows count={4} /> : list.length > 0 && (
          <ul className="task-list">
            {list.map(d => (
              <li key={`${d.kind}-${d.id}`} className={`task ${leaving === `${d.kind}-${d.id}` ? 'leaving' : ''}`}>
                <div className="task-who">
                  <b>{d.name || t('TTD booking')}</b>
                  <span className="quiet">{t(SERVICE_NAMES[d.type] || d.type)}{d.agency ? ` ${d.agency}` : ''}{d.applicationNo ? ` · ${d.applicationNo}` : ''} · {phone(d.whatsapp)}</span>
                </div>
                <div className="task-what">
                  {d.due ? <b className="owed">{rs(d.due)}</b> : <span className="money-tag due">{t('Not paid')}</span>}
                  {d.fee != null && <span className="quiet">{t('{paid} of {fee} paid', { paid: rs(d.paid), fee: rs(d.fee) })}</span>}
                </div>
                <div className="task-tools">
                  <button className="btn good" disabled={busy === d.id} onClick={() => markPaid(d)}>{t('Mark paid')}</button>
                  <a className="btn" href={reminderLink(d)} target="_blank" rel="noopener noreferrer">{t('Remind on WhatsApp')}</a>
                  <button className="btn" onClick={() => setOpen(d)}>{t('Amounts')}</button>
                  <a className="link-btn" href={d.kind === 'ttd' ? '/ttd' : d.kind === 'case' ? '/aadhaar/name' : serviceHref(d.type, d.agency, d.applicationNo)}>{t('Open')}</a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
      {open && (
        <MoneyDialog
          title={t('Payment: {name}', { name: open.name || t('TTD booking') })}
          target={target(open)}
          onClose={() => { setOpen(null); load(); }}
        />
      )}
    </>
  );
}
