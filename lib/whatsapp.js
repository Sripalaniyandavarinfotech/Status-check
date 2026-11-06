// Sends status updates to customers through the official WhatsApp Business Platform
// (Meta Cloud API). Business-initiated messages must use a template that Meta has
// approved; see WHATSAPP_SETUP.md.
//
// Without WA_TOKEN and WA_PHONE_NUMBER_ID it runs in test mode: nothing is sent,
// the message is only logged, so the rest of the flow can be tried safely.
const http = require('http');
const https = require('https');

const config = () => ({
  token: process.env.WA_TOKEN || '',
  phoneNumberId: process.env.WA_PHONE_NUMBER_ID || '',
  template: process.env.WA_TEMPLATE || 'application_status_update',
  language: process.env.WA_TEMPLATE_LANG || 'en',
  apiBase: process.env.WA_API_BASE || 'https://graph.facebook.com',
  apiVersion: process.env.WA_API_VERSION || 'v21.0',
  enabled: (process.env.WA_NOTIFY || 'on').toLowerCase() !== 'off',
});

function mode() {
  const c = config();
  if (!c.enabled) return 'off';
  return c.token && c.phoneNumberId ? 'live' : 'test';
}

// The 4 values filled into the template's {{1}}..{{4}}, in order.
function templateValues(customer, serviceName) {
  return [customer.name, serviceName, customer.applicationNo, customer.status].map(v => String(v || '-').slice(0, 200));
}

// Same wording as the suggested template, for logs and test mode.
const preview = ([name, service, number, status]) =>
  `Hello ${name}, there is an update on your ${service} application ${number}. Current status: ${status}. Thank you.`;

function post(url, token, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const u = new URL(url);
    // http: is only used for a local mock API when testing.
    const req = (u.protocol === 'http:' ? http : https).request({
      host: u.hostname,
      port: u.port || undefined,
      path: u.pathname,
      method: 'POST',
      timeout: 20000,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(data); } catch { /* non-JSON error page */ }
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('WhatsApp API timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Sends the status-update template to one customer.
 * Returns a record to keep on the customer: { at, status, mode, ok, messageId?, error?, text }
 */
async function sendStatusUpdate(customer, serviceName) {
  const c = config();
  const values = templateValues(customer, serviceName);
  const record = { at: new Date().toISOString(), status: customer.status, mode: mode(), text: preview(values) };

  if (record.mode === 'off') return { ...record, ok: false, error: 'Notifications are turned off' };
  if (record.mode === 'test') {
    console.log(`[whatsapp:test] would send to +${customer.whatsapp}: ${record.text}`);
    return { ...record, ok: true };
  }

  try {
    const res = await post(`${c.apiBase}/${c.apiVersion}/${c.phoneNumberId}/messages`, c.token, {
      messaging_product: 'whatsapp',
      to: customer.whatsapp,
      type: 'template',
      template: {
        name: c.template,
        language: { code: c.language },
        components: [{ type: 'body', parameters: values.map(text => ({ type: 'text', text })) }],
      },
    });
    if (res.status >= 200 && res.status < 300 && res.json.messages?.[0]?.id) {
      console.log(`[whatsapp] sent to +${customer.whatsapp} (${res.json.messages[0].id})`);
      return { ...record, ok: true, messageId: res.json.messages[0].id };
    }
    const error = res.json.error?.error_user_msg || res.json.error?.message || `HTTP ${res.status}`;
    console.error(`[whatsapp] failed for +${customer.whatsapp}: ${error}`);
    return { ...record, ok: false, error };
  } catch (e) {
    // Connection errors can have an empty message (e.g. AggregateError), so fall back to the code.
    const error = e.message || e.code || e.errors?.[0]?.code || 'Could not reach WhatsApp';
    console.error(`[whatsapp] failed for +${customer.whatsapp}: ${error}`);
    return { ...record, ok: false, error };
  }
}

// The record of a message the user opens in their own WhatsApp.
const chatRecord = (customer, serviceName) => ({
  at: new Date().toISOString(),
  status: customer.status,
  mode: 'chat',
  ok: true,
  text: preview(templateValues(customer, serviceName)),
});

module.exports = { sendStatusUpdate, chatRecord, mode, config };
