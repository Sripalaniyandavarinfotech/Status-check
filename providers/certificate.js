// Certificate status from TN e-District.
// Replays the site's top-right "Application Status" search (no OTP/captcha needed)
// and parses the status page.
const { request, text } = require('../lib/http');

const HOST = 'tnedistrict.tn.gov.in';
const BASE = '/tneda/';

// The server resets TLS 1.3 handshakes, so pin to TLS 1.2.
const get = (path, cookies, extra = {}) => request({ host: HOST, path, cookies, maxVersion: 'TLSv1.2', ...extra });

const span = (html, id) => {
  const m = html.match(new RegExp(`<span id="statusform:${id}"[^>]*>([\\s\\S]*?)</span>`));
  return m ? text(m[1]) : '';
};

async function lookup(appNo) {
  const cookies = {};
  const page = await get(BASE + 'VerifyCerti.xhtml', cookies);
  const viewState = (page.body.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/) || [])[1];
  const button = (page.body.match(/id="(status:j_id[^"]+)"/) || [])[1];
  if (!viewState || !button) throw new Error('Could not read the e-District search form (site layout may have changed)');

  const form = new URLSearchParams({
    status: 'status',
    'status:applicationNo': appNo,
    status_SUBMIT: '1',
    'javax.faces.ViewState': viewState,
    'javax.faces.source': button,
    'javax.faces.partial.event': 'click',
    'javax.faces.partial.execute': `status:applicationNo ${button}`,
    'javax.faces.partial.render': 'status:msgtxt status:panel status:notfundmsg status:showSubPanel',
    'javax.faces.behavior.event': 'action',
    'javax.faces.partial.ajax': 'true',
  }).toString();

  const ajax = await get(BASE + 'VerifyCerti.xhtml', cookies, {
    method: 'POST',
    body: form,
    headers: {
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `https://${HOST}${BASE}VerifyCerti.xhtml`,
    },
  });

  const redirect = (ajax.body.match(/<redirect url="([^"]+)"/) || [])[1];
  if (!redirect) {
    const msg = (ajax.body.match(/<span id="status:msgtxt"[^>]*>([\s\S]*?)<\/span>/) || [])[1];
    return { found: false, number: appNo, message: msg ? text(msg) : 'Application not found' };
  }

  const statusUrl = redirect.startsWith('/') ? redirect : BASE + redirect.replace(/&amp;/g, '&');
  const h = (await get(statusUrl, cookies)).body;
  if (!h.includes('statusform:')) throw new Error('Unexpected response from status page');

  const r = {
    applicationNo: span(h, 'applicantionNo') || appNo,
    transactionNo: span(h, 'transactionNo'),
    applicantName: span(h, 'applicantName'),
    fatherName: span(h, 'fatherName'),
    gender: span(h, 'gender'),
    currentAddress: span(h, 'caddress'),
    permanentAddress: span(h, 'paddress'),
    service: span(h, 'serviceName'),
    dateOfRequest: span(h, 'dateOfRequest'),
  };

  return {
    found: true,
    number: r.applicationNo,
    status: span(h, 'stat'),
    remarks: span(h, 'remarksId'),
    title: r.service,
    details: [
      ['Applicant Name', r.applicantName],
      ['Father / Husband / Guardian / Mother', r.fatherName],
      ['Gender', r.gender],
      ['Transaction Reference No.', r.transactionNo],
      ['Request For', r.service],
      ['Date of Request', r.dateOfRequest],
      ['Current Address', r.currentAddress],
      ['Permanent Address', r.permanentAddress],
    ],
    sourceUrl: `https://${HOST}${statusUrl}`,
    ...r, // raw e-District fields, for API callers
  };
}

module.exports = {
  id: 'certificate',
  name: 'Certificate (e-District)',
  shortName: 'TNeDistrict',
  numberLabel: 'Application number',
  placeholder: 'e.g. TN-5202610011030',
  pattern: '^[A-Z0-9-]{5,25}$',
  ready: true,
  lookup,
};
