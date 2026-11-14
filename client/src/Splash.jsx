import { t } from './i18n.js';

// The phone app's loading screen, the same one index.html shows before the scripts
// arrive, so the hand-over from one to the other can't be seen. Its styles are in index.html.
export default function Splash({ line = 'Loading your call list…' }) {
  return (
    <div className="splash" role="status">
      <div className="splash-mark">
        <span className="splash-ring" /><span className="splash-ring r2" />
        <img className="for-calls" src="/calls-icon-192.png" alt="" width="88" height="88" />
      </div>
      <div>
        <p className="splash-title">{t('Calls')}</p>
        <p className="splash-sub for-calls">eThunaivan</p>
      </div>
      <div className="splash-bar" aria-hidden="true"><i /></div>
      <p className="splash-line">{t(line)}</p>
    </div>
  );
}
