import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from './Header.jsx';
import { SkeletonRows } from './Skeleton.jsx';
import { t } from './i18n.js';
import { api, copyText, showError } from './lib.js';
import { KINDS, KIND_ORDER, dateText, groupName, spaced } from './ttdShared.js';

// Booking mode: one ready booking at a time, every detail one click (or one key) to
// copy, in the order of the TTD form. Staff paste into TTD themselves; nothing here
// touches the TTD site. Everything loads before the rush, so copying never waits.

const SIDE = new URLSearchParams(window.location.search).get('side') === '1';
const RELEASE_KEY = 'ttd-release';
const typing = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
const pad = n => String(n).padStart(2, '0');

// The copy order, the same as the TTD form: general details, then each pilgrim.
// Gender and ID proof are dropdowns on TTD, so they are shown to pick, not copied.
function fieldsOf(b) {
  if (!b) return [];
  return [
    { row: 'general', key: 'email', label: 'Email address', value: b.email },
    { row: 'general', key: 'city', label: 'City', value: b.city },
    { row: 'general', key: 'state', label: 'State', value: b.state },
    { row: 'general', key: 'country', label: 'Country', value: b.country },
    { row: 'general', key: 'pincode', label: 'Pincode', value: b.pincode },
    ...b.pilgrims.flatMap((p, i) => [
      { row: i, key: 'name', label: 'Name', value: p.name },
      { row: i, key: 'age', label: 'Age', value: String(p.age) },
      { row: i, key: 'aadhaar', label: 'Photo ID number', value: p.aadhaar || '', show: p.aadhaar ? spaced(p.aadhaar) : t('Not saved'), missing: !p.aadhaar },
    ]),
  ];
}

// A short beep. The browser only allows sound after a click, so it's switched on by one.
let audio = null;
function beep(times = 1) {
  if (!audio) return;
  for (let i = 0; i < times; i += 1) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
    o.connect(g); g.connect(audio.destination);
    const at = audio.currentTime + i * 0.35;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    o.start(at); o.stop(at + 0.27);
  }
}

// Counts down to the time TTD opens the quota today, and beeps a minute before and at it.
function Countdown() {
  const [time, setTime] = useState(() => { try { return localStorage.getItem(RELEASE_KEY) || '10:00'; } catch { return '10:00'; } });
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(false);
  const fired = useRef({});
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);
  useEffect(() => { try { localStorage.setItem(RELEASE_KEY, time); } catch { /* not kept */ } }, [time]);

  const [h, m] = time.split(':').map(Number);
  const at = new Date(); at.setHours(h || 0, m || 0, 0, 0);
  const left = Math.round((at - now) / 1000);
  useEffect(() => {
    const k = `${at.toDateString()} ${time}`;
    if (left <= 60 && left > 55 && !fired.current[`${k}-60`]) { fired.current[`${k}-60`] = true; beep(1); }
    if (left <= 0 && left > -5 && !fired.current[`${k}-0`]) { fired.current[`${k}-0`] = true; beep(3); }
  });

  const turnOn = () => {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); setSound(true); beep(1); } catch { setSound(false); }
  };
  const label = left > 0
    ? `${left >= 3600 ? `${Math.floor(left / 3600)}:` : ''}${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`
    : null;
  return (
    <div className={`ttd-count ${left > 0 && left <= 60 ? 'soon' : ''} ${left <= 0 && left > -600 ? 'open' : ''}`}>
      <label>
        {t('Opens at')}
        <input type="time" value={time} onChange={e => setTime(e.target.value)} aria-label={t('Release time')} />
      </label>
      <b aria-live="polite">{label ? t('in {time}', { time: label }) : left > -600 ? t('Open now') : t('Opened')}</b>
      <button className={`btn ${sound ? 'good' : ''}`} onClick={turnOn}>{sound ? t('Sound on') : t('Turn on sound')}</button>
    </div>
  );
}

export default function TtdBook({ user, onLogout }) {
  const [list, setList] = useState(null);
  const [kind, setKind] = useState('');
  const [at, setAt] = useState(0); // the booking open now, within the filtered queue
  const [cursor, setCursorState] = useState(0); // the next field to copy
  // Kept in a ref too, so two quick key presses never copy the same field twice.
  const cursorRef = useRef(0);
  const setCursor = useCallback(v => {
    const n = typeof v === 'function' ? v(cursorRef.current) : v;
    cursorRef.current = n;
    setCursorState(n);
  }, []);
  const [copied, setCopied] = useState({}); // booking id -> field indexes copied
  const [flash, setFlash] = useState(null);
  const [done, setDone] = useState({}); // booking id -> 'booked' | 'failed', this visit
  const [ref, setRef] = useState(null); // the reference number being typed after "Booked"
  const [busy, setBusy] = useState(false);
  const refBox = useRef(null);

  const load = useCallback(() => api('ttd/sheet', { method: 'POST', body: {} }).then(l => { setList(l); setDone({}); }).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { document.title = `${t('Booking mode')} - TTD`; }, []);

  const queue = useMemo(() => (list || []).filter(b => !kind || b.kind === kind), [list, kind]);
  const open = queue.filter(b => !done[b.id]);
  const current = queue[at] || null;
  const fields = useMemo(() => fieldsOf(current), [current]);
  const doneHere = copied[current?.id] || [];

  useEffect(() => { if (at >= queue.length && queue.length) setAt(queue.length - 1); }, [at, queue.length]);
  useEffect(() => { setCursor(0); setRef(null); }, [current?.id, setCursor]);
  useEffect(() => { if (ref !== null) refBox.current?.focus(); }, [ref]);

  const copy = useCallback(async i => {
    const f = fields[i];
    if (!f) return;
    if (f.missing) { showError({ message: t('This pilgrim has no Aadhaar number saved. Add it in the booking first.') }); return; }
    setCursor(Math.min(i + 1, fields.length - 1));
    if (!await copyText(f.value)) { showError({ message: t('Could not copy. Select the text and copy it by hand.') }); return; }
    setCopied(c => ({ ...c, [current.id]: [...new Set([...(c[current.id] || []), i])] }));
    setFlash(i);
    setTimeout(() => setFlash(x => (x === i ? null : x)), 700);
  }, [fields, current, setCursor]);

  // Space copies the next field; ← → step back and forward; ↑ ↓ jump between rows;
  // 1 to 5 copy that field of the current row.
  useEffect(() => {
    const key = e => {
      if (typing(document.activeElement) || e.ctrlKey || e.metaKey || e.altKey || !fields.length) return;
      const rowOf = i => fields[i]?.row;
      const at = cursorRef.current;
      if (e.key === ' ') { e.preventDefault(); copy(at); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setCursor(c => Math.min(c + 1, fields.length - 1)); }
      else if (e.key === 'ArrowLeft' || e.key === 'Backspace') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const rows = [...new Set(fields.map(f => f.row))];
        const r = rows.indexOf(rowOf(at)) + (e.key === 'ArrowDown' ? 1 : -1);
        if (rows[r] !== undefined) setCursor(fields.findIndex(f => f.row === rows[r]));
      } else if (/^[1-5]$/.test(e.key)) {
        const inRow = fields.map((f, i) => [f, i]).filter(([f]) => f.row === rowOf(at));
        const pick = inRow[Number(e.key) - 1];
        if (pick) { e.preventDefault(); copy(pick[1]); }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [fields, copy, setCursor]);

  const next = () => {
    const after = queue.findIndex((b, i) => i > at && !done[b.id]);
    const first = queue.findIndex(b => !done[b.id] && b.id !== current?.id);
    setAt(after >= 0 ? after : first >= 0 ? first : at);
  };

  async function mark(status, refNo) {
    setBusy(true);
    try {
      await api(`ttd/${current.id}/status`, { method: 'POST', body: { status, refNo } });
      setDone(d => ({ ...d, [current.id]: status }));
      setRef(null);
      next();
    } catch (e) {
      showError(e);
    }
    setBusy(false);
  }

  const rows = current ? [['general', t('General details')], ...current.pilgrims.map((p, i) => [i, t('Pilgrim {n}', { n: i + 1 })])] : [];
  const nextField = fields[cursor];

  return (
    <>
      {SIDE ? null : <Header user={user} onLogout={onLogout} noNav />}
      <main className={`ttd-book ${SIDE ? 'side' : 'wrap'}`}>
        <div className="ttd-book-top">
          <a href="/ttd" className="ttd-back" target={SIDE ? '_blank' : undefined} rel="noreferrer">← {t('TTD bookings')}</a>
          <h1>{t('Booking mode')}</h1>
          {!SIDE && <button className="btn" onClick={() => window.open('/ttd/book?side=1', 'ttd-book', 'popup,width=470,height=900')}>{t('Open in a side window')}</button>}
        </div>

        <Countdown />

        <div className="ttd-book-bar">
          <div className="pick kind-filter" role="group" aria-label={t('Booking type')}>
            <div>
              {[['', 'All types'], ...KIND_ORDER.map(k => [k, KINDS[k].short])].map(([k, label]) => (
                <label key={k || 'all'}>
                  <input type="radio" name="book-kind" checked={kind === k} onChange={() => { setKind(k); setAt(0); }} />
                  <span>{t(label)}</span>
                </label>
              ))}
            </div>
          </div>
          <button className="btn" onClick={load}>{t('Reload')}</button>
        </div>

        {!list ? <SkeletonRows count={3} /> : !queue.length ? (
          <div className="empty"><p>{t('No bookings are ready. Add them on the TTD bookings page first.')}</p></div>
        ) : (
          <div className="ttd-book-grid">
            <aside className="ttd-queue" aria-label={t('Queue')}>
              <p className="quiet">{t('{left} of {total} left', { left: open.length, total: queue.length })}</p>
              <ol>
                {queue.map((b, i) => (
                  <li key={b.id}>
                    <button className={`${i === at ? 'on' : ''} ${done[b.id] || ''}`} onClick={() => setAt(i)}>
                      <b>{groupName(b)}</b>
                      <span>{t(KINDS[b.kind].short)} · {dateText(b)}</span>
                      {done[b.id] && <small>{t(done[b.id] === 'booked' ? 'Booked' : 'Failed')}</small>}
                    </button>
                  </li>
                ))}
              </ol>
            </aside>

            {current && (
              <section className="ttd-card" aria-label={groupName(current)}>
                <div className="ttd-card-head">
                  <div>
                    <span className={`ttd-kind ${current.kind}`}>{t(KINDS[current.kind].label)}</span>
                    <h2>{groupName(current)}</h2>
                  </div>
                  <p className="ttd-date">{dateText(current)}</p>
                </div>

                {done[current.id] && <p className={`ttd-done ${done[current.id]}`}>{t(done[current.id] === 'booked' ? 'Marked booked' : 'Marked failed')}</p>}

                <button className="btn primary ttd-next" onClick={() => copy(cursor)} disabled={!nextField}>
                  <span>{t('Copy next')} <kbd>{t('Space')}</kbd></span>
                  {nextField && <small>{t(nextField.label)}{nextField.row !== 'general' ? `, ${t('pilgrim {n}', { n: nextField.row + 1 })}` : ''}</small>}
                </button>

                {rows.map(([row, title]) => {
                  const p = row === 'general' ? null : current.pilgrims[row];
                  return (
                    <div key={row} className="ttd-copy-row">
                      <h3>{title}</h3>
                      <div className="ttd-copies">
                        {fields.map((f, i) => {
                          if (f.row !== row) return null;
                          const button = (
                            <button
                              key={f.key}
                              className={`ttd-copy ${i === cursor ? 'next' : ''} ${doneHere.includes(i) ? 'done' : ''} ${flash === i ? 'flash' : ''} ${f.missing ? 'missing' : ''} ${f.key}`}
                              onClick={() => copy(i)}
                            >
                              <small>{t(f.label)}{flash === i ? ` · ${t('Copied')}` : ''}</small>
                              <span>{f.show || f.value}</span>
                            </button>
                          );
                          // TTD's order: Name, Age, Gender, Photo ID proof, Photo ID number.
                          if (!p || f.key !== 'aadhaar') return button;
                          return [
                            <div key="g" className="ttd-pick-hint" title={t('Pick this in the TTD dropdown')}><small>{t('Gender')}</small><span>{t(p.gender).toUpperCase()}</span></div>,
                            <div key="id" className="ttd-pick-hint" title={t('Pick this in the TTD dropdown')}><small>{t('Photo ID proof')}</small><span>AADHAAR</span></div>,
                            button,
                          ];
                        })}
                      </div>
                    </div>
                  );
                })}

                <p className="quiet ttd-keys">{t('Keys: Space copies the next field, ← → step back and forward, ↑ ↓ change row, number keys copy that field of the row.')}</p>

                {ref === null ? (
                  <div className="ttd-result">
                    <button className="btn good" disabled={busy} onClick={() => setRef('')}>{t('Booked')}</button>
                    <button className="btn stop" disabled={busy} onClick={() => mark('failed')}>{t('Failed')}</button>
                    <button className="btn" onClick={next}>{t('Skip')}</button>
                  </div>
                ) : (
                  <form className="ttd-result" onSubmit={e => { e.preventDefault(); mark('booked', ref); }}>
                    <input ref={refBox} value={ref} onChange={e => setRef(e.target.value)} placeholder={t('TTD reference number (optional)')} aria-label={t('TTD reference number')} maxLength={40} />
                    <button className="btn good" disabled={busy}>{t('Save as booked')}</button>
                    <button type="button" className="btn" onClick={() => setRef(null)}>{t('Cancel')}</button>
                  </form>
                )}
              </section>
            )}
          </div>
        )}
      </main>
    </>
  );
}
