import { useCallback, useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import Header from './Header.jsx';
import { SkeletonTable } from './Skeleton.jsx';
import { t } from './i18n.js';
import { api, monthName, rs, showError } from './lib.js';
import { longDay } from './PlanPage.jsx';

// /admin/billing: payments to confirm, shops due soon or overdue, money received.
// Only plans and payments, never a shop's customers.

const PLAN_NAMES = { standard: 'Standard', premium: 'Premium' };
const STATES = { trial: 'Free trial', active: 'Active', grace: 'Grace days', readonly: 'Read-only' };
const TONES = { trial: '', active: 'ok', grace: 'bad', readonly: 'bad' };

export function PlanTag({ p }) {
  if (!p) return null;
  return (
    <span className="plan-cell">
      <span className={`tag ${TONES[p.status]}`}>{t(STATES[p.status])}</span>
      <small className="quiet">
        {p.plan ? t(PLAN_NAMES[p.plan]) : '–'}
        {p.endsOn ? ` · ${p.status === 'readonly' || p.status === 'grace' ? t('ended {day}', { day: longDay(p.endsOn) }) : t('until {day}', { day: longDay(p.endsOn) })}` : ''}
      </small>
    </span>
  );
}

// One shop's plan, from the users page: change it, give trial days, record money received.
export function ShopPlanDialog({ shop, onClose, onDone }) {
  const [tab, setTab] = useState('payment');
  const [form, setForm] = useState({ plan: shop.planState?.plan || 'standard', billing: shop.billing || 'monthly', amount: '', mode: 'upi', utr: '', note: '', days: '7' });
  const [busy, setBusy] = useState(false);
  const set = k => e => setForm({ ...form, [k]: e.target.value });
  const PRICES = { standard: { monthly: 399, yearly: 3990 }, premium: { monthly: 599, yearly: 5990 } };
  const amount = form.amount === '' ? String(PRICES[form.plan][form.billing]) : form.amount;

  async function run(path, body, done) {
    setBusy(true);
    try {
      await api(`admin/users/${shop.id}/${path}`, { method: 'POST', body });
      onDone(done);
    } catch (e) {
      showError(e);
      setBusy(false);
    }
  }

  return (
    <Dialog title={t('Plan for {user}', { user: shop.userId })} onClose={onClose}>
      <p className="quiet"><PlanTag p={shop.planState} /></p>
      <div className="seg-pick admin-plan-tabs" role="tablist">
        {[['payment', 'Record payment'], ['plan', 'Change plan'], ['trial', 'Trial days']].map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={tab === v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{t(label)}</button>
        ))}
      </div>
      {tab === 'payment' && (
        <form className="admin-plan-form" onSubmit={e => { e.preventDefault(); run('payment', { ...form, amount: Number(amount) }, t('Payment recorded for {user}', { user: shop.userId })); }}>
          <label>{t('Plan')}<select value={form.plan} onChange={set('plan')}><option value="standard">{t('Standard')}</option><option value="premium">{t('Premium')}</option></select></label>
          <label>{t('Period')}<select value={form.billing} onChange={set('billing')}><option value="monthly">{t('Monthly')}</option><option value="yearly">{t('Yearly')}</option></select></label>
          <label>{t('Amount received (₹)')}<input inputMode="numeric" value={amount} onChange={e => setForm({ ...form, amount: e.target.value.replace(/\D/g, '') })} /></label>
          <label>{t('Paid by')}<select value={form.mode} onChange={set('mode')}><option value="upi">UPI</option><option value="cash">{t('Cash')}</option><option value="bank">{t('Bank transfer')}</option><option value="other">{t('Other')}</option></select></label>
          <label>{t('Reference (optional)')}<input value={form.utr} maxLength={30} onChange={set('utr')} /></label>
          <label>{t('Note (optional)')}<input value={form.note} maxLength={200} onChange={set('note')} /></label>
          <p className="quiet">{t('The paid-until date moves on by one period, starting after what is already paid for.')}</p>
          <button className="btn primary" disabled={busy}>{t('Record and confirm')}</button>
        </form>
      )}
      {tab === 'plan' && (
        <form className="admin-plan-form" onSubmit={e => { e.preventDefault(); run('plan', { plan: form.plan }, t('{user} is now on {plan}', { user: shop.userId, plan: t(PLAN_NAMES[form.plan]) })); }}>
          <label>{t('Plan')}<select value={form.plan} onChange={set('plan')}><option value="standard">{t('Standard')}</option><option value="premium">{t('Premium')}</option></select></label>
          <p className="quiet">{t('Changes the plan now, without a payment. The paid-until date stays the same.')}</p>
          <button className="btn primary" disabled={busy}>{t('Change plan')}</button>
        </form>
      )}
      {tab === 'trial' && (
        <form className="admin-plan-form" onSubmit={e => { e.preventDefault(); run('trial', { days: Number(form.days) }, t('Trial extended for {user}', { user: shop.userId })); }}>
          <label>{t('Add days of free Premium')}<input inputMode="numeric" value={form.days} onChange={e => setForm({ ...form, days: e.target.value.replace(/\D/g, '') })} /></label>
          <button className="btn primary" disabled={busy}>{t('Extend trial')}</button>
        </form>
      )}
    </Dialog>
  );
}

export default function AdminBilling({ user, onLogout }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(() => api('admin/billing').then(setData).catch(showError), []);
  useEffect(() => { load(); }, [load]);

  async function decide(p, action, body) {
    setBusy(p.id);
    try {
      const r = await api(`admin/payments/${p.id}/${action}`, { method: 'POST', body });
      setNote(action === 'confirm' ? t('Confirmed {user}: receipt {no}', { user: p.shop, no: r.receipt }) : t('Marked as not received: {user}', { user: p.shop }));
      setRejecting(null);
      setReason('');
      load();
    } catch (e) {
      showError(e);
    }
    setBusy(null);
  }

  return (
    <>
      <Header user={user} onLogout={onLogout} current="/admin/billing" />
      <main className="wrap billing-page">
        <section className="lead"><h1>{t('Billing')}</h1></section>
        {note && <p className="saved" role="status">{note}</p>}
        {!data ? <SkeletonTable rows={4} cols={5} /> : (
          <>
            {!data.upi.id && !data.upi.hasQr && (
              <p className="warn">{t('Shops cannot pay yet: add UPI_ID to .env (and optionally save your UPI QR image as data/upi-qr.png), then restart the server.')}</p>
            )}
            <section className="dash-tiles" aria-label={t('Shops')}>
              <div className="dash-tile"><span className="dash-tile-label">{t('Paying shops')}</span><b className="dash-tile-value">{data.counts.active}</b><span className="dash-tile-note">{t('{s} Standard · {p} Premium', { s: data.counts.standard, p: data.counts.premium })}</span></div>
              <div className="dash-tile"><span className="dash-tile-label">{t('On free trial')}</span><b className="dash-tile-value">{data.counts.trial}</b></div>
              <div className={`dash-tile ${data.counts.grace + data.counts.readonly ? 'alert' : ''}`}><span className="dash-tile-label">{t('Overdue')}</span><b className="dash-tile-value">{data.counts.grace + data.counts.readonly}</b><span className="dash-tile-note">{t('{g} in grace · {r} read-only', { g: data.counts.grace, r: data.counts.readonly })}</span></div>
              <div className="dash-tile"><span className="dash-tile-label">{t('Received this month')}</span><b className="dash-tile-value">{rs(data.months[0]?.month === new Date().toISOString().slice(0, 7) ? data.months[0].total : 0)}</b></div>
            </section>

            <section className="dash-card">
              <div className="dash-card-head"><h2>{t('Payments to confirm')}</h2><span className="quiet">{t('Check each one in your bank or UPI app first')}</span></div>
              {data.pending.length ? (
                <ul className="task-list">
                  {data.pending.map(p => (
                    <li key={p.id} className="task">
                      <div className="task-who"><b>{p.shop}</b><span className="quiet">{t(PLAN_NAMES[p.plan])}{p.kind === 'upgrade' ? ` · ${t('upgrade')}` : ` · ${t(p.billing)}`} · {new Date(p.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
                      <div className="task-what"><b className="owed">{rs(p.amount)}</b><span className="quiet">UTR {p.utr}</span></div>
                      <div className="task-tools">
                        <button className="btn good" disabled={busy === p.id} onClick={() => decide(p, 'confirm')}>{t('Confirm received')}</button>
                        <button className="btn stop" disabled={busy === p.id} onClick={() => setRejecting(p)}>{t('Not received')}</button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="quiet dash-empty">{t('Nothing waiting.')}</p>}
            </section>

            <div className="report-grid">
              <section className="dash-card">
                <div className="dash-card-head"><h2>{t('Due in the next 7 days')}</h2></div>
                {data.dueSoon.length ? (
                  <ul className="billing-list">{data.dueSoon.map(s => <li key={s.id}><b>{s.userId}</b><PlanTag p={s} /></li>)}</ul>
                ) : <p className="quiet dash-empty">{t('No one.')}</p>}
              </section>
              <section className="dash-card">
                <div className="dash-card-head"><h2>{t('Overdue')}</h2></div>
                {data.overdue.length ? (
                  <ul className="billing-list">{data.overdue.map(s => <li key={s.id}><b>{s.userId}</b><PlanTag p={s} /></li>)}</ul>
                ) : <p className="quiet dash-empty">{t('No one.')}</p>}
              </section>
            </div>

            <div className="report-grid">
              <section className="dash-card">
                <div className="dash-card-head"><h2>{t('Recent payments')}</h2></div>
                {data.recent.length ? (
                  <table className="dash-table plan-history">
                    <thead><tr><th>{t('Shop')}</th><th>{t('Plan')}</th><th>{t('Amount')}</th><th>{t('Receipt')}</th></tr></thead>
                    <tbody>
                      {data.recent.map(p => (
                        <tr key={p.id}>
                          <th scope="row">{p.shop}</th>
                          <td>{t(PLAN_NAMES[p.plan])}, {p.kind === 'upgrade' ? t('upgrade') : t(p.billing)}</td>
                          <td className="dn">{rs(p.amount)}</td>
                          <td><a href={`/api/admin/payments/${p.id}/receipt`} target="_blank" rel="noreferrer">{p.receiptNo}</a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="quiet dash-empty">{t('No payments yet.')}</p>}
              </section>
              <section className="dash-card">
                <div className="dash-card-head"><h2>{t('Received by month')}</h2></div>
                {data.months.length ? (
                  <ul className="billing-list">{data.months.map(m => <li key={m.month}><b>{monthName(m.month)}</b><span>{rs(m.total)} <small className="quiet">({m.count})</small></span></li>)}</ul>
                ) : <p className="quiet dash-empty">{t('No payments yet.')}</p>}
              </section>
            </div>
          </>
        )}
      </main>
      {rejecting && (
        <Dialog title={t('Payment not received from {user}?', { user: rejecting.shop })} onClose={() => setRejecting(null)}>
          <p>{t('The shop will see it as not received, with your reason, and can send the right reference number.')}</p>
          <div className="field">
            <label htmlFor="reject-reason">{t('Reason (optional)')}</label>
            <input id="reject-reason" value={reason} maxLength={200} placeholder={t('For example "No payment with this UTR"')} onChange={e => setReason(e.target.value)} />
          </div>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setRejecting(null)}>{t('Cancel')}</button>
            <button className="btn stop-solid" disabled={busy === rejecting.id} onClick={() => decide(rejecting, 'reject', { note: reason })}>{t('Mark not received')}</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
