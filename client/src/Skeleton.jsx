import { t } from './i18n.js';

// Grey shapes in the place of content that is still loading, so the page keeps its
// layout and people can see that something is coming.

export function SkeletonRows({ count = 4 }) {
  return (
    <ul className="rows skeleton" aria-busy="true" aria-label={t('Loading…')}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="row">
          <div className="sk-row">
            <i className="sk sk-circle" />
            <span className="sk-stack"><i className="sk sk-line w-60" /><i className="sk sk-line w-40 thin" /></span>
            <span className="sk-stack"><i className="sk sk-line w-70" /><i className="sk sk-line w-50 thin" /></span>
            <i className="sk sk-pill" />
            <span className="sk-actions"><i className="sk sk-btn" /><i className="sk sk-btn" /><i className="sk sk-btn" /></span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="table-box skeleton" aria-busy="true" aria-label={t('Loading…')}>
      <div className="sk-table">
        {Array.from({ length: rows + 1 }, (_, r) => (
          <div key={r} className={`sk-tr ${r === 0 ? 'head' : ''}`} style={{ gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)` }}>
            {Array.from({ length: cols }, (_, c) => <i key={c} className={`sk sk-line ${c ? 'w-40 end' : 'w-70'}`} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonTiles({ count = 6 }) {
  return (
    <div className="tiles skeleton" aria-busy="true" aria-label={t('Loading…')}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="tile"><i className="sk sk-line w-70 thin" /><i className="sk sk-num" /></div>
      ))}
    </div>
  );
}

export const SkeletonTitle = () => <span className="sk sk-title" aria-hidden="true" />;

// The page outline shown while the site checks who is logged in.
export function SkeletonPage() {
  return (
    <div className="sk-page" aria-busy="true" aria-label={t('Loading…')}>
      <div className="sk-top" />
      <main className="wrap">
        <section className="lead"><SkeletonTitle /></section>
        <SkeletonRows count={5} />
      </main>
    </div>
  );
}
