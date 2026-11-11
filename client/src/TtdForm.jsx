import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { Field } from './Fields.jsx';
import { t } from './i18n.js';
import { api, showError } from './lib.js';
import { GENDERS, KINDS, KIND_ORDER, spaced } from './ttdShared.js';

// Adding or editing a TTD booking. The fields follow the TTD form: general details
// once, then one row per pilgrim. The server checks every rule again on save.

const blankPilgrim = () => ({ key: Math.random().toString(36).slice(2), name: '', age: '', gender: '', aadhaar: '' });
// Today in India as YYYY-MM-DD, the earliest date the calendar offers.
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const localPhone = wa => (wa && wa.length === 12 ? wa.slice(2) : wa || '');

function fromBooking(b) {
  if (!b) {
    return {
      kind: 'sed300', dateMode: 'any', dateFrom: '', dateTo: '', email: '', city: '', state: 'Tamil Nadu', country: 'India', pincode: '',
      whatsapp: '', operatorId: '', notes: '', pilgrims: [blankPilgrim()],
    };
  }
  return {
    kind: b.kind, dateMode: b.dateMode || 'any', dateFrom: b.dateFrom || '', dateTo: b.dateTo || '', email: b.email, city: b.city,
    state: b.state, country: b.country, pincode: b.pincode, whatsapp: localPhone(b.whatsapp), operatorId: b.operatorId || '', notes: b.notes || '',
    pilgrims: b.pilgrims.map(p => ({ key: p.id, id: p.id, name: p.name, age: String(p.age), gender: p.gender, aadhaar: '', saved: p.aadhaarLast4 })),
  };
}

// Finds a saved customer by name or phone, to fill a pilgrim from.
function CustomerPick({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const box = useRef(null);
  useEffect(() => {
    if (q.trim().length < 2) { setList([]); return undefined; }
    const timer = setTimeout(() => api(`ttd/customers?q=${encodeURIComponent(q.trim())}`).then(setList).catch(() => {}), 250);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    const away = e => { if (box.current && !box.current.contains(e.target)) onClose(); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose]);
  return (
    <div className="ttd-cpick" ref={box}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={t('Customer name or phone')} aria-label={t('Customer name or phone')} />
      {list.length > 0 && (
        <ul>
          {list.map(c => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c)}>
                <b>{c.name}</b>
                <span className="quiet">{localPhone(c.whatsapp)}{c.hasAadhaar ? ` · Aadhaar ••${c.aadhaarLast4}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !list.length && <p className="quiet">{t('No customer matches.')}</p>}
    </div>
  );
}

export default function TtdForm({ booking, operators, onSaved, onClose }) {
  const [form, setForm] = useState(() => fromBooking(booking));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [picking, setPicking] = useState(null); // the pilgrim row choosing a customer
  const rule = KINDS[form.kind];
  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));
  const setPilgrim = (i, key, value) => setForm(f => ({ ...f, pilgrims: f.pilgrims.map((p, n) => (n === i ? { ...p, [key]: value } : p)) }));

  function chooseKind(kind) {
    // A smaller booking keeps only the pilgrims it allows.
    setForm(f => ({ ...f, kind, pilgrims: f.pilgrims.slice(0, KINDS[kind].max) }));
  }

  function pickCustomer(i, c) {
    setForm(f => ({
      ...f,
      whatsapp: f.whatsapp || localPhone(c.whatsapp),
      pilgrims: f.pilgrims.map((p, n) => (n === i ? { ...p, name: p.name || c.name, fromCustomer: c.hasAadhaar ? c.id : null, fromLast4: c.hasAadhaar ? c.aadhaarLast4 : null } : p)),
    }));
    setPicking(null);
  }

  const flash = state => { setResult(state); setTimeout(() => setResult(r => (r === state ? '' : r)), state === 'done' ? 900 : 500); };

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = {
        ...form,
        pilgrims: form.pilgrims.map(p => ({ id: p.id, name: p.name, age: p.age, gender: p.gender, idType: 'Aadhaar', aadhaar: p.aadhaar, fromCustomer: p.aadhaar ? null : p.fromCustomer || null })),
      };
      const saved = await api(booking ? `ttd/${booking.id}/edit` : 'ttd', { method: 'POST', body });
      flash('done');
      setTimeout(() => onSaved(saved), 700);
    } catch (err) {
      flash('error');
      if (err.status === 400) setError(t(err.message));
      else showError(err);
    }
    setBusy(false);
  }

  const oldestOk = !rule.oldest || form.pilgrims.some(p => Number(p.age) >= rule.oldest);

  return (
    <Dialog wide title={booking ? t('Edit TTD booking') : t('Add TTD booking')} onClose={onClose}>
      <form className="ttd-form" onSubmit={submit} noValidate>
        {error && <p className="warn" role="alert">{error}</p>}

        <fieldset className="field pick">
          <legend>{t('Booking type')}</legend>
          <div>
            {KIND_ORDER.map(k => (
              <label key={k}>
                <input type="radio" name="kind" checked={form.kind === k} onChange={() => chooseKind(k)} />
                <span>{t(KINDS[k].label)}</span>
              </label>
            ))}
          </div>
          <p className="quiet ttd-rule">
            {rule.max === 1 ? t('1 pilgrim') : t('{min} to {max} pilgrims', { min: rule.min, max: rule.max })}
            {rule.oldest ? `. ${t('At least one must be {age} or older.', { age: rule.oldest })}` : ''}
            {!rule.dated ? `. ${t('No date needed.')}` : ''}
          </p>
        </fieldset>

        {rule.dated && (
          <fieldset className="field pick">
            <legend>{t('Which date do they want?')}</legend>
            <div>
              {[['fixed', 'One fixed date'], ['range', 'Any date in a range'], ['any', 'Any date']].map(([m, label]) => (
                <label key={m}>
                  <input type="radio" name="dateMode" checked={form.dateMode === m} onChange={() => setForm(f => ({ ...f, dateMode: m }))} />
                  <span>{t(label)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {/* Outside the choice group: its style hides the inputs inside it. */}
        {rule.dated && form.dateMode !== 'any' && (
          <div className="ttd-dates">
            <Field id="ttd-from" label={form.dateMode === 'fixed' ? t('Date') : t('From')} type="date" value={form.dateFrom} min={todayIso()} onChange={set('dateFrom')} />
            {form.dateMode === 'range' && <Field id="ttd-to" label={t('To')} type="date" value={form.dateTo} min={form.dateFrom || todayIso()} onChange={set('dateTo')} />}
          </div>
        )}

        <h3 className="ttd-sub">{t('General details')}</h3>
        <div className="ttd-grid">
          <Field id="ttd-email" label={t('Email address')} type="email" value={form.email} onChange={set('email')} autoComplete="off" />
          <Field id="ttd-city" label={t('City')} value={form.city} onChange={set('city')} />
          <Field id="ttd-state" label={t('State')} value={form.state} onChange={set('state')} />
          <Field id="ttd-country" label={t('Country')} value={form.country} onChange={set('country')} />
          <Field id="ttd-pin" label={t('Pincode')} inputMode="numeric" maxLength={6} value={form.pincode} onChange={e => setForm(f => ({ ...f, pincode: e.target.value.replace(/\D/g, '') }))} />
          <Field id="ttd-wa" label={t('Customer WhatsApp (for the ticket)')} type="tel" inputMode="numeric" value={form.whatsapp} onChange={set('whatsapp')} />
        </div>

        <h3 className="ttd-sub">{t('Pilgrim details')}</h3>
        <ol className="ttd-pilgrims">
          {form.pilgrims.map((p, i) => (
            <li key={p.key}>
              <div className="ttd-p-head">
                <b>{t('Pilgrim {n}', { n: i + 1 })}</b>
                <span>
                  <button type="button" className="link-btn ink" onClick={() => setPicking(picking === i ? null : i)}>{t('Fill from a customer')}</button>
                  {form.pilgrims.length > rule.min && (
                    <button type="button" className="link-btn" onClick={() => setForm(f => ({ ...f, pilgrims: f.pilgrims.filter((_, n) => n !== i) }))}>{t('Remove')}</button>
                  )}
                </span>
              </div>
              {picking === i && <CustomerPick onPick={c => pickCustomer(i, c)} onClose={() => setPicking(null)} />}
              <div className="ttd-p-row">
                <Field id={`ttd-name-${i}`} label={t('Name')} value={p.name} onChange={e => setPilgrim(i, 'name', e.target.value)} />
                <Field id={`ttd-age-${i}`} label={t('Age')} inputMode="numeric" maxLength={3} value={p.age} onChange={e => setPilgrim(i, 'age', e.target.value.replace(/\D/g, ''))} />
                <fieldset className="field pick ttd-gender">
                  <legend>{t('Gender')}</legend>
                  <div>
                    {GENDERS.map(g => (
                      <label key={g}>
                        <input type="radio" name={`gender-${p.key}`} checked={p.gender === g} onChange={() => setPilgrim(i, 'gender', g)} />
                        <span>{t(g)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="ttd-p-row id">
                <div className="field">
                  <label>{t('Photo ID proof')}</label>
                  <p className="ttd-fixed">Aadhaar</p>
                </div>
                <Field
                  id={`ttd-aadhaar-${i}`}
                  label={t('Photo ID number')}
                  inputMode="numeric"
                  maxLength={14}
                  value={spaced(p.aadhaar)}
                  onChange={e => setPilgrim(i, 'aadhaar', e.target.value.replace(/\D/g, '').slice(0, 12))}
                  placeholder={p.saved ? t('Saved ••{last4}, leave empty to keep', { last4: p.saved }) : p.fromLast4 ? t('From customer ••{last4}', { last4: p.fromLast4 }) : 'XXXX XXXX XXXX'}
                />
              </div>
            </li>
          ))}
        </ol>
        {form.pilgrims.length < rule.max && (
          <button type="button" className="btn ttd-add-p" onClick={() => setForm(f => ({ ...f, pilgrims: [...f.pilgrims, blankPilgrim()] }))}>
            + {t('Add pilgrim')} ({form.pilgrims.length}/{rule.max})
          </button>
        )}
        {!oldestOk && <p className="warn">{t('At least one pilgrim must be {age} or older.', { age: rule.oldest })}</p>}

        {operators.length > 0 && (
          <fieldset className="field pick">
            <legend>{t('Operator')}</legend>
            <div>
              {[{ id: '', name: t('No operator') }, ...operators].map(o => (
                <label key={o.id || 'none'}>
                  <input type="radio" name="ttd-operator" checked={form.operatorId === String(o.id)} onChange={() => setForm(f => ({ ...f, operatorId: String(o.id) }))} />
                  <span>{o.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="field">
          <label htmlFor="ttd-notes">{t('Notes')}</label>
          <textarea id="ttd-notes" rows={2} maxLength={500} value={form.notes} onChange={set('notes')} />
        </div>

        <button className={`btn primary wide save-btn ${busy ? 'busy' : result}`} disabled={busy}>
          {busy ? <><i className="save-spin" aria-hidden="true" />{t('Saving…')}</>
            : result === 'done' ? <><i className="save-tick" aria-hidden="true" />{t('Saved')}</>
              : booking ? t('Save changes') : t('Save booking')}
        </button>
      </form>
    </Dialog>
  );
}
