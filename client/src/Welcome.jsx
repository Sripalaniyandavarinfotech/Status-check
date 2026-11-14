import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FollowUpItem } from './FollowUps.jsx';
import Header from './Header.jsx';
import { ACTIONS } from './Pages.jsx';
import { SkeletonTable, SkeletonTiles } from './Skeleton.jsx';
import { plural, t } from './i18n.js';
import { api, monthName, rs, shortMonth, showError, when } from './lib.js';

const STEP_MS = 1100;
const HOLD_STEPS = 5; // how long the finished list rests before the bot starts again

// The rows of the services table, PAN split by agency like the side bar.
const SERVICES = [
  { key: 'certificate', type: 'certificate', label: 'TNeDistrict', href: '/' },
  { key: 'smartcard', type: 'smartcard', label: 'TNPDS', href: '/tnpds' },
  { key: 'voter', type: 'voter', label: 'Voter', href: '/voter' },
  { key: 'aadhaar', type: 'aadhaar', label: 'Aadhaar', href: '/aadhaar' },
  { key: 'pan-UTI', type: 'pan', agency: 'UTI', label: 'PAN UTI', href: '/pan/uti' },
  { key: 'pan-NSDL', type: 'pan', agency: 'NSDL', label: 'PAN NSDL', href: '/pan/nsdl' },
];
const FIELDS = ['total', 'new', 'progress', 'approved', 'rejected', 'due', 'toTell'];

// Chart colours, checked for colour blindness and contrast on the card background.
const ADDED = '#b8862e';
const APPROVED = '#2a7d46';

function Bot({ busy }) {
  return (
    <svg className={`bot ${busy ? 'busy' : ''}`} viewBox="0 0 120 120" aria-hidden="true">
      <line className="bot-stalk" x1="60" y1="24" x2="60" y2="10" />
      <circle className="bot-light" cx="60" cy="9" r="5" />
      <rect className="bot-ear" x="8" y="48" width="9" height="26" rx="4" />
      <rect className="bot-ear" x="103" y="48" width="9" height="26" rx="4" />
      <rect className="bot-head" x="17" y="24" width="86" height="72" rx="18" />
      <rect className="bot-face" x="27" y="35" width="66" height="50" rx="12" />
      <g className="bot-eyes">
        <circle cx="46" cy="56" r="6" />
        <circle cx="74" cy="56" r="6" />
      </g>
      <path className="bot-mouth" d="M49 72c6 5 16 5 22 0" />
      <rect className="bot-scan" x="27" y="35" width="66" height="4" rx="2" />
    </svg>
  );
}

const sumRows = rows => Object.fromEntries(FIELDS.map(f => [f, rows.reduce((n, r) => n + (r[f] || 0), 0)]));

function Tile({ label, value, note, href, tone }) {
  const body = (
    <>
      <span className="dash-tile-label">{label}</span>
      <b className="dash-tile-value">{value}</b>
      {note && <span className="dash-tile-note">{note}</span>}
    </>
  );
  return href
    ? <a className={`dash-tile ${tone || ''}`} href={href}>{body}</a>
    : <div className={`dash-tile ${tone || ''}`}>{body}</div>;
}

// Where each application of a service stands, as one thin bar. The numbers are in the
// table beside it, so the colours never carry the meaning alone.
function StageBar({ row }) {
  const parts = [['approved', 'Approved'], ['progress', 'In progress'], ['rejected', 'Rejected'], ['new', 'Not checked yet']]
    .filter(([k]) => row[k] > 0);
  if (!row.total) return <span className="dash-bar blank" aria-hidden="true" />;
  return (
    <span className="dash-bar" aria-hidden="true">
      {parts.map(([k, label]) => (
        <i key={k} className={k} style={{ flexGrow: row[k] }} title={`${t(label)}: ${row[k]}`} />
      ))}
    </span>
  );
}

// Added and approved in each of the last six months. Hover or tab to a month for its numbers.
function MonthsChart({ months }) {
  const box = useRef(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState(null);
  const [table, setTable] = useState(false);

  // Measured before drawing, so a phone never gets a desktop-wide chart first.
  useLayoutEffect(() => {
    if (box.current) setWidth(Math.max(260, box.current.clientWidth));
  }, [table]);
  useEffect(() => {
    if (!box.current) return undefined;
    const watch = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.round(e.contentRect.width))));
    watch.observe(box.current);
    return () => watch.disconnect();
  }, [table]);

  const data = [...months].reverse();
  const top = Math.max(1, ...data.flatMap(m => [m.added, m.approved]));
  const step = top <= 4 ? 1 : top <= 10 ? 2 : top <= 25 ? 5 : top <= 50 ? 10 : Math.ceil(top / 50) * 10;
  const max = Math.ceil(top / step) * step;
  const H = 200;
  const pad = { l: 30, r: 8, t: 18, b: 26 };
  const plotW = width - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const col = plotW / data.length;
  const barW = Math.min(22, (col - 14) / 2);
  const y = v => pad.t + plotH - (v / max) * plotH;
  const ticks = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  // A bar with a rounded top, flat on the baseline. Zero draws nothing.
  const bar = (x, v) => {
    if (!v) return null;
    const h = Math.max(2, (v / max) * plotH);
    const r = Math.min(4, h, barW / 2);
    const b = pad.t + plotH;
    return `M${x},${b}V${b - h + r}Q${x},${b - h} ${x + r},${b - h}H${x + barW - r}Q${x + barW},${b - h} ${x + barW},${b - h + r}V${b}Z`;
  };
  const empty = data.every(m => !m.added && !m.approved);
  const last = data[data.length - 1];

  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <h2>{t('Last 6 months')}</h2>
        <div className="dash-legend">
          <span><i style={{ background: ADDED }} />{t('Added')}</span>
          <span><i style={{ background: APPROVED }} />{t('Approved')}</span>
          <button className="link-btn" onClick={() => setTable(v => !v)}>{table ? t('Show chart') : t('Show numbers')}</button>
        </div>
      </div>
      {table ? (
        <table className="dash-table small">
          <thead><tr><th>{t('Month')}</th><th>{t('Added')}</th><th>{t('Approved')}</th><th>{t('Rejected')}</th><th>{t('WhatsApp sent')}</th></tr></thead>
          <tbody>
            {months.map(m => (
              <tr key={m.month}><td>{monthName(m.month)}</td><td>{m.added}</td><td>{m.approved}</td><td>{m.rejected}</td><td>{m.sent}</td></tr>
            ))}
          </tbody>
        </table>
      ) : empty ? (
        <p className="quiet dash-empty">{t('No applications in the last 6 months yet.')}</p>
      ) : (
        <div className="dash-chart" ref={box} onMouseLeave={() => setHover(null)}>
          <svg width={width} height={H} role="img" aria-label={t('Applications added and approved in each of the last 6 months')}>
            {ticks.map(v => (
              <g key={v}>
                <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className={v ? 'grid' : 'base'} />
                <text x={pad.l - 8} y={y(v) + 4} className="tick" textAnchor="end">{v}</text>
              </g>
            ))}
            {data.map((m, i) => {
              const x0 = pad.l + i * col + (col - barW * 2 - 2) / 2;
              return (
                <g key={m.month} className={hover === i ? 'on' : ''}>
                  <rect className="hit" x={pad.l + i * col} y={pad.t} width={col} height={plotH} />
                  <path d={bar(x0, m.added) || ''} fill={ADDED} />
                  <path d={bar(x0 + barW + 2, m.approved) || ''} fill={APPROVED} />
                  <text x={pad.l + i * col + col / 2} y={H - 8} className={`tick month ${i === data.length - 1 ? 'now' : ''}`} textAnchor="middle">{shortMonth(m.month)}</text>
                  <rect
                    className="focus" x={pad.l + i * col} y={pad.t} width={col} height={plotH} tabIndex={0}
                    aria-label={t('{month}: {added} added, {approved} approved', { month: monthName(m.month), added: m.added, approved: m.approved })}
                    onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  />
                </g>
              );
            })}
            {/* Only this month gets its numbers written on the bars. */}
            {last && hover === null && (() => {
              const x0 = pad.l + (data.length - 1) * col + (col - barW * 2 - 2) / 2;
              return (
                <>
                  {last.added > 0 && <text x={x0 + barW / 2} y={y(last.added) - 5} className="val" textAnchor="middle">{last.added}</text>}
                  {last.approved > 0 && <text x={x0 + barW * 1.5 + 2} y={y(last.approved) - 5} className="val" textAnchor="middle">{last.approved}</text>}
                </>
              );
            })()}
          </svg>
          {hover !== null && (
            <div className="dash-tip" style={{ left: Math.min(width - 150, Math.max(0, pad.l + hover * col + col / 2 - 75)) }}>
              <b>{monthName(data[hover].month)}</b>
              <span><i style={{ background: ADDED }} />{t('Added')} <strong>{data[hover].added}</strong></span>
              <span><i style={{ background: APPROVED }} />{t('Approved')} <strong>{data[hover].approved}</strong></span>
              <span className="quiet">{t('Rejected')} {data[hover].rejected}, {t('WhatsApp sent')} {data[hover].sent}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// The first page after login: what needs doing today, then how the work is going.
// The bot reads through the user's own lists. It doesn't contact any government site,
// so its words only claim what the numbers show.
export default function Welcome({ user, onLogout }) {
  const [data, setData] = useState(null);
  const [providers, setProviders] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    Promise.all([api('dashboard'), api('providers'), api('schedule')])
      .then(([d, list, plan]) => { setData(d); setProviders(list); setSchedule(plan); })
      .catch(showError);
  }, []);

  const ready = !!data;
  const count = SERVICES.length;

  useEffect(() => {
    if (!ready) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStep(count);
      return undefined;
    }
    const timer = setInterval(() => setStep(s => (s >= count + HOLD_STEPS ? 0 : s + 1)), STEP_MS);
    return () => clearInterval(timer);
  }, [ready, count]);

  const rows = SERVICES.map(s => ({
    ...s,
    ...sumRows((data?.services || []).filter(r => r.type === s.type && (!s.agency || r.agency === s.agency))),
    auto: !!providers.find(p => p.id === s.type)?.ready,
  }));
  const all = sumRows(rows);
  // The side bar's numbers, the same as on the service pages.
  const counts = ready ? Object.fromEntries(rows.map(r => [r.href, { n: r.total, due: r.due }])) : null;
  const thisMonth = data?.months?.[0] || { added: 0, approved: 0 };
  const scanning = ready && step < count;
  const running = schedule?.running;

  const line = !ready ? t('Getting ready…')
    : scanning ? t('Looking through {service}…', { service: t(rows[step].label) })
      : all.due ? t('{customers} waiting for a WhatsApp update', { customers: plural(all.due, 'customer') })
        : all.toTell ? t('{customers} to tell about their result', { customers: plural(all.toTell, 'customer') })
          : t('All lists checked. Nothing is waiting to send.');

  const operators = (data?.operators || []).filter(o => o.thisMonth > 0).sort((a, b) => b.thisMonth - a.thisMonth).slice(0, 5);
  const opTop = Math.max(1, ...operators.map(o => o.thisMonth));

  return (
    <>
      <Header user={user} onLogout={onLogout} current="/home" counts={counts} />
      <main className="wrap welcome dash">
        <section className="welcome-hero">
          <Bot busy={scanning} />
          <div>
            <h1>{t('Welcome, {name}', { name: user.userId })}</h1>
            <p className="welcome-line">{line}</p>
            {running
              ? <p className="welcome-note">{t('Checking certificates: {done} of {total}', running)}</p>
              : schedule && <p className="welcome-note">{t('Next certificate check: {when}', { when: t(schedule.nextRun) })}</p>}
          </div>
        </section>

        {!ready ? <><SkeletonTiles count={4} /><SkeletonTable rows={6} cols={7} /></> : (
          <>
            <section className="dash-tiles" aria-label={t('Today')}>
              <Tile label={t('To tell customers')} value={all.toTell} note={t('Approved or rejected, not yet informed')} tone={all.toTell ? 'alert' : ''} href="/calls" />
              <Tile label={t('Waiting for WhatsApp')} value={all.due} note={t('New results to send')} tone={all.due ? 'warm' : ''} />
              <Tile label={t('In progress')} value={all.progress} note={t('Still with the office')} />
              <Tile label={t('Added this month')} value={thisMonth.added} note={t('{n} approved this month', { n: thisMonth.approved })} />
            </section>

            {data.money && data.followUps && <div className="dash-today">
              <section className="dash-card">
                <div className="dash-card-head">
                  <h2>{t('Follow-ups today')}</h2>
                  <a href="/followups">{t('See all')}</a>
                </div>
                {data.followUps.length ? (
                  <ul className="task-list compact">
                    {data.followUps.slice(0, 5).map(f => (
                      <FollowUpItem key={f.id} f={f} onDone={id => setData(d => ({ ...d, followUps: d.followUps.filter(x => x.id !== id) }))} />
                    ))}
                  </ul>
                ) : <p className="quiet dash-empty">{t('Nothing to follow up today.')}</p>}
                {data.followUps.length > 5 && <p className="quiet dash-more">{t('{n} more in Follow-ups', { n: data.followUps.length - 5 })}</p>}
              </section>

              <section className="dash-card dash-money">
                <div className="dash-card-head">
                  <h2>{t('Payments')}</h2>
                  <a href="/report">{t('Monthly report')}</a>
                </div>
                <ul className="dash-pay">
                  <li><b>{data.money.paidToday}</b><span>{t('Marked paid today')}</span></li>
                  <li className={data.money.unpaid ? 'owe' : ''}><b>{data.money.unpaid}</b><span>{t('Not paid')}</span></li>
                </ul>
                {data.money.total > 0 && (
                  <p className="quiet dash-taken">{t('Amounts entered today: {total} (cash {cash}, UPI {upi})', { total: rs(data.money.total), cash: rs(data.money.cash), upi: rs(data.money.upi) })}</p>
                )}
                <a className={`dash-owed ${data.money.unpaid ? 'on' : ''}`} href="/dues">
                  {data.money.unpaid ? t('See who has not paid') : t('Everyone has paid.')}
                </a>
                {data.renewalsDue > 0 && <a className="dash-owed on" href="/renewals">{t('Renewals due: {n}', { n: data.renewalsDue })}</a>}
              </section>
            </div>}

            <section className="dash-card">
              <div className="dash-card-head">
                <h2>{t('Services')}</h2>
                <span className="quiet">{plural(all.total, 'application')}</span>
              </div>
              <div className="dash-scroll">
                <table className="dash-table services">
                  <thead>
                    <tr>
                      <th>{t('Service')}</th><th>{t('Total')}</th><th>{t('Not checked')}</th><th>{t('In progress')}</th>
                      <th>{t('Approved')}</th><th>{t('Rejected')}</th><th>{t('To tell')}</th><th className="bar-col">{t('Where they stand')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const state = scanning && i > step ? 'waiting' : scanning && i === step ? 'now' : 'done';
                      return (
                        <tr key={r.key} className={state}>
                          <th scope="row">
                            <a href={r.href}>
                              <span className="welcome-mark" aria-hidden="true" />
                              <span><b>{t(r.label)}</b><small>{t(r.auto ? 'Checked automatically' : 'Updated by hand')}</small></span>
                            </a>
                          </th>
                          <td className="dn strong">{r.total}</td>
                          <td className="dn">{r.new || '–'}</td>
                          <td className="dn">{r.progress || '–'}</td>
                          <td className={`dn ${r.approved ? 'ok' : ''}`}>{r.approved || '–'}</td>
                          <td className={`dn ${r.rejected ? 'bad' : ''}`}>{r.rejected || '–'}</td>
                          <td className="dn">{r.toTell ? <span className="dash-pill">{r.toTell}</span> : '–'}</td>
                          <td className="bar-col"><StageBar row={r} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="dash-key" aria-hidden="true">
                <span><i className="approved" />{t('Approved')}</span>
                <span><i className="progress" />{t('In progress')}</span>
                <span><i className="rejected" />{t('Rejected')}</span>
                <span><i className="new" />{t('Not checked yet')}</span>
              </p>
            </section>

            <div className="dash-grid">
              <MonthsChart months={data.months} />

              <div className="dash-side">
                {data.nameChanges?.all > 0 && (
                  <section className="dash-card">
                    <div className="dash-card-head">
                      <h2>{t('Aadhaar name change')}</h2>
                      <a href="/aadhaar/name">{t('Open')}</a>
                    </div>
                    <ul className="dash-ttd">
                      <li className={data.nameChanges.obc ? 'act' : ''}><b>{data.nameChanges.obc}</b><span>{t('Apply OBC')}</span></li>
                      <li className={data.nameChanges.ready ? 'act' : ''}><b>{data.nameChanges.ready}</b><span>{t('Ready')}</span></li>
                      <li><b>{data.nameChanges.centre}</b><span>{t('At Aadhaar centre')}</span></li>
                      {data.nameChanges.attention > 0 && <li className="bad"><b>{data.nameChanges.attention}</b><span>{t('Needs attention')}</span></li>}
                    </ul>
                  </section>
                )}
                {data.ttd && (
                  <section className="dash-card">
                    <div className="dash-card-head">
                      <h2>TTD</h2>
                      <a href="/ttd">{t('Open TTD')}</a>
                    </div>
                    <ul className="dash-ttd">
                      <li><b>{data.ttd.ready}</b><span>{t('Ready to book')}</span></li>
                      <li><b>{data.ttd.failed}</b><span>{t('Failed')}</span></li>
                      <li><b>{data.ttd.bookedThisMonth}</b><span>{t('Booked this month')}</span></li>
                    </ul>
                  </section>
                )}
                <section className="dash-card">
                  <div className="dash-card-head">
                    <h2>{t('Operators this month')}</h2>
                    <a href="/operators">{t('All stats')}</a>
                  </div>
                  {operators.length ? (
                    <ul className="dash-ops">
                      {operators.map(o => (
                        <li key={o.name || '-'}>
                          <span>{o.name || t('No operator chosen')}</span>
                          <span className="dash-op-bar"><i style={{ width: `${(o.thisMonth / opTop) * 100}%` }} /></span>
                          <b>{o.thisMonth}</b>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="quiet dash-empty">{t('No applications added this month yet.')}</p>}
                </section>

                <section className="dash-card">
                  <div className="dash-card-head">
                    <h2>{t('Recent activity')}</h2>
                    <a href="/activity">{t('See all')}</a>
                  </div>
                  {data.recent.length ? (
                    <ul className="dash-recent">
                      {data.recent.map(a => (
                        <li key={a.id}>
                          <b>{t(ACTIONS[a.action] || a.action)}</b>
                          {a.detail && <span className="wrap-text">{t(a.detail)}</span>}
                          <small className="quiet">{when(a.at)}{a.actor !== user.userId ? `, ${t(a.actor)}` : ''}</small>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="quiet dash-empty">{t('Nothing yet.')}</p>}
                </section>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
