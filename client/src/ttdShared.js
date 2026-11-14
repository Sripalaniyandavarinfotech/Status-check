import { lang, t, tamil } from './i18n.js';

// The same rules as lib/ttd.js on the server, which checks them again on every save.
export const KINDS = {
  sed300: { label: '₹300 Special Entry Darshan', short: '₹300 Darshan', min: 1, max: 6, dated: true },
  angapradakshinam: { label: 'Angapradakshinam', short: 'Angapradakshinam', min: 1, max: 2, dated: true },
  edip: { label: 'E-DIP', short: 'E-DIP', min: 1, max: 2, dated: false },
  senior: { label: 'Senior citizen', short: 'Senior citizen', min: 1, max: 2, dated: true, oldest: 75 },
};
export const KIND_ORDER = ['sed300', 'angapradakshinam', 'edip', 'senior'];
export const GENDERS = ['Male', 'Female', 'Other'];

const LOCALE = lang === 'ta' ? 'ta-IN' : 'en-IN';
const fmt = (d, opts) => new Date(`${d}T00:00:00`).toLocaleDateString(LOCALE, opts);
export const day = d => fmt(d, { day: 'numeric', month: 'short', year: 'numeric' });

// "Only 15 Dec 2026", "Any day 10 Dec – 20 Dec 2026", "Any available date".
export function dateText(b) {
  if (!KINDS[b.kind]?.dated) return t('No date needed');
  if (b.dateMode === 'fixed') return t('Only {date}', { date: day(b.dateFrom) });
  if (b.dateMode === 'range') return t('Any day {from} – {to}', { from: fmt(b.dateFrom, { day: 'numeric', month: 'short' }), to: day(b.dateTo) });
  return t('Any available date');
}

// Aadhaar shown in groups of 4, copied without spaces.
export const spaced = n => String(n || '').replace(/(\d{4})(?=\d)/g, '$1 ');

// The customer's WhatsApp message, always in Tamil.
export function ticketMessage(b) {
  const values = { name: b.pilgrims[0]?.name || '', type: tamil(KINDS[b.kind]?.label || 'TTD'), ref: b.refNo || '-', count: b.pilgrims.length };
  return tamil('Hello {name}, your TTD {type} booking is confirmed. Reference number: {ref}. Pilgrims: {count}. Thank you.', values);
}
export const ticketLink = b => `https://wa.me/${b.whatsapp}?text=${encodeURIComponent(ticketMessage(b))}`;

export const groupName = b => (b.pilgrims.length > 1 ? `${b.pilgrims[0]?.name} +${b.pilgrims.length - 1}` : b.pilgrims[0]?.name || '');

// Opens booking mode in a small window. Where the browser allows it
// (Chrome, Brave and Edge 116 and later) the window is pinned on top of
// every other window, so it stays visible over the TTD site. Other browsers
// get a normal pop-up window.
export async function openSideWindow() {
  const url = '/ttd/book?side=1';
  const pip = window.documentPictureInPicture;
  if (pip && window.isSecureContext !== false) {
    try {
      if (pip.window) { pip.window.focus(); return; }
      const win = await pip.requestWindow({ width: 470, height: 860 });
      const doc = win.document;
      doc.title = 'Booking mode - TTD';
      doc.body.style.cssText = 'margin:0;height:100vh;background:#f3ecdf';
      const frame = doc.createElement('iframe');
      frame.src = url;
      frame.title = 'Booking mode';
      frame.allow = 'clipboard-read; clipboard-write';
      frame.style.cssText = 'border:0;width:100%;height:100%;display:block';
      frame.addEventListener('load', () => { try { frame.contentWindow.focus(); } catch { /* not focused */ } });
      doc.body.append(frame);
      return;
    } catch { /* fall back to a normal window */ }
  }
  window.open(url, 'ttd-book', 'popup,width=470,height=900');
}
