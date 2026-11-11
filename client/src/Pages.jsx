import { useEffect, useState } from 'react';
import { Pager } from './Fields.jsx';
import Header from './Header.jsx';
import { SkeletonTable } from './Skeleton.jsx';
import { t } from './i18n.js';
import { api, monthName, showError, when } from './lib.js';

export const ACTIONS = {
  login: 'Logged in',
  'password.own': 'Changed own password',
  'customer.add': 'Added a customer',
  'customer.edit': 'Edited a customer',
  'customer.delete': 'Deleted a customer',
  'customer.status': 'Changed a status',
  'note.add': 'Added a note',
  'note.delete': 'Deleted a note',
  'whatsapp.one': 'Sent a WhatsApp update',
  'whatsapp.undo': 'Marked a WhatsApp update as not sent',
  'customer.informed': 'Marked a customer as informed',
  'operator.add': 'Added an operator',
  'operator.rename': 'Renamed an operator',
  'operator.remove': 'Removed an operator',
  'customer.not-informed': 'Marked a customer as not informed',
  'aadhaar.view': 'Viewed an Aadhaar number',
  'aadhaar.remove': 'Removed an Aadhaar number',
  'whatsapp.send': 'Sent WhatsApp updates',
  'check.run': 'Ran the certificate check',
  'data.reset': 'Reset all customer data',
  'user.add': 'Added a user',
  'user.accept': 'Accepted a user',
  'user.refuse': 'Refused a registration',
  'user.suspend': 'Suspended a user',
  'user.activate': 'Activated a user',
  'user.password': "Changed a user's password",
  'notice.send': 'Sent a notice',
  'ttd.add': 'Added a TTD booking',
  'ttd.edit': 'Edited a TTD booking',
  'ttd.delete': 'Deleted a TTD booking',
  'ttd.booked': 'Marked a TTD booking as booked',
  'ttd.failed': 'Marked a TTD booking as failed',
  'ttd.ready': 'Put a TTD booking back to ready',
  'ttd.ticket': 'Saved a TTD ticket',
  'ttd.sent': 'Sent a TTD ticket on WhatsApp',
  'ttd.sheet': 'Opened TTD booking mode',
  'notice.delete': 'Deleted a notice',
};

function Frame({ user, onLogout, title, children }) {
  return (
    <>
      <Header user={user} onLogout={onLogout} />
      <main className="wrap">
        <section className="lead"><h1>{title}</h1></section>
        {children}
      </main>
    </>
  );
}

export function ActivityPage({ user, onLogout }) {
  const admin = user.role === 'admin';
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api(`${admin ? 'admin/' : ''}activity?page=${page}`).then(setData).catch(showError);
  }, [admin, page]);

  return (
    <Frame user={user} onLogout={onLogout} title={t('Activity')}>
      {!data && <SkeletonTable rows={8} cols={3} />}
      {data && (data.items.length ? (
        <>
          <div className="table-box">
            <table className="users">
              <thead>
                <tr>
                  <th scope="col">{t('When')}</th>
                  {admin && <th scope="col">{t('Who')}</th>}
                  <th scope="col">{t('What')}</th>
                  <th scope="col">{t('Details')}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map(a => (
                  <tr key={a.id}>
                    <td>{when(a.at)}</td>
                    {admin && <td>{t(a.actor)}</td>}
                    <td>{t(ACTIONS[a.action] || a.action)}</td>
                    <td className="wrap-text">{admin ? a.target : a.detail ? t(a.detail) : a.actor !== user.userId ? t(a.actor) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pages={data.pages} onPage={setPage} />
        </>
      ) : <div className="empty"><p>{t('Nothing has happened yet.')}</p></div>)}
    </Frame>
  );
}

export function MonthsTable({ months }) {
  return (
    <section>
      <h2 className="report-title">{t('Last 6 months')}</h2>
      <div className="table-box">
        <table className="users">
          <thead>
            <tr>
              <th scope="col">{t('Month')}</th>
              <th scope="col" className="count">{t('Added')}</th>
              <th scope="col" className="count">{t('Approved')}</th>
              <th scope="col" className="count">{t('Rejected')}</th>
              <th scope="col" className="count">{t('WhatsApp sent')}</th>
            </tr>
          </thead>
          <tbody>
            {months.map(m => (
              <tr key={m.month}>
                <th scope="row">{monthName(m.month)}</th>
                <td className="count">{m.added}</td>
                <td className="count">{m.approved}</td>
                <td className="count">{m.rejected}</td>
                <td className="count">{m.sent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ServicesTable({ services, nameOf }) {
  return (
    <section>
      <h2 className="report-title">{t('By service')}</h2>
      <div className="table-box">
        <table className="users">
          <thead>
            <tr>
              <th scope="col">{t('Service')}</th>
              <th scope="col" className="count">{t('Total')}</th>
              <th scope="col" className="count">{t('In progress')}</th>
              <th scope="col" className="count">{t('Approved')}</th>
              <th scope="col" className="count">{t('Rejected')}</th>
              <th scope="col" className="count">{t('No status yet')}</th>
            </tr>
          </thead>
          <tbody>
            {services.map(s => (
              <tr key={s.type}>
                <th scope="row">{nameOf(s.type)}</th>
                <td className="count">{s.total}</td>
                <td className="count">{s.progress}</td>
                <td className="count">{s.approved}</td>
                <td className="count">{s.rejected}</td>
                <td className="count">{s.new}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// The admin's totals. A user's own numbers are on their Profile page.
const OPERATOR_COLUMNS = [
  ['total', 'Total'],
  ['thisMonth', 'This month'],
  ['progress', 'In progress'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['new', 'No status yet'],
  ['informed', 'Informed'],
  ['sent', 'WhatsApp sent'],
];

export function OperatorStatsPage({ user, onLogout }) {
  const [rows, setRows] = useState(null);

  useEffect(() => { api('reports/operators').then(setRows).catch(showError); }, []);

  const sum = key => rows.reduce((n, r) => n + r[key], 0);

  return (
    <Frame user={user} onLogout={onLogout} title={t('Operator stats')}>
      {!rows && <SkeletonTable rows={4} cols={9} />}
      {rows && (rows.length ? (
        <div className="table-box">
          <table className="users">
            <thead>
              <tr>
                <th scope="col">{t('Operator')}</th>
                {OPERATOR_COLUMNS.map(([key, label]) => <th key={key} scope="col" className="count">{t(label)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.name ?? 'none'}>
                  <th scope="row">{r.name ?? t('No operator')}</th>
                  {OPERATOR_COLUMNS.map(([key]) => <td key={key} className="count">{r[key]}</td>)}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t('Total')}</th>
                {OPERATOR_COLUMNS.map(([key]) => <td key={key} className="count">{sum(key)}</td>)}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="empty"><p>{t('Add your operators in Profile to see their stats here.')}</p></div>
      ))}
    </Frame>
  );
}

export function ReportsPage({ user, onLogout }) {
  const [data, setData] = useState(null);

  useEffect(() => { api('admin/reports').then(setData).catch(showError); }, []);

  return (
    <Frame user={user} onLogout={onLogout} title={t('Reports')}>
      {!data && <SkeletonTable rows={4} cols={6} />}
      {data && (
        <div className="reports">
          <section>
            <h2 className="report-title">{t('By user')}</h2>
            {data.users.length ? (
              <div className="table-box">
                <table className="users">
                  <thead>
                    <tr>
                      <th scope="col">{t('Username')}</th>
                      <th scope="col" className="count">{t('Total')}</th>
                      <th scope="col" className="count">{t('This month')}</th>
                      <th scope="col" className="count">{t('Approved')}</th>
                      <th scope="col" className="count">{t('Rejected')}</th>
                      <th scope="col" className="count">{t('WhatsApp sent')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map(u => (
                      <tr key={u.userId}>
                        <th scope="row">{u.userId}</th>
                        <td className="count">{u.total}</td>
                        <td className="count">{u.thisMonth}</td>
                        <td className="count">{u.approved}</td>
                        <td className="count">{u.rejected}</td>
                        <td className="count">{u.sent}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty"><p>{t('No users yet')}</p></div>}
          </section>
          <MonthsTable months={data.months} />
        </div>
      )}
    </Frame>
  );
}
