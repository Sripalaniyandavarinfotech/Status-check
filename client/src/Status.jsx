import { useState } from 'react';
import { Field } from './Fields.jsx';
import Header from './Header.jsx';
import { t } from './i18n.js';
import { api, showError, when } from './lib.js';

const TONE = { ok: 'ok', bad: 'bad', none: 'none', progress: '' };

// Used on this page and on the landing page.
export function StatusForm({ autoFocus }) {
  const [form, setForm] = useState({ applicationNo: '', whatsapp: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const change = key => e => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (!form.applicationNo.trim()) found.applicationNo = t('Enter your application number');
    if (form.whatsapp.replace(/\D/g, '').length < 10) found.whatsapp = t('Enter a valid 10-digit mobile number');
    setErrors(found);
    setResult(null);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      setResult(await api('public/status', { method: 'POST', body: form }));
    } catch (err) {
      showError(err);
    }
    setBusy(false);
  }

  return (
    <>
      <form onSubmit={submit} noValidate>
        <Field id="applicationNo" label={t('Application number')} className="upper" error={errors.applicationNo} value={form.applicationNo} onChange={change('applicationNo')} autoComplete="off" autoFocus={autoFocus} />
        <Field id="whatsapp" label={t('WhatsApp number')} type="tel" inputMode="numeric" placeholder={t('10-digit mobile number')} error={errors.whatsapp} value={form.whatsapp} onChange={change('whatsapp')} autoComplete="tel" />
        <button className="btn primary wide" disabled={busy}>{busy ? t('Checking…') : t('Check status')}</button>
      </form>
      {result && (result.found ? (
        <div className="status-result" role="status">
          <p className="quiet">{t(result.service)}</p>
          <span className={`tag ${TONE[result.stage]}`}>{result.status ? t(result.status) : t('Received, not updated yet')}</span>
          <p className="quiet">{t('Updated')}: {when(result.updated)}</p>
        </div>
      ) : (
        <p className="warn status-result" role="status">{t('No application found. Please check both numbers, or contact our office.')}</p>
      ))}
    </>
  );
}

// The customers' own page. It needs no login.
export default function Status() {
  return (
    <>
      <Header />
      <main className="auth">
        <section className="auth-box">
          <h1>{t('Check your application')}</h1>
          <StatusForm autoFocus />
          <p className="auth-switch"><a href="/login">{t('Staff log in')}</a></p>
        </section>
      </main>
    </>
  );
}
