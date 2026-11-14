import { useEffect, useState } from 'react';
import Header from './Header.jsx';
import { SkeletonTiles } from './Skeleton.jsx';
import { t } from './i18n.js';
import { api, dayIso, monthName, rs, showError } from './lib.js';

// /report: one month at a glance. The same report is emailed on the 1st.

// The last 12 months, newest first, as YYYY-MM.
function recentMonths() {
  const [y, m] = dayIso().split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return d.toISOString().slice(0, 7);
  });
}

function Stat({ label, value, note }) {
  return (
    <div className="dash-tile">
      <span className="dash-tile-label">{label}</span>
      <b className="dash-tile-value">{value}</b>
      {note && <span className="dash-tile-note">{note}</span>}
    </div>
  );
}

export default function MonthlyReport({ user, onLogout }) {
  const months = recentMonths();
  const [month, setMonth] = useState(months[1]); // last month, like the email
  const [r, setR] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState('');

  useEffect(() => {
    setR(null);
    setSent('');
    api(`report?month=${month}`).then(setR).catch(showError);
  }, [month]);

  async function email() {
    setSending(true);
    try {
      const done = await api('report/email', { method: 'POST', body: { month } });
      setSent(t('Sent to {email}. The first email to a new address asks you to confirm it once.', { email: done.email }));
    } catch (e) {
      showError(e);
    }
    setSending(false);
  }

  const share = r && `https://wa.me/${r.phone ? `91${r.phone}` : ''}?text=${encodeURIComponent(r.text)}`;
  const bestTop = r ? Math.max(1, ...r.operators.map(o => o.added)) : 1;

  return (
    <>
      <Header user={user} onLogout={onLogout} />
      <main className="wrap report-page">
        <section className="lead report-lead">
          <div>
            <h1>{t('Monthly report')}</h1>
            <p className="quiet">{t('Sent to your email on the 1st of every month.')}</p>
          </div>
          <label className="month-pick">
            <span>{t('Month')}</span>
            <select value={month} onChange={e => setMonth(e.target.value)}>
              {months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
          </label>
        </section>

        {!r ? <SkeletonTiles count={4} /> : (
          <>
            <section className="dash-tiles" aria-label={t('Applications')}>
              <Stat label={t('Applications added')} value={r.applications.added} note={r.ttd.added ? t('+ {n} TTD bookings', { n: r.ttd.added }) : null} />
              <Stat label={t('Approved')} value={r.applications.approved} />
              <Stat label={t('Rejected')} value={r.applications.rejected} />
              <Stat label={t('Marked paid')} value={r.money.paid} note={r.money.total ? t('Amounts entered: {total}', { total: rs(r.money.total) }) : null} />
            </section>

            <div className="report-grid">
              <section className="dash-card">
                <div className="dash-card-head"><h2>{t('By service')}</h2></div>
                {r.services.length ? (
                  <table className="dash-table report-table">
                    <thead><tr><th>{t('Service')}</th><th>{t('Added')}</th><th>{t('Approved')}</th><th>{t('Rejected')}</th></tr></thead>
                    <tbody>
                      {r.services.map(s => (
                        <tr key={s.service}><th scope="row">{t(s.service)}</th><td className="dn">{s.added}</td><td className="dn ok">{s.approved}</td><td className="dn bad">{s.rejected}</td></tr>
                      ))}
                      {(r.ttd.added > 0 || r.ttd.booked > 0) && <tr><th scope="row">TTD</th><td className="dn">{r.ttd.added}</td><td className="dn ok">{t('{n} booked', { n: r.ttd.booked })}</td><td className="dn">–</td></tr>}
                    </tbody>
                  </table>
                ) : <p className="quiet dash-empty">{t('No applications this month.')}</p>}
              </section>

              <section className="dash-card">
                <div className="dash-card-head"><h2>{t('Operators')}</h2>{r.best && <span className="best-op">{t('Best: {name}', { name: r.best.name })}</span>}</div>
                {r.operators.some(o => o.name) ? (
                  <ul className="dash-ops report-ops">
                    {r.operators.filter(o => o.name).map(o => (
                      <li key={o.name}>
                        <span>{o.name}</span>
                        <span className="dash-op-bar"><i style={{ width: `${(o.added / bestTop) * 100}%` }} /></span>
                        <b>{o.added}</b>
                        <small className="quiet">{o.collected ? rs(o.collected) : ''}</small>
                      </li>
                    ))}
                  </ul>
                ) : <p className="quiet dash-empty">{t('No operator work recorded this month.')}</p>}
              </section>
            </div>

            <section className="dash-card report-more">
              <ul>
                <li><b>{r.applications.pendingNow}</b><span>{t('Still pending today')}</span></li>
                <li><b>{r.money.unpaidNow}</b><span>{t('Not paid today')}</span></li>
                <li><b>{r.renewalsSent}</b><span>{t('Renewal reminders sent')}</span></li>
                <li><b>{r.followUpsDone}</b><span>{t('Follow-ups done')}</span></li>
              </ul>
            </section>

            <section className="report-share">
              <a className="btn primary" href={share} target="_blank" rel="noopener noreferrer">{t('Share on WhatsApp')}</a>
              <button className="btn" disabled={sending || !r.email} onClick={email}>{t(sending ? 'Sending…' : 'Email me this report')}</button>
              {!r.email && <span className="quiet">{t('Add an email address to your account to get it by email.')}</span>}
              {sent && <p className="saved" role="status">{sent}</p>}
            </section>
          </>
        )}
      </main>
    </>
  );
}
