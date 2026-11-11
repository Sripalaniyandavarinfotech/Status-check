import { lang, plural, t, tamil } from './i18n.js';

export { plural };

const TITLES = {
  0: "Can't reach the server",
  400: 'Please check that',
  401: 'Please log in again',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Could not do that',
  413: 'Too large',
  429: 'Too many tries',
  500: 'Something went wrong',
  502: 'Another website did not answer',
  503: 'Service unavailable',
};

// Opens the error popup. `title` replaces the usual heading for this kind of error.
export function showError(error, title) {
  window.dispatchEvent(new CustomEvent('app-error', {
    detail: { title: title || t(TITLES[error.status] || 'Something went wrong'), message: t(error.message) },
  }));
}

// Calls the CRM server. Throws an Error with the server's message; `error.status`
// is the status code (0 when the server can't be reached) and `error.data` the full reply.
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api/' + path, {
      method,
      ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw Object.assign(new Error('Check your connection, and that the CRM server is running, then try again.'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('auth/')) {
    data.error = 'Your session has ended. Please log in again.';
    window.dispatchEvent(new Event('signed-out'));
    showError({ status: 401, message: data.error });
  }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Please try again in a moment.'), { status: res.status, data });
  return data;
}

// ok = finished well, bad = rejected or not found, none = no status yet, '' = in progress.
export const kind = c => (!c.lastChecked ? 'none'
  : !c.found || /reject|cancel/i.test(c.status) ? 'bad'
    : /approved|accepted|e-?roll updated|issued|complet|sign|print|deliver/i.test(c.status) ? 'ok' : '');

const LOCALE = lang === 'ta' ? 'ta-IN' : 'en-IN';

export const phone = n => `+${n.slice(0, 2)} ${n.slice(2, 7)} ${n.slice(7)}`;

export const when = iso => (iso
  ? new Date(iso).toLocaleString(LOCALE, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  : t('Not yet'));

export const shortMonth = ym => new Date(`${ym}-15`).toLocaleString(LOCALE, { month: 'short' });

export const monthName = ym => new Date(`${ym}-15`).toLocaleString(LOCALE, { month: 'long', year: 'numeric' });

// The service's details, with the PAN agency's own number rules and website on top.
export const withAgency = (provider, agency) => (provider?.agencies?.[agency] ? { ...provider, ...provider.agencies[agency] } : provider);

// Today in India, as DD/MM/YYYY.
export const today = () => new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });

// Customers always get Tamil, whichever language the staff member's site is in.
export function whatsappText(c, provider) {
  const service = tamil(provider?.shortName || c.service || c.type);
  const values = { name: c.name, service, number: c.applicationNo };
  return c.lastChecked && c.found
    ? tamil('Hello {name}, there is an update on your {service} application {number}. Current status: {status}. Thank you.', { ...values, status: tamil(c.status) })
    : tamil('Hello {name}, regarding your {service} application {number}.', values);
}

export const whatsappLink = (c, provider) => `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(whatsappText(c, provider))}`;

// Browsers only offer the clipboard on https and localhost, so plain addresses
// like http://192.168.1.40 use the older way.
export async function copyText(text) {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* falls through to the older way */ }
  }
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.style.position = 'fixed';
  box.style.opacity = '0';
  (document.querySelector('dialog[open]') || document.body).append(box);
  box.select();
  const done = document.execCommand('copy');
  box.remove();
  return done;
}

export function downloadCsv(customers, providers, fileName) {
  const cols = ['name', 'type', 'panAgency', 'operatorName', 'panKind', 'applicationNo', 'whatsapp', 'birthDate', 'appliedOn', 'service', 'status', 'remarks', 'lastChecked', 'createdAt'];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const name = c => providers.find(p => p.id === c.type)?.name || c.type;
  const lines = [cols.join(','), ...customers.map(c => cols.map(k => cell(k === 'type' ? name(c) : c[k])).join(','))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = fileName;
  a.click();
}
