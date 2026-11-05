import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { t } from './i18n.js';

// The one place failed actions are shown. Opened by showError() in lib.js.
export default function ErrorPopup() {
  const [error, setError] = useState(null);
  const ok = useRef(null);

  useEffect(() => {
    const open = e => setError(e.detail);
    window.addEventListener('app-error', open);
    return () => window.removeEventListener('app-error', open);
  }, []);

  useEffect(() => { ok.current?.focus(); }, [error]);

  if (!error) return null;
  const close = () => setError(null);
  return (
    <Dialog title={error.title} alert onClose={close}>
      <p role="alert">{error.message}</p>
      <div className="dialog-foot">
        <button ref={ok} className="btn primary" onClick={close}>{t('OK')}</button>
      </div>
    </Dialog>
  );
}
