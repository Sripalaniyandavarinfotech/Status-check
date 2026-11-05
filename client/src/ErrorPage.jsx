import { Component } from 'react';
import Header from './Header.jsx';
import { t } from './i18n.js';

export default function ErrorPage({ code, title, message }) {
  return (
    <>
      <Header />
      <main className="auth">
        <section className="auth-box error-page">
          <b>{code}</b>
          <h1>{title}</h1>
          <p>{message}</p>
          <button className="btn primary" onClick={() => window.location.assign('/')}>{t('Reload the site')}</button>
        </section>
      </main>
    </>
  );
}

// Shows a page instead of a blank screen if the site itself breaks.
export class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <ErrorPage code={t('Error')} title={t('Something went wrong')} message={t('This page hit a problem. Your saved data is safe.')} />;
  }
}
