import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';

const EMPTY = { name: '', applicationNo: '', whatsapp: '' };

function validate(form, provider) {
  const errors = {};
  const label = provider?.numberLabel || 'Application number';
  if (!provider) errors.type = 'Choose a service';
  if (!form.name.trim()) errors.name = 'Customer name is required';
  if (!form.applicationNo.trim()) errors.applicationNo = `${label} is required`;
  else if (provider && !new RegExp(provider.pattern).test(form.applicationNo.trim().toUpperCase())) errors.applicationNo = `Enter a valid ${label.toLowerCase()}`;
  let d = form.whatsapp.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!d) errors.whatsapp = 'WhatsApp number is required';
  else if (!/^[6-9]\d{9}$/.test(d)) errors.whatsapp = 'Enter a valid 10-digit mobile number';
  return errors;
}

// Stays open after saving, so several customers can be entered in a row.
export default function AddCustomer({ providers, initial, onSave, onClose }) {
  const [type, setType] = useState(initial || providers[0]?.id || '');
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const nameRef = useRef(null);
  const provider = providers.find(p => p.id === type);

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
      setSaved(form.name.trim());
      setForm(EMPTY);
      nameRef.current.focus();
    } catch (err) {
      setErrors({ form: err.message });
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
    <Dialog title="Add customer" onClose={onClose}>
      {saved && <p className="saved" role="status">Saved {saved}. Add the next customer, or close this panel.</p>}
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="service">Service</label>
          <select id="service" value={type} onChange={e => setType(e.target.value)}>
            {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {field('name', 'Customer name', { ref: nameRef })}
        {field('applicationNo', provider?.numberLabel || 'Application number', { className: 'upper', placeholder: provider?.placeholder })}
        {field('whatsapp', 'WhatsApp number', { type: 'tel', inputMode: 'numeric', placeholder: '10-digit mobile number' })}
        {errors.form && <p className="field-error">{errors.form}</p>}
        <button className="btn primary wide" disabled={saving}>{saving ? 'Saving…' : 'Save customer'}</button>
      </form>
    </Dialog>
  );
}
