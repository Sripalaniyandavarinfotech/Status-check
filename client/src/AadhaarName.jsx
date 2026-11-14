import { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { SearchBox } from './Fields.jsx';
import { FollowUpTag, RemindDialog } from './FollowUps.jsx';
import Header from './Header.jsx';
import TamilInput from './TamilInput.jsx';
import { MoneyDialog, MoneyTag, PaymentPick } from './Money.jsx';
import { SkeletonRows } from './Skeleton.jsx';
import { t, tamil } from './i18n.js';
import { api, copyText, dayIso, phone, serviceHref, showError, when } from './lib.js';

// /aadhaar/name: Aadhaar name change cases. Community and Income certificates,
// then OBC, then the Aadhaar centre (SID). Each case moves on by itself as its
// certificates are checked, and shows the one next step to do.

const STAGE_NAMES = {
  new: 'Add certificate numbers', certs: 'Waiting for certificates', obc: 'Apply OBC', 'obc-applied': 'Waiting for OBC',
  ready: 'Ready for Aadhaar centre', centre: 'At Aadhaar centre', done: 'Done', attention: 'Needs attention',
};
const VIEWS = [
  ['open', 'In progress', c => c.stage !== 'done'],
  ['new', 'Add numbers', c => c.stage === 'new'],
  ['waiting', 'Waiting', c => c.stage === 'certs' || c.stage === 'obc-applied'],
  ['obc', 'Apply OBC', c => c.stage === 'obc'],
  ['ready', 'Ready', c => c.stage === 'ready'],
  ['centre', 'At Aadhaar centre', c => c.stage === 'centre'],
  ['attention', 'Needs attention', c => c.stage === 'attention'],
  ['done', 'Done', c => c.stage === 'done'],
];
const ROLES = [['community', 'Community'], ['income', 'Income'], ['obc', 'OBC']];
const KIND_TEXT = { ok: 'Approved', bad: 'Rejected', none: 'Not checked yet', '': 'In progress' };

// The date and time at the end of a SID: S1483822988390 20261105152827.
export function sidDate(sid) {
  const m = String(sid || '').replace(/\s/g, '').match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31 || +m[4] > 23 || +m[5] > 59 || +m[6] > 59) return '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

const readyText = c => tamil('Hello {name}, the certificates for your Aadhaar name change are ready. Please come to the Aadhaar centre with your original documents. Thank you.', { name: c.newNameTa || c.name });
const doneText = c => tamil('Hello {name}, your name in Aadhaar has been changed to {newName}. Thank you.', { name: c.newNameTa || c.name, newName: c.newNameTa });
const waLink = (c, text) => `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(text)}`;
const prettyWhen = s => (s ? new Date(`${s}+05:30`).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' }) : '');

function Copy({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="link-btn copy-link" aria-label={label} onClick={async () => { if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 1400); } }}>
      {t(done ? 'Copied' : 'Copy')}
    </button>
  );
}

// New case, or editing one. `from` is an existing customer to start from.
function CaseForm({ found, from, operators, onClose, onSaved }) {
  const [form, setForm] = useState(found ? {
    name: found.name, nameTa: found.nameTa || '', whatsapp: found.whatsapp.slice(2), aadhaar: '', newNameEn: found.newNameEn, newNameTa: found.newNameTa,
    requestedOn: found.requestedOn, obcNeeded: found.obcNeeded, operatorId: found.operatorId, note: found.note,
  } : {
    name: from?.name || '', nameTa: '', whatsapp: from?.whatsapp ? from.whatsapp.slice(2) : '', aadhaar: '', newNameEn: '', newNameTa: '',
    requestedOn: dayIso(), obcNeeded: true, operatorId: from?.operatorId || '', note: '', payment: 'unpaid',
    fee: '', paidNow: '', payMode: 'cash',
  });
  const [amounts, setAmounts] = useState(false); // the optional amount box is open
  // The fee starts at the shop's price for a name change, if one is set in Profile.
  useEffect(() => {
    if (found) return;
    api('money/prices').then(p => { if (p['aadhaar-name'] != null) setForm(f => (f.fee ? f : { ...f, fee: String(p['aadhaar-name']) })); }).catch(() => {});
  }, [found]);
  const digits = k => e => setForm({ ...form, [k]: e.target.value.replace(/\D/g, '').slice(0, 6) });
  const [busy, setBusy] = useState(false);
  const set = k => e => setForm({ ...form, [k]: e.target.value });
  const keepsAadhaar = found?.hasAadhaar || from?.hasAadhaar;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { fee, paidNow, payMode, ...rest } = form;
      const body = { ...rest, fromCustomer: from?.id, ...(amounts && !found ? { fee, paidNow, payMode } : {}) };
      onSaved(found ? await api(`cases/${found.id}/edit`, { method: 'POST', body }) : await api('cases', { method: 'POST', body }));
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  }

  return (
    <Dialog title={found ? t('Edit name change') : t('Start Aadhaar name change')} wide onClose={onClose}>
      <form className="case-form" onSubmit={save}>
        <div className="case-grid">
          <p className="case-pair-head">{t('Name on Aadhaar now')}</p>
          <div className="field"><label htmlFor="cf-name">{t('Old name in English')}</label><input id="cf-name" value={form.name} maxLength={200} onChange={set('name')} /></div>
          <div className="field"><label htmlFor="cf-oldta">{t('Old name in Tamil (optional)')}</label><TamilInput id="cf-oldta" value={form.nameTa} englishName={form.name} onChange={v => setForm(f => ({ ...f, nameTa: v }))} /></div>
          <p className="case-pair-head new">{t('New name')}</p>
          <div className="field"><label htmlFor="cf-en">{t('New name in English')}</label><input id="cf-en" value={form.newNameEn} maxLength={200} autoComplete="off" onChange={set('newNameEn')} /></div>
          <div className="field"><label htmlFor="cf-ta">{t('New name in Tamil')}</label><TamilInput id="cf-ta" value={form.newNameTa} englishName={form.newNameEn} onChange={v => setForm(f => ({ ...f, newNameTa: v }))} /></div>
          <div className="field"><label htmlFor="cf-phone">{t('Mobile number')}</label><input id="cf-phone" type="tel" inputMode="numeric" value={form.whatsapp} placeholder={t('10-digit mobile number')} onChange={set('whatsapp')} /></div>
          <div className="field">
            <label htmlFor="cf-aadhaar">{t('Aadhaar number')}</label>
            <input id="cf-aadhaar" inputMode="numeric" value={form.aadhaar} autoComplete="off" onChange={set('aadhaar')}
              placeholder={keepsAadhaar ? t('Saved. Type to replace it.') : t('12-digit number')} />
          </div>
          <div className="field"><label htmlFor="cf-date">{t('Date of request')}</label><input id="cf-date" type="date" value={form.requestedOn} max={dayIso()} onChange={set('requestedOn')} /></div>
        </div>
        <label className="case-check">
          <input type="checkbox" checked={form.obcNeeded} onChange={e => setForm({ ...form, obcNeeded: e.target.checked })} />
          <span>{t('OBC certificate needed')}<small className="quiet"> · {t('Untick for SC or ST customers: Community and Income are enough.')}</small></span>
        </label>
        {operators.length > 0 && (
          <fieldset className="field pick">
            <legend>{t('Operator')}</legend>
            <div>
              {[{ id: '', name: t('No operator') }, ...operators].map(o => (
                <label key={o.id || 'none'}><input type="radio" name="cf-op" checked={form.operatorId === o.id} onChange={() => setForm({ ...form, operatorId: o.id })} /><span>{o.name}</span></label>
              ))}
            </div>
          </fieldset>
        )}
        {!found && (
          <fieldset className="field pay-field">
            <legend className="pay-legend">{t('Fee')}</legend>
            <PaymentPick value={form.payment} onChange={v => setForm({ ...form, payment: v })} />
          </fieldset>
        )}
        {!found && (
          <details className="money-more add-amounts" open={amounts} onToggle={e => setAmounts(e.currentTarget.open)}>
            <summary>{t('Amount details (optional)')}</summary>
            <div className="fee-row">
              <div className="field"><label htmlFor="cf-fee">{t('Fee (₹)')}</label><input id="cf-fee" inputMode="numeric" value={form.fee} placeholder={t('No fee')} onChange={digits('fee')} /></div>
              <div className="field"><label htmlFor="cf-paid">{t('Paid now (₹)')}</label><input id="cf-paid" inputMode="numeric" value={form.paidNow} placeholder="0" onChange={digits('paidNow')} /></div>
              <fieldset className="field">
                <legend>{t('Paid by')}</legend>
                <div className="seg-pick">
                  {[['cash', 'Cash'], ['upi', 'UPI']].map(([v, label]) => (
                    <button type="button" key={v} aria-pressed={form.payMode === v} className={form.payMode === v ? 'on' : ''} onClick={() => setForm({ ...form, payMode: v })}>{t(label)}</button>
                  ))}
                </div>
              </fieldset>
              {form.fee && <button type="button" className="link-btn fee-full" onClick={() => setForm({ ...form, paidNow: form.fee, payment: 'paid' })}>{t('Paid in full')}</button>}
            </div>
          </details>
        )}
        <div className="field"><label htmlFor="cf-note">{t('Note (optional)')}</label><input id="cf-note" value={form.note} maxLength={500} onChange={set('note')} /></div>
        <button className="btn primary wide" disabled={busy}>{t(found ? 'Save changes' : 'Start name change')}</button>
      </form>
    </Dialog>
  );
}

// The certificate and Aadhaar chips on a case.
function Steps({ c }) {
  const chip = (role, label) => {
    const a = c.apps[role];
    if (role === 'obc' && !c.obcNeeded) return <li key={role} className="case-chip skip"><b>{t(label)}</b><span>{t('Not needed')}</span></li>;
    return (
      <li key={role} className={`case-chip ${a ? `k-${a.kind || 'progress'}` : 'unset'}`}>
        <b>{t(label)}</b>
        {a ? (
          <>
            <a href={serviceHref(a.type, null, a.applicationNo)}>{a.applicationNo}</a>
            <span>{a.lastChecked ? t(a.status || KIND_TEXT[a.kind]) : t(KIND_TEXT.none)}</span>
          </>
        ) : <span>{t('Not applied yet')}</span>}
      </li>
    );
  };
  return (
    <ol className="case-steps">
      {ROLES.map(([r, label]) => chip(r, label))}
      <li className={`case-chip ${c.apps.aadhaar ? `k-${c.apps.aadhaar.kind || 'progress'}` : 'unset'}`}>
        <b>{t('Aadhaar update')}</b>
        {c.sid ? (
          <>
            <a href={serviceHref('aadhaar', null, c.sid)}>SID {c.sid}</a>
            <span>{prettyWhen(c.enrolledAt)}</span>
          </>
        ) : <span>{t('After the certificates')}</span>}
      </li>
    </ol>
  );
}

// The one thing to do now, for the case's stage.
function NextStep({ c, onChange }) {
  const [nums, setNums] = useState({ community: '', income: '', obc: '' });
  const [sid, setSid] = useState('');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (path, body) => {
    setBusy(true);
    try {
      const r = await api(`cases/${c.id}/${path}`, { method: 'POST', body });
      onChange(r.case || r);
      setNums({ community: '', income: '', obc: '' });
    } catch (e) {
      showError(e);
    }
    setBusy(false);
  };
  const numberField = (role, label) => (
    <label key={role} className="case-num">
      <span>{t(label)}</span>
      <input className="upper" value={nums[role]} placeholder={c.apps[role]?.applicationNo || 'TN-…'} autoComplete="off" onChange={e => setNums({ ...nums, [role]: e.target.value.toUpperCase() })} />
    </label>
  );
  const saveNums = roles => e => {
    e.preventDefault();
    const body = Object.fromEntries(roles.filter(r => nums[r].trim()).map(r => [r, nums[r].trim()]));
    if (!Object.keys(body).length) return showError({ status: 400, message: 'Enter at least one application number' });
    return run('certificates', body);
  };

  if (c.stage === 'new') {
    const missing = ['community', 'income'].filter(r => !c.apps[r]);
    return (
      <form className="case-next" onSubmit={saveNums(missing)}>
        <p><b>{t('Next:')}</b> {t('apply the Community and Income certificates on TNeDistrict, then enter their application numbers.')}</p>
        <div className="case-nums">{missing.map(r => numberField(r, r === 'community' ? 'Community application no.' : 'Income application no.'))}</div>
        <button className="btn primary" disabled={busy}>{t('Save numbers')}</button>
      </form>
    );
  }
  if (c.stage === 'obc') {
    return (
      <form className="case-next" onSubmit={saveNums(['obc'])}>
        <p><b>{t('Next:')}</b> {t('Community and Income are approved. Apply the OBC certificate now and enter its application number.')}</p>
        <div className="case-nums">{numberField('obc', 'OBC application no.')}</div>
        <button className="btn primary" disabled={busy}>{t('Save OBC number')}</button>
      </form>
    );
  }
  if (c.stage === 'attention' && c.reasonRole) {
    const label = { community: 'New Community application no.', income: 'New Income application no.', obc: 'New OBC application no.' }[c.reasonRole];
    return (
      <form className="case-next bad" onSubmit={saveNums([c.reasonRole])}>
        <p><b>{t(c.reason)}.</b> {t('Apply again and enter the new application number.')}</p>
        <div className="case-nums">{numberField(c.reasonRole, label)}</div>
        <button className="btn primary" disabled={busy}>{t('Save new number')}</button>
      </form>
    );
  }
  if (c.stage === 'certs' || c.stage === 'obc-applied') {
    return <p className="case-next quiet">{t('Waiting for the certificates. They are checked automatically, and this moves on by itself.')}</p>;
  }
  if (c.stage === 'ready') {
    const enrolled = e => {
      e.preventDefault();
      run('enrolled', { sid, enrolledAt: at ? (at.length === 16 ? `${at}:00` : at) : undefined });
    };
    return (
      <div className="case-next good">
        <p><b>{t('Ready.')}</b> {t('All certificates are in. Send the customer to the Aadhaar centre.')}</p>
        <a className="btn" href={waLink(c, readyText(c))} target="_blank" rel="noopener noreferrer" onClick={() => api(`cases/${c.id}/sent`, { method: 'POST', body: { which: 'ready' } }).then(onChange).catch(() => {})}>
          {t(c.readySentAt ? 'Send again on WhatsApp' : 'Tell the customer on WhatsApp')}
        </a>
        {c.readySentAt && <span className="quiet"> {t('Sent {when}', { when: when(c.readySentAt) })}</span>}
        <form className="case-sid" onSubmit={enrolled}>
          <p>{t('After enrolment at the Aadhaar centre, enter the SID from the slip:')}</p>
          <div className="case-nums">
            <label className="case-num wide-num">
              <span>SID</span>
              <input className="upper" value={sid} autoComplete="off" placeholder="S1483822988390 20261105152827"
                onChange={e => { const v = e.target.value.toUpperCase(); setSid(v); const d = sidDate(v); if (d) setAt(d); }} />
            </label>
            <label className="case-num">
              <span>{t('Date and time')}</span>
              <input type="datetime-local" step="1" value={at} onChange={e => setAt(e.target.value)} />
            </label>
          </div>
          {sid && sidDate(sid) && at && sidDate(sid).slice(0, 16) !== at.slice(0, 16) && <p className="warn">{t('This date is not the one in the SID. Check the slip.')}</p>}
          <button className="btn primary" disabled={busy || !sid.trim()}>{t('Enrolment done')}</button>
        </form>
      </div>
    );
  }
  if (c.stage === 'centre' || (c.stage === 'attention' && c.sid)) {
    return (
      <div className={`case-next ${c.stage === 'attention' ? 'bad' : ''}`}>
        <p>{c.stage === 'attention' ? <b>{t(c.reason)}.</b> : t('Enrolled. Waiting for UIDAI. Update the status in the Aadhaar list, or here when you know.')}</p>
        <div className="case-buttons">
          <a className="btn" href={serviceHref('aadhaar', null, c.sid)}>{t('Open in Aadhaar list')}</a>
          {c.stage !== 'attention' && <button className="btn good" disabled={busy} onClick={() => run('finish', { result: 'updated' })}>{t('Name updated')}</button>}
          {c.stage !== 'attention' && <button className="btn stop" disabled={busy} onClick={() => run('finish', { result: 'rejected' })}>{t('Rejected')}</button>}
          {c.final && <button className="btn" disabled={busy} onClick={() => run('finish', { result: 'open' })}>{t('Undo')}</button>}
        </div>
      </div>
    );
  }
  if (c.stage === 'done') {
    return (
      <div className="case-next good">
        <p><b>{t('Done.')}</b> {t('The name is changed in Aadhaar.')}</p>
        <a className="btn" href={waLink(c, doneText(c))} target="_blank" rel="noopener noreferrer" onClick={() => api(`cases/${c.id}/sent`, { method: 'POST', body: { which: 'done' } }).then(onChange).catch(() => {})}>
          {t(c.doneSentAt ? 'Send again on WhatsApp' : 'Tell the customer on WhatsApp')}
        </a>
        {c.doneSentAt && <span className="quiet"> {t('Sent {when}', { when: when(c.doneSentAt) })}</span>}
        {c.final && <button className="link-btn case-undo" onClick={() => run('finish', { result: 'open' })}>{t('Undo')}</button>}
      </div>
    );
  }
  return null;
}

function AadhaarLine({ c }) {
  const [number, setNumber] = useState('');
  useEffect(() => {
    if (!number) return undefined;
    const timer = setTimeout(() => setNumber(''), 30000);
    return () => clearTimeout(timer);
  }, [number]);
  if (!c.aadhaarLast4) return null;
  return (
    <span className="case-aadhaar">
      {t('Aadhaar')}: {number ? number.replace(/(\d{4})(?=\d)/g, '$1 ') : `XXXX XXXX ${c.aadhaarLast4}`}
      <button className="link-btn" onClick={async () => { try { setNumber(number ? '' : (await api(`cases/${c.id}/aadhaar`, { method: 'POST' })).aadhaar); } catch (e) { showError(e); } }}>{t(number ? 'Hide' : 'Show')}</button>
    </span>
  );
}

function CaseCard({ c, onChange, onEdit, onPay, onRemind, onDelete }) {
  return (
    <li className={`case-card s-${c.stage}`}>
      <div className="case-head">
        <div className="case-who">
          <span className="case-stage">{t(STAGE_NAMES[c.stage])}</span>
          <h3>{c.name} <span aria-hidden="true">→</span> {c.newNameEn}</h3>
          <dl className="case-names">
            <dt>{t('Old')}</dt>
            <dd>
              <span>{c.name} <Copy text={c.name} label={t('Copy the old English name')} /></span>
              {c.nameTa && <span lang="ta">{c.nameTa} <Copy text={c.nameTa} label={t('Copy the old Tamil name')} /></span>}
            </dd>
            <dt>{t('New')}</dt>
            <dd>
              <span>{c.newNameEn} <Copy text={c.newNameEn} label={t('Copy the new English name')} /></span>
              <span lang="ta">{c.newNameTa} <Copy text={c.newNameTa} label={t('Copy the new Tamil name')} /></span>
            </dd>
          </dl>
          <p className="quiet">
            {phone(c.whatsapp)} · {t('Requested {day}', { day: new Date(`${c.requestedOn}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) })}
            {c.operatorName ? ` · ${c.operatorName}` : ''}
          </p>
          <p className="quiet"><AadhaarLine c={c} /></p>
          {c.note && <p className="case-note">{c.note}</p>}
        </div>
        <div className="case-tags">
          <MoneyTag payment={c.payment} fee={c.fee} paid={c.paid} />
          <FollowUpTag followUp={c.followUp} />
        </div>
      </div>
      <Steps c={c} />
      <NextStep c={c} onChange={onChange} />
      <div className="case-tools">
        <button className="btn" onClick={() => onPay(c)}>{t('Payment')}</button>
        <button className="btn" onClick={() => onRemind(c)}>{c.followUp ? t('Change reminder') : t('Remind me')}</button>
        <button className="btn" onClick={() => onEdit(c)}>{t('Edit')}</button>
        <button className="link-btn" onClick={() => onDelete(c)}>{t('Delete')}</button>
      </div>
    </li>
  );
}

export default function AadhaarName({ user, onLogout }) {
  const [data, setData] = useState(null);
  const [operators, setOperators] = useState([]);
  const [view, setView] = useState('open');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState(null); // { kind: 'new' | 'edit' | 'pay' | 'remind' | 'delete', c?, from? }
  const load = () => api('cases').then(setData).catch(showError);

  useEffect(() => {
    load();
    api('operators').then(setOperators).catch(() => {});
    // Started from a customer's row: their details wait in this tab's storage.
    try {
      const from = JSON.parse(sessionStorage.getItem('case-from') || 'null');
      if (from) { sessionStorage.removeItem('case-from'); setDialog({ kind: 'new', from }); }
    } catch { /* nothing to start from */ }
  }, []);

  const replace = c => setData(d => d && { ...d, items: d.items.map(x => (x.id === c.id ? c : x)) });
  const refresh = c => { replace(c); load(); };
  const words = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!data) return [];
    const test = VIEWS.find(v => v[0] === view)[2];
    return data.items.filter(test).filter(c => !words || [c.name, c.nameTa, c.newNameEn, c.newNameTa, c.whatsapp, c.sid, ...Object.values(c.apps).map(a => a.applicationNo)].join(' ').toLowerCase().includes(words));
  }, [data, view, words]);
  const count = key => (data ? data.items.filter(VIEWS.find(v => v[0] === key)[2]).length : '…');

  async function remove() {
    const { c } = dialog;
    setDialog(null);
    try {
      await api(`cases/${c.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      showError(e);
    }
  }

  return (
    <>
      <Header user={user} onLogout={onLogout} current="/aadhaar/name" counts={data ? { '/aadhaar/name': { n: data.counts.open, due: 0 } } : undefined} />
      <main className="wrap cases-page">
        <section className="lead">
          <div>
            <h1>{t('Aadhaar name change')}</h1>
            <p className="quiet">{t('Community and Income certificates, then OBC, then the Aadhaar centre. Each case moves on by itself as its certificates are approved.')}</p>
          </div>
          <button className="btn primary" onClick={() => setDialog({ kind: 'new' })}>{t('Start name change')}</button>
        </section>

        <SearchBox label={t('Search name changes')} placeholder={t('Search name, new name, phone, application number or SID')} value={query} onChange={e => setQuery(e.target.value)} />

        <nav className="views case-views" aria-label={t('Filter by stage')}>
          {VIEWS.map(([key, label]) => (
            <button key={key} className={`${view === key ? 'on' : ''} ${key === 'attention' && count(key) ? 'alert' : ''}`} aria-pressed={view === key} onClick={() => setView(key)}>
              <b>{count(key)}</b>{t(label)}
            </button>
          ))}
        </nav>

        {!data ? <SkeletonRows count={3} /> : shown.length ? (
          <ul className="case-list">
            {shown.map(c => (
              <CaseCard key={c.id} c={c} onChange={refresh}
                onEdit={x => setDialog({ kind: 'edit', c: x })} onPay={x => setDialog({ kind: 'pay', c: x })}
                onRemind={x => setDialog({ kind: 'remind', c: x })} onDelete={x => setDialog({ kind: 'delete', c: x })} />
            ))}
          </ul>
        ) : (
          <div className="empty"><p>{words ? t('Nothing found for "{search}"', { search: query.trim() }) : data.items.length ? t('No name changes in this list.') : t('Start a name change when a customer asks to change the name in their Aadhaar.')}</p></div>
        )}
      </main>

      {(dialog?.kind === 'new' || dialog?.kind === 'edit') && (
        <CaseForm found={dialog.c} from={dialog.from} operators={operators} onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); setView('open'); load(); }} />
      )}
      {dialog?.kind === 'pay' && (
        <MoneyDialog title={t('Payment: {name}', { name: dialog.c.name })} target={{ caseId: dialog.c.id }} onClose={() => { setDialog(null); load(); }} />
      )}
      {dialog?.kind === 'remind' && (
        <RemindDialog name={dialog.c.name} target={{ caseId: dialog.c.id }} current={dialog.c.followUp}
          onClose={() => setDialog(null)} onSaved={() => { setDialog(null); load(); }} />
      )}
      {dialog?.kind === 'delete' && (
        <Dialog title={t('Delete this name change?')} alert onClose={() => setDialog(null)}>
          <p>{t('The case is deleted. Its certificates and Aadhaar entry stay in their lists.')}</p>
          <div className="dialog-foot">
            <button className="btn" onClick={() => setDialog(null)}>{t('Cancel')}</button>
            <button className="btn stop-solid" onClick={remove}>{t('Delete')}</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
