import { useEffect, useState } from 'react';
import Admin from './Admin.jsx';
import App from './App.jsx';
import { Forgot, Login, Register, Reset } from './Auth.jsx';
import { api } from './lib.js';

// Chooses the page by who is logged in. undefined = still finding out, null = nobody.
export default function Root() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    api('auth/me').then(r => setUser(r.user)).catch(() => setUser(null));
    // The server said this session has ended, for example the user was suspended.
    const out = () => setUser(null);
    window.addEventListener('signed-out', out);
    return () => window.removeEventListener('signed-out', out);
  }, []);

  async function logout() {
    await api('auth/logout', { method: 'POST' }).catch(() => {});
    if (user?.role !== 'admin') window.history.replaceState(null, '', '/login');
    setUser(null);
  }

  if (user === undefined) return null;
  const path = window.location.pathname;
  if (path === '/reset') return <Reset />;

  // The admin has its own address, whoever else may be logged in on this browser.
  if (path === '/admin' || user?.role === 'admin') {
    if (user?.role !== 'admin') return <Login admin onLogin={setUser} />;
    if (path !== '/admin') window.history.replaceState(null, '', '/admin');
    return <Admin user={user} onLogout={logout} />;
  }

  if (user) return <App user={user} onLogout={logout} />;
  if (path === '/register') return <Register />;
  if (path === '/forgot') return <Forgot />;
  return <Login onLogin={setUser} />;
}
