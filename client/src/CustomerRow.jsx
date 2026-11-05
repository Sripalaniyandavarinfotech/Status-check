import { useState } from 'react';
import { plural, t } from './i18n.js';
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
            {t(s)}
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
      <label htmlFor={`other-${c.id}`}>{t('Status not listed? Type it as the website shows it')}</label>
      <div>
        <input id={`other-${c.id}`} value={value} maxLength={100} onChange={e => setValue(e.target.value)} />
        <button className="btn">{t('Save status')}</button>
      </div>
    </form>
  );
}

function History({ c }) {
  if (!c.notifications?.length) return <p className="quiet">{t('No WhatsApp updates yet.')}</p>;
  return (
    <ul className="history">
      {c.notifications.slice(0, 5).map(n => (
        <li key={n.at} title={n.text}>
          <span className={n.ok ? '' : 'bad-text'}>
            {!n.ok ? `${t('Failed')}: ${t(n.error)}` : n.mode === 'test' ? t("Not sent, WhatsApp isn't connected") : t('Sent')}
          </span>
          <span className="quiet">{t(n.status)}, {when(n.at)}</span>
        </li>
      ))}
    </ul>
  );
}

function Notes({ c, onAdd, onRemove }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    if (await onAdd(c, text.trim())) setText('');
    setBusy(false);
  }

  return (
    <section className="notes">
      <h3>{t('Notes')}</h3>
      <form className="other" onSubmit={submit}>
        <label htmlFor={`note-${c.id}`} className="hide">{t('Add a note')}</label>
        <div>
          <input id={`note-${c.id}`} value={text} maxLength={1000} placeholder={t('Add a note, for example "documents pending"')} onChange={e => setText(e.target.value)} />
          <button className="btn" disabled={busy}>{t('Add note')}</button>
        </div>
      </form>
      {c.notes?.length > 0 && (
        <ul className="note-list">
          {c.notes.map(n => (
            <li key={n.id}>
              <p>{n.body}</p>
              <span className="quiet">{n.author}, {when(n.at)}</span>
              <button className="link-btn" onClick={() => onRemove(c, n.id)}>{t('Delete')}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function CustomerRow({ c, provider, open, thud, busy, onToggle, onStage, onOpenSite, onCheck, onNotify, onEdit, onDelete, onAddNote, onRemoveNote }) {
  const k = kind(c);
  const manual = provider?.manual;
  const finished = k === 'ok' || k === 'bad';
  const label = c.lastChecked ? t(c.status) : manual ? t('Not updated yet') : t('Not checked yet');

  return (
    <li className={`row ${open ? 'open' : ''}`}>
      <div className="row-main">
        <button className="row-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="who">
            <span className={`initial ${k}`} aria-hidden="true">{c.name.trim()[0]?.toUpperCase()}</span>
            <span className="who-text">
              <strong>{c.name}</strong>
              <span className="quiet">{t(provider?.name || c.type)}</span>
            </span>
          </span>
          <span className="num">
            {c.applicationNo}
            <span className="quiet">{phone(c.whatsapp)}</span>
          </span>
          <span className="state">
            {finished && c.found
              ? <span className={`stamp ${k} ${thud ? 'thud' : ''}`}>{t(c.status)}</span>
              : <span className={`tag ${k}`}>{label}</span>}
            {c.notifyDue && <span className="due">{t('Waiting to send')}</span>}
            {c.notifications?.[0] && !c.notifications[0].ok && <span className="bad-text small">{t('Last message failed')}</span>}
            {c.notes?.length > 0 && <span className="quiet small">{plural(c.notes.length, 'note')}</span>}
          </span>
          <span className="chev" aria-hidden="true" />
        </button>
        <div className="row-actions">
          {manual ? (
            <>
              <button className="btn" onClick={() => onOpenSite(c)}>{t(provider.openLabel)}</button>
              <button className="btn good" disabled={k === 'ok'} onClick={() => onStage(c, 'Approved')}>{t('Approved')}</button>
              <button className="btn stop" disabled={isReject(c.status || '')} onClick={() => onStage(c, 'Rejected')}>{t('Rejected')}</button>
            </>
          ) : provider?.ready && (
            <button className="btn" disabled={busy} onClick={() => onCheck(c)}>{busy ? t('Checking…') : t('Check now')}</button>
          )}
        </div>
      </div>

      {open && (
        <div className="row-more">
          {manual && (
            <section>
              <h3>{t('Stage')}</h3>
              <StageTrack c={c} provider={provider} onStage={onStage} />
              <OtherStatus c={c} onStage={onStage} />
            </section>
          )}
          <Notes c={c} onAdd={onAddNote} onRemove={onRemoveNote} />
          <div className="row-facts">
            <section>
              <h3>{t('Application')}</h3>
              {c.service && <p>{c.service}</p>}
              {c.remarks && <p>{c.remarks}</p>}
              {c.previousStatus && <p className="quiet">{t('Before this')}: {t(c.previousStatus)}</p>}
              <p className="quiet">{manual ? t('Updated') : t('Checked')}: {when(c.lastChecked)}</p>
            </section>
            <section>
              <h3>{t('WhatsApp')}</h3>
              <History c={c} />
            </section>
            <section className="row-tools">
              <button className="btn" onClick={() => onEdit(c)}>{t('Edit customer')}</button>
              <button className="btn" disabled={!c.found} onClick={() => onNotify(c)}>{t('Send update now')}</button>
              <a className="btn" href={whatsappLink(c, provider)} target="_blank" rel="noopener noreferrer">{t('Open chat')}</a>
              <button className="btn stop" onClick={() => onDelete(c)}>{t('Delete customer')}</button>
            </section>
          </div>
        </div>
      )}
    </li>
  );
}
