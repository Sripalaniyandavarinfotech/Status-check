// Small HTTPS helper shared by all providers: keeps cookies between calls,
// sends form bodies, and lets a provider pin TLS options for picky government sites.
const https = require('https');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/**
 * request({ host, method, path, cookies, body, headers, maxVersion, timeout })
 * `cookies` is a plain object that is read from and updated with Set-Cookie headers,
 * so pass the same object across calls to keep a session.
 */
function request({ host, method = 'GET', path, cookies = {}, body, headers = {}, maxVersion, timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const req = https.request({
      host,
      path,
      method,
      timeout,
      ...(maxVersion && { maxVersion }),
      headers: {
        'User-Agent': UA,
        ...(cookieHeader && { Cookie: cookieHeader }),
        ...(body && { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Content-Length': Buffer.byteLength(body) }),
        ...headers,
      },
    }, res => {
      for (const c of res.headers['set-cookie'] || []) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', d => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error(`${host} timed out`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Strip tags and decode common HTML entities.
const text = s => String(s || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

module.exports = { request, text };
