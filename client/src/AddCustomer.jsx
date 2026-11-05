import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { t } from './i18n.js';
import { showError } from './lib.js';

const EMPTY = { name: '', applicationNo: '', whatsapp: '' };

function validate(form, provider) {
  const errors = {};
  const label = provider?.numberLabel || 'Application number';
  if (!provider) errors.type = t('Choose a service');
  if (!form.name.trim()) errors.name = t('Customer name is required');
  if (!form.applicationNo.trim()) errors.applicationNo = `${t(label)}: ${t('required')}`;
  else if (provider && !new RegExp(provider.pattern).test(form.applicationNo.trim().toUpperCase())) errors.applicationNo = `${t(label)}: ${t('not valid')}`;
  let d = form.whatsapp.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!d) errors.whatsapp = t('WhatsApp number is required');
  else if (!/^[6-9]\d{9}$/.test(d)) errors.whatsapp = t('Enter a valid 10-digit mobile number');
  return errors;
}

// Adds customers, staying open so several can be entered in a row. With `customer`
// it edits that one instead and closes after saving.
export default function AddCustomer({ providers, initial, customer, onSave, onClose }) {
  const [type, setType] = useState(customer?.type || initial || providers[0]?.id || '');
  const [form, setForm] = useState(customer
    ? { name: customer.name, applicationNo: customer.applicationNo, whatsapp: customer.whatsapp.slice(2) }
    : EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const nameRef = useRef(null);
  const provider = providers.find(p => p.id === type);
  const number = form.applicationNo.trim().toUpperCase();

  // The panel has opened by now, so the name box can take the cursor.
  useEffect(() => { nameRef.current.focus(); }, []);

  const change = key => e => {
    const next = { ...form, [key]: e.target.value };
    setForm(next);
    if (errors[key]) setErrors({ ...errors, [key]: validate(next, provider)[key] });
  };

  async function submit(e) {
    e.preventDefault();
    const found = validate(form, provider);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      await onSave({ type, ...form });
      if (customer) return;
      setSaved(form.name.trim());
      setForm(EMPTY);
      nameRef.current.focus();
    } catch (err) {
      showError(err);
    }
    setSaving(false);
  }

  const field = (key, label, props) => (
    <div className="field">
      <label htmlFor={key}>{label}</label>
      <input id={key} value={form[key]} onChange={change(key)} aria-invalid={!!errors[key]} autoComplete="off" {...props} />
      {errors[key] && <p className="field-error">{errors[key]}</p>}
    </div>
  );

  return (
    <Dialog title={customer ? t('Edit customer') : t('Add customer')} onClose={onClose}>
      {saved && <p className="saved" role="status">{t('Saved {name}. Add the next customer, or close this panel.', { name: saved })}</p>}
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="service">{t('Service')}</label>
          <select id="service" value={type} disabled={!!customer} onChange={e => setType(e.target.value)}>
            {providers.map(p => <option key={p.id} value={p.id}>{t(p.name)}</option>)}
          </select>
        </div>
        {field('name', t('Customer name'), { ref: nameRef })}
        {field('applicationNo', t(provider?.numberLabel || 'Application number'), { className: 'upper', placeholder: t(provider?.placeholder || '') })}
        {customer && number !== customer.applicationNo && customer.status && (
          <p className="warn">{t('This is a new number, so the saved status will be cleared.')}</p>
        )}
        {field('whatsapp', t('WhatsApp number'), { type: 'tel', inputMode: 'numeric', placeholder: t('10-digit mobile number') })}
        <button className="btn primary wide" disabled={saving}>{saving ? t('Saving…') : customer ? t('Save changes') : t('Save customer')}</button>
      </form>
    </Dialog>
  );
}
