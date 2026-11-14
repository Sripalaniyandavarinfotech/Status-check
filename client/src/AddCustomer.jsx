import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { t } from './i18n.js';
import { api, showError, today } from './lib.js';
import { PaymentPick } from './Money.jsx';
import { parsePanReceipt, pdfLines } from './panReceipt.js';

const EMPTY = { operatorId: '', name: '', applicationNo: '', whatsapp: '', aadhaar: '', panKind: '', birthDate: '', appliedOn: '', payment: 'paid', fee: '', paidNow: '', payMode: 'cash' };
const DATE = /^\d{2}\/\d{2}\/\d{4}$/;

function validate(form, provider, needOperator) {
  const errors = {};
  if (needOperator && !form.operatorId) errors.operatorId = t('Choose an operator');
  const label = provider?.numberLabel || 'Application number';
  if (!form.name.trim()) errors.name = t('Customer name is required');
  if (!form.applicationNo.trim()) errors.applicationNo = `${t(label)}: ${t('required')}`;
  else if (provider && !new RegExp(provider.pattern).test(form.applicationNo.trim().toUpperCase())) errors.applicationNo = `${t(label)}: ${t('not valid')}`;
  let d = form.whatsapp.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!d) errors.whatsapp = t('WhatsApp number is required');
  else if (!/^[6-9]\d{9}$/.test(d)) errors.whatsapp = t('Enter a valid 10-digit mobile number');
  if (form.birthDate.trim() && !DATE.test(form.birthDate.trim())) errors.birthDate = t('Enter the date of birth as DD/MM/YYYY');
  if (form.appliedOn.trim() && !DATE.test(form.appliedOn.trim())) errors.appliedOn = t('Enter the application date as DD/MM/YYYY');
  if (form.fee && !(/^\d{1,6}$/.test(form.fee) && Number(form.fee) <= 100000)) errors.fee = t('Enter the fee in whole rupees');
  if (form.paidNow && !(/^\d{1,6}$/.test(form.paidNow) && Number(form.paidNow) <= 100000)) errors.paidNow = t('Enter the amount paid in whole rupees');
  const aadhaar = form.aadhaar.replace(/[\s-]/g, '');
  if (aadhaar && !/^[2-9]\d{11}$/.test(aadhaar)) errors.aadhaar = t('Enter a valid 12-digit Aadhaar number');
  return errors;
}

// Each service box has its own form, for the service that is open. It stays open so
// several can be entered in a row. With `customer` it edits that one and closes after saving.
export default function AddCustomer({ provider, agency = '', operators, customer, onSave, onClose }) {
  const [form, setForm] = useState(customer
    ? { name: customer.name, applicationNo: customer.applicationNo, whatsapp: customer.whatsapp.slice(2), aadhaar: '', operatorId: customer.operatorId || '', panKind: customer.panKind || '', birthDate: customer.birthDate || '', appliedOn: customer.appliedOn || '' }
    : { ...EMPTY, appliedOn: today() });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [result, setResult] = useState(''); // 'done' or 'error', for a moment after saving
  const flash = state => {
    setResult(state);
    setTimeout(() => setResult(r => (r === state ? '' : r)), state === 'done' ? 1400 : 500);
  };
  const [receipt, setReceipt] = useState(''); // the note after reading a receipt
  const [dragging, setDragging] = useState(false); // a file is being dragged over the page
  const nameRef = useRef(null);
  const type = provider.id;
  const [price, setPrice] = useState(null); // the shop's price for this service
  const [amounts, setAmounts] = useState(false); // the optional amount box is open

  // A new customer's fee starts at the shop's price for the service.
  useEffect(() => {
    if (customer) return;
    api('money/prices').then(p => {
      const v = p[type] == null ? '' : String(p[type]);
      setPrice(v);
      setForm(f => (f.fee ? f : { ...f, fee: v }));
    }).catch(() => {});
  }, [customer, type]);
  const needOperator = !customer && operators.length > 0;
  const operatorChoices = customer ? [{ id: '', name: t('No operator') }, ...operators] : operators;
  const askAadhaar = type === 'aadhaar' || !!customer?.aadhaarLast4;
  const number = form.applicationNo.trim().toUpperCase();

  // The panel has opened by now, so the name box can take the cursor.
  useEffect(() => { nameRef.current.focus(); }, []);

  const change = key => e => {
    const next = { ...form, [key]: e.target.value };
    setForm(next);
    if (errors[key]) setErrors({ ...errors, [key]: validate(next, provider, needOperator)[key] });
  };

  async function submit(e) {
    e.preventDefault();
    const found = validate(form, provider, needOperator);
    setErrors(found);
    if (Object.keys(found).length) return flash('error');
    setSaving(true);
    try {
      const { payment, fee, paidNow, payMode, ...rest } = form;
      const money = amounts ? { fee, paidNow, payMode } : {};
      await onSave(customer ? { type, ...rest } : { type, ...rest, payment, ...money, panAgency: agency || undefined });
      if (customer) return;
      flash('done');
      setSaved(form.name.trim());
      setForm({ ...EMPTY, operatorId: form.operatorId, appliedOn: today(), payment: form.payment, fee: price || '', payMode: form.payMode }); // the same operator usually adds the next one
      nameRef.current.focus();
    } catch (err) {
      flash('error');
      showError(err);
    }
    setSaving(false);
    return undefined;
  }

  // The file is read here in the browser, and is never sent or saved.
  async function readReceipt(file) {
    if (!file) return;
    setReceipt('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('too large');
      const found = parsePanReceipt(await pdfLines(file));
      if (!found) throw new Error('not a receipt');
      const { whatsapp, ...rest } = found;
      setForm(f => ({ ...f, ...rest, whatsapp: whatsapp || f.whatsapp }));
      setErrors({});
      setSaved('');
      const missing = !found.name || !found.birthDate || !found.whatsapp || !found.appliedOn;
      setReceipt(missing ? t('Some details were not found. Please fill in the empty boxes.') : t('Details filled in from the receipt. Please check them.'));
    } catch {
      showError({ message: t('This PDF could not be read as a UTIITSL PAN receipt. Please type the details instead.') });
    }
  }

  // A receipt can be dropped anywhere, so a near miss doesn't open the PDF and leave the site.
  const takesReceipt = type === 'pan' && agency === 'UTI' && !customer;
  useEffect(() => {
    if (!takesReceipt) return undefined;
    const over = e => {
      e.preventDefault();
      setDragging(true);
    };
    const leave = e => { if (!e.relatedTarget) setDragging(false); };
    const drop = e => {
      e.preventDefault();
      setDragging(false);
      readReceipt(e.dataTransfer.files[0]);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [takesReceipt]);

  const field = (key, label, props) => (
    <div className="field">
      <label htmlFor={key}>{label}</label>
      <input id={key} value={form[key]} onChange={change(key)} aria-invalid={!!errors[key]} autoComplete="off" {...props} />
      {errors[key] && <p className="field-error">{errors[key]}</p>}
    </div>
  );

  return (
    <Dialog title={customer ? t('Edit {service} customer', { service: agency ? `${t(provider.shortName)} ${agency}` : t(provider.shortName) }) : t('Add {service} customer', { service: agency ? `${t(provider.shortName)} ${agency}` : t(provider.shortName) })} onClose={onClose}>
      {saved && <p className="saved" role="status">{t('Saved {name}. Add the next customer, or close this panel.', { name: saved })}</p>}
      {type === 'pan' && agency === 'NSDL' && !customer && (
        <p className="quiet add-note">{t('Reading NSDL receipts comes once a sample receipt is added. Type the details for now.')}</p>
      )}
      {takesReceipt && (
        <div className="receipt-box">
          <label className={`receipt-drop ${dragging ? 'on' : ''}`}>
            <input type="file" accept="application/pdf,.pdf" onChange={e => { const file = e.target.files[0]; e.target.value = ''; readReceipt(file); }} />
            <b>{t(dragging ? 'Drop the receipt here' : 'Upload receipt')}</b>
            <span>{t('Drag the UTIITSL PDF here, or click to choose it')}</span>
          </label>
          {receipt && <p className="saved" role="status">{receipt}</p>}
        </div>
      )}
      <form onSubmit={submit} noValidate>
        {operators.length > 0 ? (
          <fieldset className="field pick">
            <legend>{t('Operator')}</legend>
            <div>
              {operatorChoices.map(o => (
                <label key={o.id}>
                  <input type="radio" name="operator" checked={form.operatorId === o.id} onChange={() => { setForm({ ...form, operatorId: o.id }); setErrors({ ...errors, operatorId: undefined }); }} />
                  <span>{o.name}</span>
                </label>
              ))}
            </div>
            {errors.operatorId && <p className="field-error">{errors.operatorId}</p>}
          </fieldset>
        ) : !customer && <p className="quiet add-note">{t('Add your operators in Profile to choose one here.')}</p>}
        {['pan', 'smartcard'].includes(type) && (
          <fieldset className="field pick">
            <legend>{t('Application type')}</legend>
            <div>
              {['New', 'Correction'].map(kind => (
                <label key={kind}>
                  <input type="radio" name="panKind" checked={form.panKind === kind} onChange={() => setForm({ ...form, panKind: kind })} />
                  <span>{t(kind)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {field('name', t('Customer name'), { ref: nameRef })}
        {type === 'pan' && field('birthDate', t('Date of birth'), { inputMode: 'numeric', placeholder: 'DD/MM/YYYY' })}
        {field('applicationNo', t(provider?.numberLabel || 'Application number'), { className: 'upper', placeholder: t(provider?.placeholder || '') })}
        {customer && number !== customer.applicationNo && customer.status && (
          <p className="warn">{t('This is a new number, so the saved status will be cleared.')}</p>
        )}
        {field('whatsapp', t('WhatsApp number'), { type: 'tel', inputMode: 'numeric', placeholder: t('10-digit mobile number') })}
        {field('appliedOn', t('Application date'), { inputMode: 'numeric', placeholder: 'DD/MM/YYYY' })}
        {!customer && (
          <fieldset className="field pay-field">
            <legend className="pay-legend">{t('Payment')}</legend>
            <PaymentPick value={form.payment} onChange={v => setForm({ ...form, payment: v })} />
          </fieldset>
        )}
        {!customer && (
          <details className="money-more add-amounts" open={amounts} onToggle={e => setAmounts(e.currentTarget.open)}>
          <summary>{t('Amount details (optional)')}</summary>
          <div className="fee-row">
            {field('fee', t('Fee (₹)'), { inputMode: 'numeric', placeholder: t('No fee') })}
            {field('paidNow', t('Paid now (₹)'), { inputMode: 'numeric', placeholder: '0' })}
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
        {askAadhaar && field('aadhaar', t('Aadhaar number (optional)'), { inputMode: 'numeric', placeholder: customer?.aadhaarLast4 ? t('XXXX XXXX {digits} saved. Type to replace it.', { digits: customer.aadhaarLast4 }) : t('12-digit number') })}
        <button className={`btn primary wide save-btn ${saving ? 'busy' : result}`} disabled={saving} aria-live="polite">
          {saving ? <><i className="save-spin" aria-hidden="true" />{t('Saving…')}</>
            : result === 'done' ? <><i className="save-tick" aria-hidden="true" />{t('Saved')}</>
              : customer ? t('Save changes') : t('Save customer')}
        </button>
      </form>
    </Dialog>
  );
}
