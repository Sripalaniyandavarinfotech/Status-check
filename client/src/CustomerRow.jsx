import { useState } from 'react';
import { kind, phone, when, whatsappLink } from './lib.js';

const isReject = s => /reject/i.test(s);

// The same stage track the official sites show, but each stage can be clicked.
function StageTrack({ c, provider, onStage }) {
  const steps = provider.stages.filter(s => !isReject(s));
  const at = steps.indexOf(c.status);
  return (
    <ol className="track">
      {steps.map((s, i) => (
        <li key={s} className={i < at ? 'passed' : i === at ? 'here' : ''}>
          <button onClick={() => onStage(c, s)} aria-current={i === at ? 'step' : undefined}>
            <span className="dot" aria-hidden="true">{i <= at ? '✓' : ''}</span>
            {s}
          </button>
        </li>
      ))}
    </ol>
  );
}

function OtherStatus({ c, onStage }) {
  const [value, setValue] = useState('');
  return (
    <form className="other" onSubmit={e => { e.preventDefault(); if (value.trim()) { onStage(c, value.trim()); setValue(''); } }}>
      <label htmlFor={`other-${c.id}`}>Status not listed? Type it as the website shows it</label>
      <div>
        <input id={`other-${c.id}`} value={value} maxLength={100} onChange={e => setValue(e.target.value)} />
        <button className="btn">Save status</button>
      </div>
    </form>
  );
}

function History({ c }) {
  if (!c.notifications?.length) return <p className="quiet">No WhatsApp updates yet.</p>;
  return (
    <ul className="history">
      {c.notifications.slice(0, 5).map(n => (
        <li key={n.at} title={n.text}>
          <span className={n.ok ? '' : 'bad-text'}>
            {!n.ok ? `Failed: ${n.error}` : n.mode === 'test' ? 'Not sent, WhatsApp isn\'t connected' : 'Sent'}
          </span>
          <span className="quiet">{n.status}, {when(n.at)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function CustomerRow({ c, provider, open, thud, busy, onToggle, onStage, onOpenSite, onCheck, onNotify, onDelete }) {
  const k = kind(c);
  const manual = provider?.manual;
  const finished = k === 'ok' || k === 'bad';
  const label = c.lastChecked ? c.status : manual ? 'Not updated yet' : 'Not checked yet';

  return (
    <li className={`row ${open ? 'open' : ''}`}>
      <div className="row-main">
        <button className="row-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="who">
            <strong>{c.name}</strong>
            <span className="quiet">{provider?.name || c.type}</span>
          </span>
          <span className="num">
            {c.applicationNo}
            <span className="quiet">{phone(c.whatsapp)}</span>
          </span>
          <span className="state">
            {finished && c.found
              ? <span className={`stamp ${k} ${thud ? 'thud' : ''}`}>{c.status}</span>
              : <span className={`tag ${k}`}>{label}</span>}
            {c.notifyDue && <span className="due">Waiting to send</span>}
            {c.notifications?.[0] && !c.notifications[0].ok && <span className="bad-text small">Last message failed</span>}
          </span>
          <span className="chev" aria-hidden="true" />
        </button>
        <div className="row-actions">
          {manual ? (
            <>
              <button className="btn" onClick={() => onOpenSite(c)}>{provider.openLabel}</button>
              <button className="btn good" disabled={k === 'ok'} onClick={() => onStage(c, 'Approved')}>Approved</button>
              <button className="btn stop" disabled={isReject(c.status || '')} onClick={() => onStage(c, 'Rejected')}>Rejected</button>
            </>
          ) : provider?.ready && (
            <button className="btn" disabled={busy} onClick={() => onCheck(c)}>{busy ? 'Checking…' : 'Check now'}</button>
          )}
        </div>
      </div>

      {open && (
        <div className="row-more">
          {manual && (
            <section>
              <h3>Stage</h3>
              <StageTrack c={c} provider={provider} onStage={onStage} />
              <OtherStatus c={c} onStage={onStage} />
            </section>
          )}
          <div className="row-facts">
            <section>
              <h3>Application</h3>
              {c.service && <p>{c.service}</p>}
              {c.remarks && <p>{c.remarks}</p>}
              {c.previousStatus && <p className="quiet">Before this: {c.previousStatus}</p>}
              <p className="quiet">{manual ? 'Updated' : 'Checked'} {when(c.lastChecked)}</p>
            </section>
            <section>
              <h3>WhatsApp</h3>
              <History c={c} />
            </section>
            <section className="row-tools">
              <button className="btn" disabled={!c.found} onClick={() => onNotify(c)}>Send update now</button>
              <a className="btn" href={whatsappLink(c, provider)} target="_blank" rel="noopener noreferrer">Open chat</a>
              <button className="btn stop" onClick={() => onDelete(c)}>Delete customer</button>
            </section>
          </div>
        </div>
      )}
    </li>
  );
}
