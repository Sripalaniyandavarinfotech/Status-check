import { useEffect, useRef } from 'react';

// A native <dialog> in the middle of the screen: traps focus and closes on Esc.
export default function Dialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el.open) el.showModal();
    el.querySelector('input')?.focus(); // otherwise the cursor lands on the × button
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={e => { e.preventDefault(); onClose(); }}
      onClick={e => { if (e.target === ref.current) onClose(); }}
    >
      <div className="dialog-body">
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
