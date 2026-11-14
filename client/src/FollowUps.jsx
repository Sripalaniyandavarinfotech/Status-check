import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import Header from './Header.jsx';
import { SkeletonRows } from './Skeleton.jsx';
import { t } from './i18n.js';
import { api, dayIso, dayText, daysFrom, leave, phone, serviceHref, showError } from './lib.js';

// Follow-up reminders: one open reminder per customer or TTD booking. They show on
// Home and in /followups on their day, and stay until marked done.

// The next Friday (a week on if today is Friday).
const nextFriday = () => { const day = new Date(`${dayIso()}T00:00:00Z`).getUTCDay(); return dayIso(((5 - day + 7) % 7) || 7); };

const QUICK = [['Tomorrow', () => dayIso(1)], ['In 3 days', () => dayIso(3)], ['In 7 days', () => dayIso(7)], ['Friday', nextFriday]];

// "Remind me" on a customer or booking. `target` is { customerId } or { ttdId }.
export function RemindDialog({ name, target, current, onClose, onSaved }) {
  const [dueOn, setDueOn] = useState(current?.dueOn || dayIso(1));
  const [note, setNote] = useState(current?.note || '');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved(await api('followups', { method: 'POST', body: { ...target, dueOn, note } }));
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await api(`followups/${current.id}`, { method: 'DELETE' });
      onSaved(null);
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  }

  return (
    <Dialog title={t('Remind me about {name}', { name })} onClose={onClose}>
      <form onSubmit={save} className="remind-form">
        <fieldset className="field">
          <legend>{t('When')}</legend>
          <div className="quick-days">
            {QUICK.map(([label, day]) => {
              const value = day();
              return <button type="button" key={label} className={`btn ${dueOn === value ? 'on' : ''}`} aria-pressed={dueOn === value} onClick={() => setDueOn(value)}>{t(label)}</button>;
            })}
          </div>
          <label className="remind-date">
            <span>{t('Or pick a date')}</span>
            <input type="date" value={dueOn} min={dayIso()} onChange={e => setDueOn(e.target.value)} required />
          </label>
          <p className="quiet">{t('Reminder on {day}', { day: dayText(dueOn) })}</p>
        </fieldset>
        <div className="field">
          <label htmlFor="remind-note">{t('Note (optional)')}</label>
          <input id="remind-note" value={note} maxLength={300} placeholder={t('For example "Call back about the missing ration card"')} onChange={e => setNote(e.target.value)} />
        </div>
        <div className="dialog-foot">
          {current && <button type="button" className="btn stop" disabled={busy} onClick={clear}>{t('Remove reminder')}</button>}
          <button className="btn primary" disabled={busy || !dueOn}>{t('Save reminder')}</button>
        </div>
      </form>
    </Dialog>
  );
}

// The small "Follow-up: Fri, 15 Nov" tag on a customer or booking.
export function FollowUpTag({ followUp }) {
  if (!followUp) return null;
  const n = daysFrom(followUp.dueOn);
  return <span key={followUp.dueOn} className={`fu-tag ${n < 0 ? 'late' : n === 0 ? 'today' : ''}`}>{t('Follow-up: {day}', { day: dayText(followUp.dueOn) })}</span>;
}

const KIND_NAMES = { certificate: 'TNeDistrict', smartcard: 'TNPDS', voter: 'Voter', aadhaar: 'Aadhaar', pan: 'PAN', sed300: 'TTD ₹300 Darshan', angapradakshinam: 'TTD Angapradakshinam', edip: 'TTD E-DIP', senior: 'TTD Senior citizen', 'aadhaar-name': 'Aadhaar name change' };
const openHref = f => (f.kind === 'ttd' ? '/ttd' : f.kind === 'case' ? '/aadhaar/name' : serviceHref(f.type, f.agency, f.applicationNo));

// One reminder with Done, Tomorrow and Open. Used on Home and on /followups.
export function FollowUpItem({ f, onDone }) {
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const late = daysFrom(f.dueOn) < 0;
  async function act(path, body) {
    setBusy(true);
    try {
      await api(`followups/${f.id}/${path}`, { method: 'POST', body });
      setGone(true);
      await leave();
      onDone(f.id);
    } catch (e) {
      showError(e);
      setBusy(false);
    }
  }
  return (
    <li className={`task fu ${late ? 'late' : ''} ${gone ? 'leaving' : ''}`}>
      <div className="task-who">
        <b>{f.name}</b>
        <span className="quiet">{t(KIND_NAMES[f.type] || f.type)}{f.agency ? ` ${f.agency}` : ''}{f.applicationNo ? ` · ${f.applicationNo}` : ''}{f.whatsapp ? ` · ${phone(f.whatsapp)}` : ''}</span>
        {f.note && <span className="fu-note">{f.note}</span>}
      </div>
      <div className="task-what">
        <span className={`fu-tag ${late ? 'late' : daysFrom(f.dueOn) === 0 ? 'today' : ''}`}>{late ? t('Overdue: {day}', { day: dayText(f.dueOn) }) : dayText(f.dueOn)}</span>
      </div>
      <div className="task-tools">
        <button className="btn good" disabled={busy} onClick={() => act('done')}>{t('Done')}</button>
        <button className="btn" disabled={busy} onClick={() => act('move', { dueOn: dayIso(1) })}>{t('Move to tomorrow')}</button>
        <a className="link-btn" href={openHref(f)}>{t('Open')}</a>
      </div>
    </li>
  );
}

// /followups: overdue and today's first, then the coming days.
export function FollowUpsPage({ user, onLogout }) {
  const [data, setData] = useState(null);
  const load = () => api('followups').then(setData).catch(showError);
  useEffect(() => { load(); }, []);

  return (
    <>
      <Header user={user} onLogout={onLogout} current="/followups" counts={data ? { '/followups': { n: data.due.length, due: 0 } } : undefined} />
      <main className="wrap task-page">
        <section className="lead">
          <h1>{t('Follow-ups')}</h1>
          <p className="quiet">{t('Add one from any customer with "Remind me".')}</p>
        </section>
        {!data ? <SkeletonRows count={4} /> : (
          <>
            <h2 className="task-head">{t('Today and overdue')}</h2>
            {data.due.length
              ? <ul className="task-list">{data.due.map(f => <FollowUpItem key={f.id} f={f} onDone={load} />)}</ul>
              : <p className="quiet task-empty">{t('Nothing to follow up today.')}</p>}
            {data.upcoming.length > 0 && (
              <>
                <h2 className="task-head">{t('Coming up')}</h2>
                <ul className="task-list">{data.upcoming.map(f => <FollowUpItem key={f.id} f={f} onDone={load} />)}</ul>
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
