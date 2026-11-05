// Calls the CRM server. Throws an Error with the server's message; `error.data`
// holds the full reply.
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api/' + path, {
    method,
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await res.json();
  if (res.status === 401 && !path.startsWith('auth/')) window.dispatchEvent(new Event('signed-out'));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { data });
  return data;
}

// ok = finished well, bad = rejected or not found, none = no status yet, '' = in progress.
export const kind = c => (!c.lastChecked ? 'none'
  : !c.found || /reject|cancel/i.test(c.status) ? 'bad'
    : /approved|accepted|e-?roll updated|issued|complet|sign|print|deliver/i.test(c.status) ? 'ok' : '');

export const phone = n => `+${n.slice(0, 2)} ${n.slice(2, 7)} ${n.slice(7)}`;

export const when = iso => (iso
  ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  : 'Not yet');

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function whatsappLink(c, provider) {
  const what = c.service || provider?.name || c.type;
  const text = c.lastChecked && c.found
    ? `Hello ${c.name}, your application ${c.applicationNo} (${what}) status: ${c.status}.${c.remarks ? ` Remarks: ${c.remarks}.` : ''}`
    : `Hello ${c.name}, regarding your application ${c.applicationNo} (${what}).`;
  return `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(text)}`;
}

export function downloadCsv(customers, providers, fileName) {
  const cols = ['name', 'type', 'applicationNo', 'whatsapp', 'service', 'status', 'remarks', 'lastChecked', 'createdAt'];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const name = c => providers.find(p => p.id === c.type)?.name || c.type;
  const lines = [cols.join(','), ...customers.map(c => cols.map(k => cell(k === 'type' ? name(c) : c[k])).join(','))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = fileName;
  a.click();
}
