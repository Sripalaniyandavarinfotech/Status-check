import { useState } from 'react';
import Header from './Header.jsx';
import { api } from './lib.js';

function Page({ title, children }) {
  return (
    <>
      <Header />
      <main className="auth">
        <section className="auth-box">
          <h1>{title}</h1>
          {children}
        </section>
      </main>
    </>
  );
}

export function Field({ id, label, error, ...props }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} aria-invalid={!!error} {...props} />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function PasswordField({ id, label, error, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw">
        <input id={id} name={id} type={show ? 'text' : 'password'} aria-invalid={!!error} {...props} />
        <button type="button" aria-label={show ? `Hide ${label}` : `Show ${label}`} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function Login({ admin, onLogin }) {
  const [form, setForm] = useState({ userId: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const change = key => e => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!form.userId.trim() || !form.password) return setError('Enter your user ID and password');
    setBusy(true);
    setError('');
    try {
      const { user } = await api('auth/login', { method: 'POST', body: { ...form, area: admin ? 'admin' : 'user' } });
      if (!admin) window.history.replaceState(null, '', '/');
      onLogin(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Page title={admin ? 'Admin log in' : 'Log in'}>
      <form className="auth-card" onSubmit={submit} noValidate>
        {error && <p className="warn" role="alert">{error}</p>}
        <Field id="userId" label="User ID" value={form.userId} onChange={change('userId')} autoComplete="username" autoCapitalize="none" autoFocus />
        <PasswordField id="password" label="Password" value={form.password} onChange={change('password')} autoComplete="current-password" />
        <button className="btn primary wide" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        {!admin && <p className="auth-switch"><a href="/forgot">Forgotten password?</a></p>}
        {!admin && <p className="auth-switch">New here? <a href="/register">Register</a></p>}
      </form>
    </Page>
  );
}

function validate(form) {
  const errors = {};
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(form.userId.trim())) errors.userId = 'Use 3 to 30 letters or numbers, with no spaces';
  if (form.password.length < 8) errors.password = 'Use at least 8 characters';
  else if (form.password !== form.again) errors.again = 'The passwords do not match';
  let d = form.phone.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) errors.phone = 'Enter a valid 10-digit phone number';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Enter a valid email address';
  return errors;
}

export function Register() {
  const [form, setForm] = useState({ userId: '', password: '', again: '', phone: '', email: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const change = key => e => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const { again, ...body } = form;
      await api('auth/register', { method: 'POST', body });
      setDone(true);
    } catch (err) {
      setErrors({ form: err.message });
    }
    setBusy(false);
  }

  if (done) {
    return (
      <Page title="Registration sent">
        <div className="auth-card">
          <p className="saved" role="status">You can log in as soon as the admin accepts your registration.</p>
          <a className="btn primary wide center" href="/login">Go to log in</a>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Register">
      <form className="auth-card" onSubmit={submit} noValidate>
        {errors.form && <p className="warn" role="alert">{errors.form}</p>}
        <Field id="userId" label="User ID" error={errors.userId} value={form.userId} onChange={change('userId')} autoComplete="username" autoCapitalize="none" autoFocus />
        <PasswordField id="password" label="Password" error={errors.password} value={form.password} onChange={change('password')} autoComplete="new-password" />
        <PasswordField id="again" label="Password again" error={errors.again} value={form.again} onChange={change('again')} autoComplete="new-password" />
        <Field id="phone" label="Phone number" type="tel" inputMode="numeric" error={errors.phone} value={form.phone} onChange={change('phone')} autoComplete="tel" />
        <Field id="email" label="Email" type="email" error={errors.email} value={form.email} onChange={change('email')} autoComplete="email" />
        <button className="btn primary wide" disabled={busy}>{busy ? 'Sending…' : 'Register'}</button>
        <p className="auth-switch">Already registered? <a href="/login">Log in</a></p>
      </form>
    </Page>
  );
}

export function Forgot() {
  const [who, setWho] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!who.trim()) return setError('Enter your user ID or email');
    setBusy(true);
    setError('');
    try {
      await api('auth/forgot', { method: 'POST', body: { userId: who } });
      setSent(true);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <Page title="Check your email">
        <div className="auth-card">
          <p className="saved" role="status">If this account has an email, a reset link is on its way. It works for 30 minutes.</p>
          <p className="quiet">First time? FormSubmit sends an activation email first. Confirm it, wait 5 minutes, then ask for the link again.</p>
          <a className="btn primary wide center" href="/login">Go to log in</a>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Forgotten password">
      <form className="auth-card" onSubmit={submit} noValidate>
        {error && <p className="warn" role="alert">{error}</p>}
        <Field id="who" label="User ID or email" value={who} onChange={e => setWho(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus />
        <button className="btn primary wide" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
        <p className="auth-switch"><a href="/login">Back to log in</a></p>
      </form>
    </Page>
  );
}

export function Reset() {
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') || '');
  const [form, setForm] = useState({ password: '', again: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (form.password.length < 8) found.password = 'Use at least 8 characters';
    else if (form.password !== form.again) found.again = 'The passwords do not match';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await api('auth/reset', { method: 'POST', body: { token, password: form.password } });
      setDone(true);
    } catch (err) {
      setErrors({ form: err.message });
    }
    setBusy(false);
  }

  if (done) {
    return (
      <Page title="Password changed">
        <div className="auth-card">
          <p className="saved" role="status">Your new password is ready.</p>
          <a className="btn primary wide center" href="/login">Go to log in</a>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Choose a new password">
      <form className="auth-card" onSubmit={submit} noValidate>
        {errors.form && <p className="warn" role="alert">{errors.form} <a href="/forgot">Forgotten password</a></p>}
        <PasswordField id="password" label="New password" error={errors.password} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete="new-password" autoFocus />
        <PasswordField id="again" label="New password again" error={errors.again} value={form.again} onChange={e => setForm({ ...form, again: e.target.value })} autoComplete="new-password" />
        <button className="btn primary wide" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </Page>
  );
}
