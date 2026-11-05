import { useCallback, useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { Field, PasswordField } from './Fields.jsx';
import Header from './Header.jsx';
import { plural, t } from './i18n.js';
import { api, showError } from './lib.js';

const VIEWS = [
  { id: 'all', label: 'All users', test: () => true },
  { id: 'pending', label: 'Waiting to accept', test: u => u.status === 'pending' },
  { id: 'active', label: 'Active', test: u => u.status === 'active' },
  { id: 'suspended', label: 'Suspended', test: u => u.status === 'suspended' },
];

const STATUS = {
  pending: { label: 'Waiting to accept', tone: '' },
  active: { label: 'Active', tone: 'ok' },
  suspended: { label: 'Suspended', tone: 'bad' },
};

function headline(list) {
  const waiting = list.filter(u => u.status === 'pending').length;
  if (!list.length) return t('No users yet');
  if (waiting) return t('{users} waiting to be accepted', { users: plural(waiting, 'user') });
  return t('{users} registered', { users: plural(list.length, 'user') });
}

function AddUser({ onSave, onClose }) {
  const [form, setForm] = useState({ userId: '', password: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const change = key => e => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(form);
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  }

  return (
    <Dialog title={t('Add user')} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Field id="userId" label={t('User ID')} value={form.userId} onChange={change('userId')} autoComplete="off" autoCapitalize="none" />
        <PasswordField id="password" label={t('Password')} value={form.password} onChange={change('password')} autoComplete="new-password" />
        <Field id="phone" label={t('Phone number (optional)')} type="tel" inputMode="numeric" value={form.phone} onChange={change('phone')} autoComplete="off" />
        <Field id="email" label={t('Email (optional, needed for forgotten passwords)')} type="email" value={form.email} onChange={change('email')} autoComplete="off" />
        <button className="btn primary wide" disabled={busy}>{busy ? t('Saving…') : t('Save user')}</button>
      </form>
    </Dialog>
  );
}

function ChangePassword({ target, onSave, onClose }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(password);
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  }

  return (
    <Dialog title={t('Change password for {user}', { user: target.userId })} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <PasswordField id="password" label={t('New password')} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
        <p className="quiet">{t('They will be logged out and must use this password from now on.')}</p>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" disabled={busy}>{busy ? t('Saving…') : t('Change password')}</button>
        </div>
      </form>
    </Dialog>
  );
}

export default function Admin({ user, onLogout }) {
  const [list, setList] = useState(null);
  const [view, setView] = useState('all');
  const [dialog, setDialog] = useState(null); // { kind: 'add' | 'suspend' | 'refuse' | 'password', target? }
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(() => api('admin/users').then(l => { setList(l); setError(''); }).catch(e => setError(e.message)), []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(u, action, done) {
    setDialog(null);
    setBusy(u.id);
    setError('');
    setNote('');
    try {
      await api(`admin/users/${u.id}/${action}`, { method: 'POST' });
      await load();
      setNote(done);
    } catch (e) {
      showError(e);
    }
    setBusy(null);
  }

  async function addUser(form) {
    await api('admin/users', { method: 'POST', body: form });
    await load();
    setDialog(null);
    setError('');
    setNote(t('{user} can log in now', { user: form.userId.trim().toLowerCase() }));
  }

  async function changePassword(u, password) {
    await api(`admin/users/${u.id}/password`, { method: 'POST', body: { password } });
    setDialog(null);
    setError('');
    setNote(t('Password changed for {user}', { user: u.userId }));
  }

  const all = list || [];
  const shown = all.filter(VIEWS.find(v => v.id === view).test);
  const target = dialog?.target;

  return (
    <>
      <Header user={user} onLogout={onLogout} />
      <main className="wrap">
        <section className="lead">
          <h1>{list ? headline(all) : t('Loading users…')}</h1>
          <button className="btn primary" onClick={() => setDialog({ kind: 'add' })}>{t('Add user')}</button>
        </section>

        {error && <p className="offline" role="alert">{error}</p>}
        {note && <p className="saved" role="status">{note}</p>}

        <nav className="views" aria-label="Filter users">
          {VIEWS.map(v => (
            <button key={v.id} className={view === v.id ? 'on' : ''} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
              <b>{all.filter(v.test).length}</b>
              {t(v.label)}
            </button>
          ))}
        </nav>

        {list && (shown.length ? (
          <div className="table-box">
            <table className="users">
              <thead>
                <tr>
                  <th scope="col">{t('Username')}</th>
                  <th scope="col">{t('Phone number')}</th>
                  <th scope="col" className="count">{t('WhatsApp numbers')}</th>
                  <th scope="col">{t('Status')}</th>
                  <th scope="col"><span className="hide">{t('Actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(u => (
                  <tr key={u.id}>
                    <th scope="row">{u.userId}</th>
                    <td>{u.phone || t('Not given')}</td>
                    <td className="count">{u.whatsappNumbers}</td>
                    <td><span className={`tag ${STATUS[u.status].tone}`}>{t(STATUS[u.status].label)}</span></td>
                    <td>
                      <div className="act">
                        {u.status === 'pending' && <button className="btn good" disabled={busy === u.id} onClick={() => act(u, 'accept', t('{user} accepted', { user: u.userId }))}>{t('Accept')}</button>}
                        {u.status === 'pending' && <button className="btn stop" disabled={busy === u.id} onClick={() => setDialog({ kind: 'refuse', target: u })}>{t('Refuse')}</button>}
                        {u.status !== 'pending' && <button className="btn" disabled={busy === u.id} onClick={() => setDialog({ kind: 'password', target: u })}>{t('Change password')}</button>}
                        {u.status === 'active' && <button className="btn stop" disabled={busy === u.id} onClick={() => setDialog({ kind: 'suspend', target: u })}>{t('Suspend')}</button>}
                        {u.status === 'suspended' && <button className="btn good" disabled={busy === u.id} onClick={() => act(u, 'activate', t('{user} activated', { user: u.userId }))}>{t('Activate')}</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty"><p>{all.length ? t('No users in this list.') : t('People who register will appear here for you to accept.')}</p></div>
        ))}
      </main>

      {dialog?.kind === 'add' && <AddUser onSave={addUser} onClose={() => setDialog(null)} />}

      {dialog?.kind === 'password' && <ChangePassword target={target} onSave={p => changePassword(target, p)} onClose={() => setDialog(null)} />}

      {dialog?.kind === 'suspend' && (
        <Dialog title={t('Suspend {user}?', { user: target.userId })} onClose={() => setDialog(null)}>
          <p>{t('They will be logged out and their automatic checks will stop. None of their data is deleted, and everything comes back when you activate them.')}</p>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setDialog(null)}>{t('Cancel')}</button>
            <button className="btn stop-solid" onClick={() => act(target, 'suspend', t('{user} suspended', { user: target.userId }))}>{t('Suspend user')}</button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'refuse' && (
        <Dialog title={t('Refuse {user}?', { user: target.userId })} onClose={() => setDialog(null)}>
          <p>{t("Their registration will be removed and they won't be able to log in. They can register again.")}</p>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setDialog(null)}>{t('Cancel')}</button>
            <button className="btn stop-solid" onClick={() => act(target, 'refuse', t('{user} refused', { user: target.userId }))}>{t('Refuse registration')}</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
