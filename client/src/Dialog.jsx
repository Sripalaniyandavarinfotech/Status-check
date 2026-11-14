import { useEffect, useRef, useState } from 'react';
import { t } from './i18n.js';

const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A native <dialog> in the middle of the screen: traps focus and closes on Esc.
// Closing by ×, Esc or a click outside plays a short fade before it goes.
export default function Dialog({ title, alert, wide, onClose, children }) {
  const ref = useRef(null);
  const [closing, setClosing] = useState(false);
  const close = () => {
    if (closing) return;
    if (calm()) { onClose(); return; }
    setClosing(true);
    setTimeout(onClose, 140);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el.open) el.showModal();
    el.querySelector('input')?.focus(); // otherwise the cursor lands on the × button
  }, []);
  return (
    <dialog
      ref={ref}
      className={['dialog', alert ? 'alert' : '', wide ? 'wide' : '', closing ? 'closing' : ''].join(' ').trim()}
      onCancel={e => { e.preventDefault(); close(); }}
      onClick={e => { if (e.target === ref.current) close(); }}
    >
      <div className="dialog-body">
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label={t('Close')} onClick={close}>×</button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
