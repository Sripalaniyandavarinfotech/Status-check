import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { SkeletonRows } from './Skeleton.jsx';
import { plural, t } from './i18n.js';
import { api, kind, phone, showError } from './lib.js';

// Every application saved under one WhatsApp number, across all services. A family
// often shares a number, so each row shows the name too.
export default function PersonApplications({ whatsapp, providers, onOpen, onClose }) {
  const [list, setList] = useState(null);

  useEffect(() => {
    api(`customers/by-phone?whatsapp=${encodeURIComponent(whatsapp)}`)
      .then(setList)
      .catch(e => { showError(e); onClose(); });
  }, [whatsapp, onClose]);

  const serviceOf = c => {
    const p = providers.find(x => x.id === c.type);
    return `${t(p?.shortName || c.type)}${c.panAgency ? ` ${c.panAgency}` : ''}`;
  };

  return (
    <Dialog title={t('All applications for {phone}', { phone: phone(whatsapp) })} onClose={onClose}>
      {!list ? <SkeletonRows count={3} /> : !list.length ? (
        <p className="quiet">{t('No applications are saved with this number.')}</p>
      ) : (
        <>
          <p className="quiet person-count">{plural(list.length, 'application')}</p>
          <ul className="person-list">
            {list.map(c => {
              const k = kind(c);
              return (
                <li key={c.id}>
                  <span className="person-main">
                    <b>{c.name}</b>
                    <span className="quiet">{serviceOf(c)}, {c.applicationNo}{c.appliedOn ? `, ${t('applied {date}', { date: c.appliedOn })}` : ''}</span>
                  </span>
                  <span className={`tag ${k}`}>{c.lastChecked ? t(c.status) : t('Not updated yet')}</span>
                  <button className="btn" onClick={() => onOpen(c)}>{t('Open')}</button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Dialog>
  );
}
