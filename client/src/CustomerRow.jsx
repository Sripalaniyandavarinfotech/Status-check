import { useEffect, useState } from 'react';
import { plural, t } from './i18n.js';
import { api, copyText, kind, phone, showError, when, whatsappLink, withAgency } from './lib.js';

const isReject = s => /reject/i.test(s);

// Copies a value, which can be fetched at that moment, and shows that it worked.
function CopyButton({ value, label, className = 'btn' }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      const text = typeof value === 'function' ? await value() : value;
      if (await copyText(text)) setCopied(true);
      else showError({ message: t('Could not copy. Select the number and copy it by hand.') });
    } catch (e) {
      showError(e);
    }
  }

  return <button className={className} aria-label={label} onClick={copy}>{t(copied ? 'Copied' : 'Copy')}</button>;
}

// The full number is fetched only when asked for, and hides itself again.
function AadhaarLine({ c, onRemove }) {
  const [number, setNumber] = useState('');

  useEffect(() => {
    if (!number) return undefined;
    const timer = setTimeout(() => setNumber(''), 30000);
    return () => clearTimeout(timer);
  }, [number]);

  const fetchNumber = async () => number || (await api(`customers/${c.id}/aadhaar`, { method: 'POST' })).aadhaar;

  async function show() {
    try {
      setNumber(await fetchNumber());
    } catch (e) {
      showError(e);
    }
  }

  return (
    <p className="aadhaar-line">
      {t('Aadhaar')}: {number ? number.replace(/(\d{4})(?=\d)/g, '$1 ') : `XXXX XXXX ${c.aadhaarLast4}`}
      {c.hasAadhaar && <button className="link-btn" onClick={number ? () => setNumber('') : show}>{t(number ? 'Hide' : 'Show')}</button>}
      {c.hasAadhaar && <CopyButton className="link-btn" value={fetchNumber} label={t('Copy Aadhaar number of {name}', { name: c.name })} />}
      <button className="link-btn" onClick={() => onRemove(c)}>{t('Remove')}</button>
    </p>
  );
}

function History({ c }) {
  const sent = (c.notifications || []).filter(n => n.mode !== 'test');
  if (!sent.length) return <p className="quiet">{t('No WhatsApp updates yet.')}</p>;
  return (
    <ul className="history">
      {sent.slice(0, 5).map(n => (
        <li key={n.at} title={n.text}>
          <span className={n.ok ? '' : 'bad-text'}>
            {!n.ok ? `${t('Failed')}: ${t(n.error)}` : n.mode === 'chat' ? t('Opened in WhatsApp') : t('Sent')}
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

export default function CustomerRow({ c, provider, open, thud, busy, chat, onPerson, onToggle, onStage, onOpenSite, onCheck, onNotify, onChat, onInformed, onEdit, onDelete, onAddNote, onRemoveNote, onRemoveAadhaar }) {
  const k = kind(c);
  const manual = provider?.manual;
  const finished = k === 'ok' || k === 'bad';
  const label = c.lastChecked ? t(c.status) : manual ? t('Not updated yet') : t('Not checked yet');

  return (
    <li className={`row ${open ? 'open' : ''} ${c.informed ? 'informed' : ''}`}>
      <div className="row-main">
        <button className="row-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="who">
            <span className={`initial ${k}`} aria-hidden="true">{c.name.trim()[0]?.toUpperCase()}</span>
            <span className="who-text">
              <span className="who-name">
                <strong>{c.name}</strong>
                {c.panKind && <span className={`kind ${c.panKind.toLowerCase()}`}>{t(c.panKind)}</span>}
              </span>
              <span className="quiet">{t(provider?.name || c.type)}{c.panAgency ? ` ${c.panAgency}` : ''}{c.operatorName ? `, ${c.operatorName}` : ''}</span>
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
            {c.samePhone > 1 && <span className="quiet small">{t('{n} applications on this number', { n: c.samePhone })}</span>}
          </span>
          <span className="chev" aria-hidden="true" />
        </button>
        <div className={`row-actions ${chat && c.notifyDue ? 'due-row' : ''}`}>
          {chat && c.notifyDue && <button className="btn primary" onClick={() => onChat(c)}>{t('Send on WhatsApp')}</button>}
          <label className="informed-check">
            <input type="checkbox" checked={!!c.informed} onChange={e => onInformed(c, e.target.checked)} />
            {t('Informed')}
          </label>
          <CopyButton value={c.applicationNo} label={t('Copy application number of {name}', { name: c.name })} />
          {manual ? (
            <>
              <button className="btn" onClick={() => onOpenSite(c)}>{t(withAgency(provider, c.panAgency).openLabel)}</button>
              <button className="btn good" disabled={k === 'ok'} onClick={() => onStage(c, 'Approved')}>{t('Approved')}</button>
              <button className="btn stop" disabled={isReject(c.status || '')} onClick={() => onStage(c, 'Rejected')}>{t('Rejected')}</button>
            </>
          ) : provider?.ready && (
            <button className="btn" disabled={busy} onClick={() => onCheck(c)}>{busy ? t('Checking…') : t('Check now')}</button>
          )}
        </div>
      </div>

      {/* Always in the page, so it can slide open and shut. Closed, it can't be reached by keyboard. */}
      <div className={`row-more-wrap ${open ? 'open' : ''}`} inert={!open} aria-hidden={!open}>
        <div className="row-more-clip">
          <div className="row-more">
              <Notes c={c} onAdd={onAddNote} onRemove={onRemoveNote} />
              <div className="row-facts">
                <section>
                  <h3>{t('Application')}</h3>
                  {c.operatorName && <p>{t('Operator')}: {c.operatorName}</p>}
                  {c.panKind && <p>{t('Application type')}: {t(c.panKind)}</p>}
                  {c.birthDate && <p>{t('Date of birth')}: {c.birthDate}</p>}
                  {c.appliedOn && <p>{t('Application date')}: {c.appliedOn}</p>}
                  {c.service && <p>{c.service}</p>}
                  {c.aadhaarLast4 && <AadhaarLine c={c} onRemove={onRemoveAadhaar} />}
                  {c.remarks && <p>{c.remarks}</p>}
                  {c.previousStatus && <p className="quiet">{t('Before this')}: {t(c.previousStatus)}</p>}
                  <p className="quiet">{manual ? t('Updated') : t('Checked')}: {when(c.lastChecked)}</p>
                </section>
                <section>
                  <h3>{t('WhatsApp')}</h3>
                  <History c={c} />
                </section>
                <section className="row-tools">
                  {c.samePhone > 1 && <button className="btn person-btn" onClick={() => onPerson(c.whatsapp)}>{t('All {n} applications', { n: c.samePhone })}</button>}
                  <button className="btn" onClick={() => onEdit(c)}>{t('Edit customer')}</button>
                  {chat
                    ? <button className="btn" disabled={!c.found} onClick={() => onChat(c)}>{t('Send on WhatsApp')}</button>
                    : <button className="btn" disabled={!c.found} onClick={() => onNotify(c)}>{t('Send update now')}</button>}
                  <a className="btn" href={whatsappLink(c, provider)} target="_blank" rel="noopener noreferrer">{t('Open chat')}</a>
                  <button className="btn stop" onClick={() => onDelete(c)}>{t('Delete customer')}</button>
                </section>
              </div>
          </div>
        </div>
      </div>
    </li>
  );
}
