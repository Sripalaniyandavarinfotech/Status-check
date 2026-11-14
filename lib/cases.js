// Aadhaar name change cases. A case follows one customer through:
//   New -> Certificates applied (Community + Income) -> Apply OBC -> OBC applied
//   -> Ready (all certificates in hand) -> At Aadhaar centre (SID) -> Done.
// The certificates and the Aadhaar update are ordinary customers linked to the case,
// so the automatic TNeDistrict checks and the Aadhaar list keep working on them,
// and the case's stage is worked out from their statuses each time.
const { query } = require('./db');
const aadhaar = require('./aadhaar');
const money = require('./money');

const ROLES = ['community', 'income', 'obc'];
const ROLE_NAMES = { community: 'Community certificate', income: 'Income certificate', obc: 'OBC certificate', aadhaar: 'Aadhaar update' };
const STAGES = ['new', 'certs', 'obc', 'obc-applied', 'ready', 'centre', 'done', 'attention'];

// The same result groups as the customer lists: ok (finished well), bad (rejected
// or not found), none (not checked yet), '' (in progress).
function kind(c) {
  if (!c) return null;
  if (!c.last_checked) return 'none';
  if (!c.found || /reject|cancel/i.test(c.status || '')) return 'bad';
  if (/approved|accepted|e-?roll updated|issued|complet|sign|print|deliver/i.test(c.status || '')) return 'ok';
  return '';
}

// Where a case stands, from its linked applications.
function stageOf(row, apps) {
  const by = Object.fromEntries(apps.map(a => [a.case_role, a]));
  const k = role => kind(by[role]);
  if (row.final === 'updated') return { stage: 'done' };
  if (row.final === 'rejected') return { stage: 'attention', reason: 'Aadhaar update rejected' };
  if (by.aadhaar) {
    if (k('aadhaar') === 'ok') return { stage: 'done' };
    if (k('aadhaar') === 'bad') return { stage: 'attention', reason: 'Aadhaar update rejected' };
    return { stage: 'centre' };
  }
  const bad = ROLES.find(r => (r !== 'obc' || row.obc_needed) && k(r) === 'bad');
  if (bad) return { stage: 'attention', reason: `${ROLE_NAMES[bad]} rejected`, role: bad };
  if (!by.community || !by.income) return { stage: 'new' };
  if (k('community') !== 'ok' || k('income') !== 'ok') return { stage: 'certs' };
  if (!row.obc_needed) return { stage: 'ready' };
  if (!by.obc) return { stage: 'obc' };
  if (k('obc') !== 'ok') return { stage: 'obc-applied' };
  return { stage: 'ready' };
}

const iso = d => (d ? new Date(d).toISOString() : null);

const COLUMNS = `n.id, n.name, n.name_ta, n.new_name_en, n.new_name_ta, n.whatsapp, n.aadhaar_last4, (n.aadhaar_sealed IS NOT NULL) AS has_aadhaar,
  to_char(n.requested_on, 'YYYY-MM-DD') AS requested_on, n.obc_needed, n.operator_id, n.note, n.payment, n.fee, n.sid,
  to_char(n.enrolled_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS') AS enrolled_at, n.final, n.finished_at,
  n.ready_sent_at, n.done_sent_at, n.created_at,
  (SELECT o.name FROM operators o WHERE o.id = n.operator_id) AS operator_name,
  COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.case_id = n.id), 0)::int AS paid,
  (SELECT jsonb_build_object('id', f.id, 'dueOn', to_char(f.due_on, 'YYYY-MM-DD'), 'note', f.note)
   FROM followups f WHERE f.case_id = n.id AND f.done_at IS NULL ORDER BY f.due_on, f.id LIMIT 1) AS follow_up`;

const appFrom = a => ({
  id: a.id, role: a.case_role, type: a.type, applicationNo: a.application_no, status: a.status, kind: kind(a),
  remarks: a.remarks, lastChecked: iso(a.last_checked), changedAt: iso(a.status_changed_at || a.last_checked),
});

function fromRow(r, apps) {
  const s = stageOf(r, apps);
  return {
    id: r.id, name: r.name, nameTa: r.name_ta || '', newNameEn: r.new_name_en, newNameTa: r.new_name_ta, whatsapp: r.whatsapp,
    aadhaarLast4: r.aadhaar_last4, hasAadhaar: r.has_aadhaar, requestedOn: r.requested_on, obcNeeded: r.obc_needed,
    operatorId: r.operator_id ? String(r.operator_id) : '', operatorName: r.operator_name, note: r.note || '',
    payment: r.payment || null, fee: r.fee ?? null, paid: r.paid || 0, followUp: r.follow_up || null,
    sid: r.sid || '', enrolledAt: r.enrolled_at, final: r.final, readySentAt: iso(r.ready_sent_at), doneSentAt: iso(r.done_sent_at),
    createdAt: iso(r.created_at), finishedAt: iso(r.finished_at), stage: s.stage, reason: s.reason || null, reasonRole: s.role || null,
    apps: Object.fromEntries(apps.map(a => [a.case_role, appFrom(a)])),
  };
}

async function appsOf(ids) {
  if (!ids.length) return {};
  const { rows } = await query(
    `SELECT id, case_id, case_role, type, application_no, status, found, last_checked, status_changed_at, remarks
     FROM customers WHERE case_id = ANY($1) AND case_role IS NOT NULL ORDER BY created_at`,
    [ids],
  );
  const out = {};
  for (const r of rows) (out[r.case_id] ||= []).push(r);
  return out;
}

async function list(owner) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM name_cases n WHERE n.owner = $1 ORDER BY n.created_at DESC LIMIT 500`, [owner]);
  const apps = await appsOf(rows.map(r => r.id));
  const items = rows.map(r => fromRow(r, apps[r.id] || []));
  const counts = Object.fromEntries(STAGES.map(st => [st, items.filter(c => c.stage === st).length]));
  counts.all = items.length;
  counts.open = items.filter(c => c.stage !== 'done').length;
  counts.action = counts.obc + counts.ready + counts.attention;
  return { items, counts };
}

async function get(owner, id) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM name_cases n WHERE n.owner = $1 AND n.id = $2`, [owner, id]);
  if (!rows[0]) return null;
  return fromRow(rows[0], (await appsOf([id]))[id] || []);
}

async function counts(owner) {
  return (await list(owner)).counts;
}

// For the monthly report: started, enrolled and finished in a month.
async function month(owner, ym) {
  const { items } = await list(owner);
  const inMonth = d => d && new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7) === ym;
  return {
    started: items.filter(c => inMonth(c.createdAt)).length,
    enrolled: items.filter(c => c.enrolledAt && c.enrolledAt.slice(0, 7) === ym).length,
    finished: items.filter(c => c.stage === 'done' && inMonth(c.final === 'updated' ? c.finishedAt : c.apps.aadhaar?.changedAt)).length,
  };
}

// The SID on the Aadhaar centre slip ends with the date and time of enrolment:
// S1483822988390 20261105152827 -> 2026-11-05T15:28:27.
function sidDate(sid) {
  const m = String(sid || '').replace(/\s/g, '').toUpperCase().match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  if (y < 2010 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const isWhen = s => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s || '') && isDay(s.slice(0, 10));

// /api/cases/...
async function casesApi(req, res, url, user, h) {
  const { send, readBody, httpError, activity, normalizeWhatsapp, operators, customers, byId, isValidNumber } = h;
  const [, , , id, action, role] = url.pathname.split('/');
  const body = req.method === 'POST' ? await readBody(req) : {};
  const record = (what, detail) => activity.log({ actor: user, action: what, owner: user.id, detail });
  const label = c => `${c.name} → ${c.newNameEn}`;

  if (req.method === 'GET' && !id) return send(res, 200, await list(user.id));

  // A new case, or edits to one. Aadhaar is sealed under the case's id.
  async function details(existing) {
    const text = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const name = text(body.name, 200);
    const nameTa = text(body.nameTa, 200);
    const newNameEn = text(body.newNameEn, 200);
    const newNameTa = text(body.newNameTa, 200);
    const whatsapp = normalizeWhatsapp(body.whatsapp);
    const requestedOn = String(body.requestedOn || '');
    if (!name) throw httpError(400, 'Enter the name as it is on Aadhaar now');
    if (nameTa && !/[\u0B80-\u0BFF]/.test(nameTa)) throw httpError(400, 'Write the old Tamil name in Tamil letters');
    if (!newNameEn) throw httpError(400, 'Enter the new name in English');
    if (!/^[A-Za-z .'-]+$/.test(newNameEn)) throw httpError(400, 'Write the new English name in English letters only');
    if (!newNameTa) throw httpError(400, 'Enter the new name in Tamil');
    if (!/[஀-௿]/.test(newNameTa)) throw httpError(400, 'Write the new Tamil name in Tamil letters');
    if (!whatsapp) throw httpError(400, 'Enter a valid 10-digit mobile number');
    if (!isDay(requestedOn)) throw httpError(400, 'Choose the date of the request');
    const operatorId = body.operatorId ? String(body.operatorId) : null;
    if (operatorId && (!/^[0-9]{1,18}$/.test(operatorId) || !await operators.owned(operatorId, user.id))) throw httpError(400, 'Choose an operator from your list');
    let number = String(body.aadhaar || '').replace(/[\s-]/g, '');
    // Started from an existing customer: their saved Aadhaar number is copied, still sealed.
    if (!number && !existing && body.fromCustomer) {
      const { rows } = await query('SELECT id, aadhaar_sealed FROM customers WHERE id = $1 AND owner = $2', [String(body.fromCustomer), user.id]);
      if (rows[0]?.aadhaar_sealed) {
        try { number = aadhaar.open(rows[0].aadhaar_sealed, rows[0].id); } catch { throw httpError(500, "That customer's Aadhaar number cannot be read. Check AADHAAR_KEY."); }
      }
    }
    if (!number && !existing?.hasAadhaar) throw httpError(400, 'Enter the 12-digit Aadhaar number');
    if (number && !aadhaar.isValid(number)) throw httpError(400, 'Enter a valid 12-digit Aadhaar number');
    if (number && !aadhaar.ready()) throw httpError(503, 'Aadhaar numbers cannot be saved until AADHAAR_KEY is set');
    return { name, nameTa, newNameEn, newNameTa, whatsapp, requestedOn, operatorId, number, obcNeeded: body.obcNeeded !== false, note: text(body.note, 500) };
  }

  if (req.method === 'POST' && !id) {
    const d = await details(null);
    // The optional amounts: the fee, and "paid now" saved as the first payment.
    const fee = body.fee === undefined || body.fee === null || body.fee === '' ? null : money.rupees(body.fee);
    if (fee === null && body.fee !== undefined && body.fee !== null && body.fee !== '') throw httpError(400, 'Enter the fee in whole rupees');
    const paidNow = body.paidNow === undefined || body.paidNow === null || body.paidNow === '' ? 0 : money.rupees(body.paidNow);
    if (paidNow === null) throw httpError(400, 'Enter the amount paid in whole rupees');
    if (paidNow && !['cash', 'upi'].includes(body.payMode)) throw httpError(400, 'Choose Cash or UPI');
    const caseId = newId();
    const payment = ['paid', 'unpaid'].includes(body.payment) ? body.payment : null;
    await query(
      `INSERT INTO name_cases (id, owner, name, new_name_en, new_name_ta, whatsapp, aadhaar_last4, aadhaar_sealed, requested_on, obc_needed, operator_id, note, payment, payment_at, name_ta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $13::text IS NULL THEN NULL ELSE now() END, $14)`,
      [caseId, user.id, d.name, d.newNameEn, d.newNameTa, d.whatsapp, d.number.slice(-4), aadhaar.seal(d.number, caseId), d.requestedOn, d.obcNeeded, d.operatorId, d.note || null, payment, d.nameTa || null],
    );
    if (fee !== null) await query('UPDATE name_cases SET fee = $2 WHERE id = $1', [caseId, fee]);
    if (paidNow) {
      const target = await money.target(user.id, { caseId });
      await money.addPayment(user.id, target, { amount: paidNow, mode: body.payMode, operatorId: d.operatorId, by: user.userId });
    }
    const made = await get(user.id, caseId);
    await record('case.add', label(made));
    return send(res, 201, made);
  }

  const found = id ? await get(user.id, id) : null;
  if (!found) return send(res, 404, { error: 'Name change not found' });

  if (req.method === 'POST' && action === 'edit') {
    const d = await details(found);
    await query(
      `UPDATE name_cases SET name = $3, name_ta = NULLIF($13, ''), new_name_en = $4, new_name_ta = $5, whatsapp = $6, requested_on = $7, obc_needed = $8, operator_id = $9, note = $10
       , aadhaar_last4 = COALESCE($11, aadhaar_last4), aadhaar_sealed = COALESCE($12, aadhaar_sealed) WHERE id = $1 AND owner = $2`,
      [found.id, user.id, d.name, d.newNameEn, d.newNameTa, d.whatsapp, d.requestedOn, d.obcNeeded, d.operatorId, d.note || null,
        ...(d.number ? [d.number.slice(-4), aadhaar.seal(d.number, found.id)] : [null, null]), d.nameTa],
    );
    const updated = await get(user.id, found.id);
    await record('case.edit', label(updated));
    return send(res, 200, updated);
  }

  // A certificate's application number. An application already in the TNeDistrict
  // list is linked; otherwise it is added there, in the new English name.
  async function linkApp(r, number) {
    const provider = byId.certificate;
    const applicationNo = String(number || '').trim().toUpperCase();
    if (!isValidNumber(provider, applicationNo)) throw httpError(400, `Enter a valid application number for the ${ROLE_NAMES[r].toLowerCase()}`);
    const { rows: [same] } = await query('SELECT id, type, case_id, case_role FROM customers WHERE owner = $1 AND application_no = $2', [user.id, applicationNo]);
    if (same && (same.type !== 'certificate' || (same.case_id && same.case_id !== found.id))) throw httpError(409, `${applicationNo} is already saved for another customer`);
    // A replaced certificate (for example after a rejection) stays in the list, unlinked.
    await query("UPDATE customers SET case_id = NULL, case_role = NULL WHERE case_id = $1 AND case_role = $2 AND application_no <> $3", [found.id, r, applicationNo]);
    if (same) {
      await query('UPDATE customers SET case_id = $2, case_role = $3 WHERE id = $1', [same.id, found.id, r]);
      return same.id;
    }
    const cid = newId();
    const added = await customers.add({
      id: cid, owner: user.id, type: 'certificate', name: found.newNameEn, applicationNo, whatsapp: found.whatsapp,
      operatorId: found.operatorId || null, appliedOn: new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }),
    });
    if (!added) throw httpError(409, `${applicationNo} is already saved`);
    await query('UPDATE customers SET case_id = $2, case_role = $3 WHERE id = $1', [cid, found.id, r]);
    return cid;
  }

  if (req.method === 'POST' && action === 'certificates') {
    const given = ROLES.filter(r => body[r]);
    if (!given.length) throw httpError(400, 'Enter at least one application number');
    if (given.includes('obc') && !found.obcNeeded) throw httpError(400, 'This name change does not need an OBC certificate');
    const added = [];
    for (const r of given) added.push(await linkApp(r, body[r]));
    await record('case.certificates', `${label(found)}: ${given.map(r => ROLE_NAMES[r]).join(', ')}`);
    return send(res, 200, { case: await get(user.id, found.id), added });
  }

  // Enrolment done at the Aadhaar centre: the SID becomes an entry in the Aadhaar list.
  if (req.method === 'POST' && action === 'enrolled') {
    const sid = String(body.sid || '').replace(/\s/g, '').toUpperCase();
    if (!isValidNumber(byId.aadhaar, sid)) throw httpError(400, 'Enter the SID from the Aadhaar centre slip');
    const when = String(body.enrolledAt || '') || sidDate(sid);
    if (!isWhen(when)) throw httpError(400, 'Enter the date and time of enrolment');
    const { rows: [same] } = await query('SELECT id, case_id FROM customers WHERE owner = $1 AND application_no = $2', [user.id, sid]);
    if (same && same.case_id !== found.id) throw httpError(409, `${sid} is already saved for another customer`);
    let cid = same?.id;
    if (!cid) {
      cid = newId();
      const { rows: [sealedRow] } = await query('SELECT aadhaar_sealed FROM name_cases WHERE id = $1', [found.id]);
      let fields = {};
      try {
        const number = sealedRow?.aadhaar_sealed ? aadhaar.open(sealedRow.aadhaar_sealed, found.id) : '';
        if (number) fields = { aadhaarLast4: number.slice(-4), aadhaarSealed: aadhaar.seal(number, cid) };
      } catch { /* the Aadhaar entry is saved without the number */ }
      const added = await customers.add({
        id: cid, owner: user.id, type: 'aadhaar', name: found.newNameEn, applicationNo: sid, whatsapp: found.whatsapp,
        operatorId: found.operatorId || null, appliedOn: when.slice(0, 10).split('-').reverse().join('/'), ...fields,
      });
      if (!added) throw httpError(409, `${sid} is already saved`);
    }
    await query("UPDATE customers SET case_id = $2, case_role = 'aadhaar' WHERE id = $1", [cid, found.id]);
    await query("UPDATE name_cases SET sid = $2, enrolled_at = ($3::timestamp AT TIME ZONE 'Asia/Kolkata'), final = NULL WHERE id = $1", [found.id, sid, when]);
    await record('case.enrolled', `${label(found)}: ${sid}`);
    return send(res, 200, await get(user.id, found.id));
  }

  // By hand: the name is updated, or UIDAI rejected it. "open" undoes either.
  if (req.method === 'POST' && action === 'finish') {
    const result = ['updated', 'rejected'].includes(body.result) ? body.result : body.result === 'open' ? null : undefined;
    if (result === undefined) throw httpError(400, 'Choose Updated or Rejected');
    await query('UPDATE name_cases SET final = $2, finished_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END WHERE id = $1', [found.id, result]);
    await record(`case.${result || 'reopen'}`, label(found));
    return send(res, 200, await get(user.id, found.id));
  }

  if (req.method === 'POST' && action === 'sent' && ['ready', 'done'].includes(body.which)) {
    await query(`UPDATE name_cases SET ${body.which === 'ready' ? 'ready_sent_at' : 'done_sent_at'} = now() WHERE id = $1`, [found.id]);
    await record('case.whatsapp', `${label(found)}: ${body.which}`);
    return send(res, 200, await get(user.id, found.id));
  }

  if (req.method === 'POST' && action === 'aadhaar') {
    const key = `aadhaar|${user.id}`;
    if (h.users.limited(key, 30)) return send(res, 429, { error: 'Too many tries. Wait 10 minutes and try again.' });
    h.users.countTry(key, 10 * 60 * 1000);
    const { rows: [r] } = await query('SELECT aadhaar_sealed FROM name_cases WHERE id = $1', [found.id]);
    if (!r?.aadhaar_sealed) return send(res, 404, { error: 'No Aadhaar number is saved for this name change' });
    let number;
    try { number = aadhaar.open(r.aadhaar_sealed, found.id); } catch { return send(res, 500, { error: 'This Aadhaar number cannot be read. Check AADHAAR_KEY.' }); }
    await record('aadhaar.view', label(found));
    return send(res, 200, { aadhaar: number });
  }

  // Deleting a case keeps its applications in their lists.
  if (req.method === 'DELETE' && !action) {
    await query('DELETE FROM name_cases WHERE id = $1 AND owner = $2', [found.id, user.id]);
    await record('case.delete', label(found));
    return send(res, 200, { ok: true });
  }

  void role;
  return send(res, 405, { error: 'Not allowed' });
}

module.exports = { casesApi, list, get, counts, month, stageOf, sidDate, ROLE_NAMES };
