import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import Header from './Header.jsx';
import { SkeletonTiles } from './Skeleton.jsx';
import { t } from './i18n.js';
import { api, copyText, rs, showError } from './lib.js';

// /plan: the shop's subscription. What it includes, until when, paying by UPI
// ("I have paid" with the reference number, confirmed by the admin) and receipts.

const PLAN_NAMES = { standard: 'Standard', premium: 'Premium' };
const STATES = { trial: 'Free trial', active: 'Active', grace: 'Ended: grace days', readonly: 'Read-only' };
const INCLUDED = [
  'All services and automatic status checks', 'One-click WhatsApp updates', 'Dashboard, reports and CSV', 'Unlimited operators and operator stats',
  'PAN receipt reading', 'Aadhaar number storage (encrypted)', 'Paid / Not paid and follow-ups', 'Renewal reminders', 'Monthly report',
];

export const longDay = day => (day ? new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');

// The line under the plan name: what happens next.
export function planLine(p) {
  if (!p) return '';
  if (p.status === 'trial') return t('Free trial of Premium until {day} ({n} days left)', { day: longDay(p.endsOn), n: p.daysLeft });
  if (p.status === 'active') return t('Paid until {day} ({n} days left)', { day: longDay(p.endsOn), n: p.daysLeft });
  if (p.status === 'grace') return t('Ended on {day}. Everything works until {grace}, then the site becomes read-only.', { day: longDay(p.endsOn), grace: longDay(p.graceEnds) });
  return t('Your plan has ended. You can still see and search everything. Renew to make changes again.');
}

function PayDialog({ data, choice, onClose, onSent }) {
  const q = choice.kind === 'upgrade' ? data.quotes.upgrade : data.quotes[choice.plan][choice.billing];
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const note = `eThunaivan ${PLAN_NAMES[q.plan]} ${q.kind === 'upgrade' ? 'upgrade' : q.billing}`;
  const upiLink = data.upi.id ? `upi://pay?pa=${encodeURIComponent(data.upi.id)}&pn=${encodeURIComponent(data.upi.name)}&am=${q.amount}&cu=INR&tn=${encodeURIComponent(note)}` : null;

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('plan/pay', { method: 'POST', body: { kind: choice.kind, plan: q.plan, billing: q.billing, utr } });
      onSent();
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  }

  return (
    <Dialog title={q.kind === 'upgrade' ? t('Upgrade to Premium') : t('Pay for {plan}, {billing}', { plan: t(PLAN_NAMES[q.plan]), billing: t(q.billing === 'yearly' ? 'yearly' : 'monthly') })} onClose={onClose}>
      <div className="pay-amount">
        <b>{rs(q.amount)}</b>
        <span className="quiet">{t('{from} to {to}', { from: longDay(q.from), to: longDay(q.to) })}</span>
      </div>
      {!data.upi.id && !data.upi.hasQr ? (
        <p className="warn">{t('UPI payment details are not set up yet. Please contact Palaniyandavar Info Tech to pay.')}</p>
      ) : (
        <ol className="pay-steps">
          <li>
            <p>{t('Pay {amount} by UPI to {name}.', { amount: rs(q.amount), name: data.upi.name })}</p>
            {data.upi.hasQr && <img className="pay-qr" src="/api/plan/qr" alt={t('UPI QR code of {name}', { name: data.upi.name })} />}
            {data.upi.id && (
              <p className="pay-upi">
                <code>{data.upi.id}</code>
                <button type="button" className="btn" onClick={async () => { if (await copyText(data.upi.id)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>{t(copied ? 'Copied' : 'Copy')}</button>
                <a className="btn" href={upiLink}>{t('Open UPI app')}</a>
              </p>
            )}
          </li>
          <li>
            <form onSubmit={send}>
              <label htmlFor="utr">{t('Then type the UPI reference number (UTR) shown in your UPI app after paying')}</label>
              <div className="pay-utr">
                <input id="utr" value={utr} maxLength={30} inputMode="text" autoComplete="off" placeholder={t('For example 431298765432')} onChange={e => setUtr(e.target.value)} />
                <button className="btn primary" disabled={busy || utr.trim().length < 6}>{t('I have paid')}</button>
              </div>
            </form>
          </li>
        </ol>
      )}
      <p className="quiet">{t('Palaniyandavar Info Tech checks the payment and confirms it, usually the same day. Your plan moves on at once and you get a receipt.')}</p>
    </Dialog>
  );
}

export default function PlanPage({ user, onLogout }) {
  const [data, setData] = useState(null);
  const [billing, setBilling] = useState('monthly');
  const [paying, setPaying] = useState(null); // { kind, plan, billing }
  const [note, setNote] = useState('');
  const load = () => api('plan').then(d => { setData(d); setBilling(b => (d.status === 'active' ? d.billing : b)); }).catch(showError);
  useEffect(() => { load(); }, []);

  const pending = data?.payments.find(p => p.status === 'pending');
  async function cancel(p) {
    try {
      await api(`plan/cancel/${p.id}`, { method: 'POST' });
      setNote('');
      load();
    } catch (e) {
      showError(e);
    }
  }

  const canUpgrade = data && !data.quotes.upgrade.error;

  return (
    <>
      <Header user={user} onLogout={onLogout} noNav />
      <main className="wrap plan-page">
        <a className="back-link" href="/home">{t('Back to home')}</a>
        {!data ? <SkeletonTiles count={2} /> : (
          <>
            <section className={`plan-now ${data.status}`}>
              <div>
                <span className={`plan-state ${data.status}`}>{t(STATES[data.status])}</span>
                <h1>{data.plan ? t('{plan} plan', { plan: t(PLAN_NAMES[data.plan]) }) : t('No active plan')}</h1>
                <p>{planLine(data)}</p>
                {data.nextPlan && <p className="quiet">{t('{plan} starts on {day}.', { plan: t(PLAN_NAMES[data.nextPlan.plan]), day: longDay(data.nextPlan.from) })}</p>}
              </div>
              {canUpgrade && <button className="btn primary" onClick={() => setPaying({ kind: 'upgrade' })}>{t('Upgrade to Premium for {amount}', { amount: rs(data.quotes.upgrade.amount) })}</button>}
            </section>

            {pending && (
              <section className="plan-pending" role="status">
                <p><b>{t('Payment waiting to be confirmed')}</b> · {rs(pending.amount)} · {t('UTR')} {pending.utr}</p>
                <button className="link-btn" onClick={() => cancel(pending)}>{t('Cancel')}</button>
              </section>
            )}
            {note && <p className="saved" role="status">{note}</p>}

            <section className="plan-choose" aria-labelledby="choose-title">
              <div className="plan-choose-head">
                <h2 id="choose-title">{data.status === 'trial' || data.status === 'readonly' || !data.plan ? t('Choose a plan') : t('Renew')}</h2>
                <div className="seg-pick" role="radiogroup" aria-label={t('Monthly or yearly')}>
                  {[['monthly', 'Monthly'], ['yearly', 'Yearly (2 months free)']].map(([v, label]) => (
                    <button type="button" key={v} role="radio" aria-checked={billing === v} className={billing === v ? 'on' : ''} onClick={() => setBilling(v)}>{t(label)}</button>
                  ))}
                </div>
              </div>
              <div className="plan-cards">
                {['standard', 'premium'].map(plan => {
                  const q = data.quotes[plan][billing];
                  const mine = data.plan === plan && data.status !== 'trial';
                  return (
                    <article key={plan} className={`plan-card ${plan} ${mine ? 'mine' : ''}`}>
                      <h3>{t(PLAN_NAMES[plan])}{mine && <span className="plan-mine">{t('Your plan')}</span>}</h3>
                      <p className="plan-price"><b>{rs(data.prices[plan][billing])}</b> <span>{t(billing === 'yearly' ? 'a year' : 'a month')}</span></p>
                      <ul>
                        {INCLUDED.map(f => <li key={f}>{t(f)}</li>)}
                        {Object.values(data.premium).map(f => <li key={f} className={plan === 'premium' ? 'extra' : 'no'}>{t(f)}</li>)}
                      </ul>
                      <button className={`btn ${plan === 'premium' ? 'primary' : ''} wide`} disabled={!!pending} onClick={() => setPaying({ kind: 'renew', plan, billing })}>
                        {t(mine ? 'Renew {plan}' : 'Choose {plan}', { plan: t(PLAN_NAMES[plan]) })}
                      </button>
                      <p className="quiet plan-period">{t('{from} to {to}', { from: longDay(q.from), to: longDay(q.to) })}</p>
                    </article>
                  );
                })}
              </div>
              {pending && <p className="quiet">{t('Wait for the payment above to be confirmed, or cancel it, before paying again.')}</p>}
            </section>

            <section className="dash-card" aria-labelledby="history-title">
              <div className="dash-card-head"><h2 id="history-title">{t('Payments')}</h2></div>
              {data.payments.length ? (
                <table className="dash-table plan-history">
                  <thead><tr><th>{t('Date')}</th><th>{t('Plan')}</th><th>{t('Amount')}</th><th>{t('Status')}</th><th><span className="hide">{t('Receipt')}</span></th></tr></thead>
                  <tbody>
                    {data.payments.map(p => (
                      <tr key={p.id}>
                        <td>{new Date(p.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td>{t(PLAN_NAMES[p.plan])}{p.kind === 'upgrade' ? ` (${t('upgrade')})` : `, ${t(p.billing)}`}</td>
                        <td className="dn">{rs(p.amount)}</td>
                        <td><span className={`tag ${p.status === 'confirmed' ? 'ok' : p.status === 'rejected' ? 'bad' : p.status === 'cancelled' ? 'none' : ''}`}>{t({ pending: 'Waiting', confirmed: 'Confirmed', rejected: 'Not received', cancelled: 'Cancelled' }[p.status])}</span>{p.status === 'rejected' && p.note && <small className="quiet"> {p.note}</small>}</td>
                        <td>{p.receiptNo && <a href={`/api/plan/receipt/${p.id}`} target="_blank" rel="noreferrer">{t('Receipt {no}', { no: p.receiptNo })}</a>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="quiet dash-empty">{t('No payments yet.')}</p>}
            </section>
          </>
        )}
      </main>
      {paying && data && (
        <PayDialog
          data={data}
          choice={paying}
          onClose={() => setPaying(null)}
          onSent={() => { setPaying(null); setNote(t('Thank you. Your payment is waiting to be confirmed.')); load(); }}
        />
      )}
    </>
  );
}

// The strip under the header: trial or plan ending soon, grace, read-only.
export function PlanBanner({ plan }) {
  if (!plan || window.location.pathname === '/plan') return null;
  const soon = ['trial', 'active'].includes(plan.status) && plan.daysLeft <= 7;
  if (!soon && !['grace', 'readonly'].includes(plan.status)) return null;
  const text = plan.status === 'readonly' ? t('Your plan has ended. The site is read-only until you renew. Nothing has been deleted.')
    : plan.status === 'grace' ? t('Your plan ended on {day}. It stops working on {grace}.', { day: longDay(plan.endsOn), grace: longDay(plan.graceEnds) })
      : plan.status === 'trial' ? t('Your free trial ends in {n} days.', { n: plan.daysLeft })
        : t('Your plan ends in {n} days.', { n: plan.daysLeft });
  return (
    <div className={`plan-banner ${plan.status === 'readonly' || plan.status === 'grace' ? 'bad' : ''}`} role="status">
      <div className="wrap">
        <span>{text}</span>
        <a className="btn" href="/plan">{t(plan.status === 'trial' ? 'Choose a plan' : 'Renew')}</a>
      </div>
    </div>
  );
}
