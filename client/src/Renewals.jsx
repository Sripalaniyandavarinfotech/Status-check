import { useEffect, useState } from 'react';
import Header from './Header.jsx';
import { SkeletonRows } from './Skeleton.jsx';
import { lang, t, tamil } from './i18n.js';
import { api, leave, phone, serviceHref, showError } from './lib.js';

// /renewals: income and OBC certificates approved 11 months ago. One message each,
// in Tamil from the shop's own WhatsApp, then they leave the list.

const CERT = { income: 'income certificate', obc: 'OBC certificate' };

const message = r => tamil('Hello {name}, your {certificate} will expire next month. Please visit our shop to renew it. Thank you.', { name: r.name, certificate: tamil(CERT[r.certificate]) });

export default function RenewalsPage({ user, onLogout }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);
  const [leaving, setLeaving] = useState(null);
  useEffect(() => { api('renewals').then(setList).catch(showError); }, []);

  async function mark(r, action) {
    setBusy(r.id);
    try {
      await api(`renewals/${r.id}/${action}`, { method: 'POST' });
      setLeaving(r.id);
      await leave();
      setList(l => l.filter(x => x.id !== r.id));
    } catch (e) {
      showError(e);
    }
    setBusy(null);
  }

  return (
    <>
      <Header user={user} onLogout={onLogout} current="/renewals" counts={list ? { '/renewals': { n: list.length, due: 0 } } : undefined} />
      <main className="wrap task-page">
        <section className="lead">
          <h1>{t('Renewals due')}</h1>
          <p className="quiet">{t('Income and OBC certificates last one year. Customers show here 11 months after approval, so you can remind them to renew.')}</p>
        </section>
        {!list ? <SkeletonRows count={3} /> : !list.length ? <p className="quiet task-empty">{t('No renewals due right now.')}</p> : (
          <ul className="task-list">
            {list.map(r => (
              <li key={r.id} className={`task ${leaving === r.id ? 'leaving' : ''}`}>
                <div className="task-who">
                  <b>{r.name}</b>
                  <span className="quiet">{r.applicationNo} · {phone(r.whatsapp)}</span>
                </div>
                <div className="task-what">
                  <span className="renew-kind">{t(r.certificate === 'income' ? 'Income certificate' : 'OBC certificate')}</span>
                  <span className="quiet">{t('Approved {when}', { when: new Date(r.approvedAt).toLocaleDateString(lang === 'ta' ? 'ta-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) })}</span>
                </div>
                <div className="task-tools">
                  <a className="btn primary" href={`https://wa.me/${r.whatsapp}?text=${encodeURIComponent(message(r))}`} target="_blank" rel="noopener noreferrer" onClick={() => mark(r, 'sent')} aria-disabled={busy === r.id}>{t('Send on WhatsApp')}</a>
                  <button className="btn" disabled={busy === r.id} onClick={() => mark(r, 'skip')}>{t('Skip')}</button>
                  <a className="link-btn" href={serviceHref('certificate', null, r.applicationNo)}>{t('Open')}</a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
