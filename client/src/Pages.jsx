import { useEffect, useState } from 'react';
import { Pager } from './Fields.jsx';
import Header from './Header.jsx';
import { t } from './i18n.js';
import { api, monthName, showError, when } from './lib.js';

const ACTIONS = {
  login: 'Logged in',
  'password.own': 'Changed own password',
  'customer.add': 'Added a customer',
  'customer.edit': 'Edited a customer',
  'customer.delete': 'Deleted a customer',
  'customer.status': 'Changed a status',
  'note.add': 'Added a note',
  'note.delete': 'Deleted a note',
  'whatsapp.one': 'Sent a WhatsApp update',
  'whatsapp.send': 'Sent WhatsApp updates',
  'check.run': 'Ran the certificate check',
  'user.add': 'Added a user',
  'user.accept': 'Accepted a user',
  'user.refuse': 'Refused a registration',
  'user.suspend': 'Suspended a user',
  'user.activate': 'Activated a user',
  'user.password': "Changed a user's password",
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

function Months({ months }) {
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

export function ReportsPage({ user, onLogout }) {
  const admin = user.role === 'admin';
  const [data, setData] = useState(null);
  const [providers, setProviders] = useState([]);

  useEffect(() => {
    api(admin ? 'admin/reports' : 'reports').then(setData).catch(showError);
    if (!admin) api('providers').then(setProviders).catch(() => {});
  }, [admin]);

  const nameOf = type => t(providers.find(p => p.id === type)?.shortName || type);

  return (
    <Frame user={user} onLogout={onLogout} title={t('Reports')}>
      {data && (
        <div className="reports">
          {!admin && (
            <section>
              <h2 className="report-title">{t('By service')}</h2>
              {data.services.length ? (
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
                      {data.services.map(s => (
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
              ) : <div className="empty"><p>{t('Add customers to see reports here.')}</p></div>}
            </section>
          )}
          {admin && (
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
          )}
          <Months months={data.months} />
        </div>
      )}
    </Frame>
  );
}
