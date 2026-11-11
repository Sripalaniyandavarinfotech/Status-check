import { useEffect, useState } from 'react';
import Admin from './Admin.jsx';
import AdminNotices from './AdminNotices.jsx';
import App from './App.jsx';
import Calls from './Calls.jsx';
import { Forgot, Login, Register, Reset } from './Auth.jsx';
import ErrorPage from './ErrorPage.jsx';
import ErrorPopup from './ErrorPopup.jsx';
import Landing from './Landing.jsx';
import { t } from './i18n.js';
import { ActivityPage, OperatorStatsPage, ReportsPage } from './Pages.jsx';
import ProfilePage from './Profile.jsx';
import Status from './Status.jsx';
import Ttd from './Ttd.jsx';
import TtdBook from './TtdBook.jsx';
import { SkeletonPage } from './Skeleton.jsx';
import Splash from './Splash.jsx';
import Welcome from './Welcome.jsx';
import { api } from './lib.js';

// Chooses the page by who is logged in. undefined = still finding out, null = nobody.
export default function Root() {
  const [user, setUser] = useState(undefined);
  const [down, setDown] = useState(null); // why the site can't start

  useEffect(() => {
    api('auth/me').then(r => setUser(r.user)).catch(setDown);
    // The server said this session has ended, for example the user was suspended.
    const out = () => {
      if (window.location.pathname !== '/calls') window.history.replaceState(null, '', '/login');
      setUser(null);
    };
    window.addEventListener('signed-out', out);
    return () => window.removeEventListener('signed-out', out);
  }, []);

  async function logout() {
    await api('auth/logout', { method: 'POST' }).catch(() => {});
    if (user?.role !== 'admin' && window.location.pathname !== '/calls') window.history.replaceState(null, '', '/');
    setUser(null);
  }

  if (down) return <ErrorPage code={down.status || t('Offline')} title={t("The site can't load right now")} message={t(down.message)} />;
  if (user === undefined) return window.location.pathname === '/calls' ? <Splash /> : <SkeletonPage />;
  return <><Page user={user} setUser={setUser} logout={logout} /><ErrorPopup /></>;
}

function Page({ user, setUser, logout }) {
  const path = window.location.pathname;
  if (path === '/reset') return <Reset />;
  if (path === '/status') return <Status />;
  if (path === '/home') return user?.role === 'user' ? <Welcome user={user} onLogout={logout} /> : <Landing user={user} />;

  // The phone app. A login made there can only use the phone app.
  if (path === '/calls' || user?.app === 'calls') {
    if (path !== '/calls') window.history.replaceState(null, '', '/calls');
    return <Calls user={user} onLogin={setUser} onLogout={logout} />;
  }

  // The admin has its own address, whoever else may be logged in on this browser.
  if (path.startsWith('/admin') || user?.role === 'admin') {
    if (user?.role !== 'admin') return <Login admin onLogin={setUser} />;
    if (!path.startsWith('/admin')) window.history.replaceState(null, '', '/admin');
    if (path === '/admin/activity') return <ActivityPage user={user} onLogout={logout} />;
    if (path === '/admin/reports') return <ReportsPage user={user} onLogout={logout} />;
    if (path === '/admin/profile') return <ProfilePage user={user} onLogout={logout} />;
    if (path === '/admin/notices') return <AdminNotices user={user} onLogout={logout} />;
    return <Admin user={user} onLogout={logout} />;
  }

  if (user) {
    if (path === '/activity') return <ActivityPage user={user} onLogout={logout} />;
    if (path === '/operators') return <OperatorStatsPage user={user} onLogout={logout} />;
    if (path === '/ttd') return <Ttd user={user} onLogout={logout} />;
    if (path === '/ttd/book') return <TtdBook user={user} onLogout={logout} />;
    if (path === '/reports' || path === '/profile') {
      if (path === '/reports') window.history.replaceState(null, '', '/profile'); // reports moved here
      return <ProfilePage user={user} onLogout={logout} />;
    }
    return <App user={user} onLogout={logout} />;
  }
  if (path === '/register') return <Register />;
  if (path === '/forgot') return <Forgot />;
  if (path === '/') return <Landing />;
  return <Login onLogin={setUser} />;
}
